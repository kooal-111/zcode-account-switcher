import { describe, it, expect, vi, afterEach } from "vitest";
import {
  newClaimState, beginPreview, resolvePreview, failPreview, markStale,
  isStale, plansOf, createPreviewQueue, claimableIds, PREVIEW_TTL_MS,
} from "./claim-state.js";

afterEach(() => vi.useRealTimers());

describe("claim state machine", () => {
  it("startup: unknown -> loading (нет данных)", () => {
    const s = beginPreview(newClaimState());
    expect(s.status).toBe("loading");
    expect(s.requestId).toBe(1);
    expect(plansOf(s)).toEqual([]);
  });

  it("startup: unknown со старыми планами -> stale (данные видны, идёт перепроверка)", () => {
    const s = beginPreview({ status: "unknown", plans: [{ plan_id: "x" }], checkedAt: null, requestId: 3 });
    expect(s.status).toBe("stale");
    expect(s.requestId).toBe(4);
    expect(plansOf(s).length).toBe(1);
  });

  it("resolve: доступные планы -> available", () => {
    const s = beginPreview(newClaimState());
    const r = resolvePreview(s, s.requestId, [{ plan_id: "p1" }]);
    expect(r.status).toBe("available");
    expect(r.checkedAt).not.toBeNull();
  });

  it("resolve: пусто -> none", () => {
    const s = beginPreview(newClaimState());
    const r = resolvePreview(s, s.requestId, []);
    expect(r.status).toBe("none");
  });

  it("запоздавший ответ игнорируется (requestId)", () => {
    const s1 = beginPreview(newClaimState());
    const s2 = beginPreview(s1); // requestId=2
    const stale = resolvePreview(s2, s1.requestId, [{ plan_id: "old" }]);
    expect(stale).toBe(s2); // тот же объект — ответ отброшен
  });

  it("ошибка -> error; повтор после ошибки -> loading -> success", () => {
    const s = beginPreview(newClaimState());
    const err = failPreview(s, s.requestId, "boom");
    expect(err.status).toBe("error");
    expect(err.error).toBe("boom");
    const retry = beginPreview(err);
    expect(retry.status).toBe("loading");
    const ok = resolvePreview(retry, retry.requestId, [{ plan_id: "p" }]);
    expect(ok.status).toBe("available");
  });

  it("markStale: available -> stale, none -> loading, unknown не трогаем", () => {
    const s = beginPreview(newClaimState());
    const avail = resolvePreview(s, s.requestId, [{ plan_id: "p" }]);
    expect(markStale(avail).status).toBe("stale");
    const none = resolvePreview(s, s.requestId, []);
    expect(markStale(none).status).toBe("loading");
    expect(markStale(newClaimState()).status).toBe("unknown");
  });

  it("isStale: unknown true, свежий available false, старый true", () => {
    expect(isStale(newClaimState())).toBe(true);
    const s = beginPreview(newClaimState());
    const avail = resolvePreview(s, s.requestId, [{ plan_id: "p" }], Date.now());
    expect(isStale(avail)).toBe(false);
    const old = resolvePreview(s, s.requestId, [{ plan_id: "p" }], Date.now() - PREVIEW_TTL_MS - 1);
    expect(isStale(old)).toBe(true);
  });

  it("совместимость со старой записью {plans, err}", () => {
    const s = beginPreview({ plans: [{ plan_id: "x" }] });
    expect(s.status).toBe("stale");
    expect(isStale({ plans: [] })).toBe(true);
  });
});

describe("preview queue", () => {
  it("не больше concurrency задач одновременно", async () => {
    let active = 0, peak = 0;
    const q = createPreviewQueue({
      concurrency: 2,
      gapMs: 0,
      task: async () => {
        active++; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 40));
        active--;
      },
    });
    for (let i = 0; i < 7; i++) q.enqueue(`a${i}`);
    await vi.waitFor(() => expect(peak).toBe(2), { timeout: 2000 });
    await vi.waitFor(() => expect(q.pending().length).toBe(0), { timeout: 3000 });
    expect(peak).toBe(2);
  });

  it("дедупликация: повторный enqueue до завершения не создаёт вторую задачу", async () => {
    let runs = 0;
    const q = createPreviewQueue({ concurrency: 2, gapMs: 0, task: async () => { runs++; await new Promise((r) => setTimeout(r, 30)); } });
    q.enqueue("x");
    expect(q.enqueue("x")).toBe(false);
    await vi.waitFor(() => expect(runs).toBe(1), { timeout: 2000 });
    // после завершения можно снова
    await vi.waitFor(() => q.enqueue("x"), { timeout: 2000 });
    await vi.waitFor(() => expect(runs).toBe(2), { timeout: 2000 });
  });

  it("cancel снимает задачу из очереди до старта", async () => {
    let runs = 0;
    const q = createPreviewQueue({ concurrency: 1, gapMs: 0, task: async () => { runs++; } });
    q.enqueue("busy-id"); // займёт слот
    q.enqueue("a");
    q.cancel("a");
    await vi.waitFor(() => expect(runs).toBe(1), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 80));
    expect(runs).toBe(1); // "a" так и не стартовала
  });
});

describe("claimableIds", () => {
  it("выбирает только аккаунты с планами", () => {
    const accounts = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const claimable = { a: { status: "available", plans: [{ plan_id: "1" }] }, b: { status: "none", plans: [] } };
    expect(claimableIds(accounts, claimable)).toEqual(["a"]);
  });
});
