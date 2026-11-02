// Чистая машина состояний preview клеймов + очередь запросов.
// Без зависимостей от Tauri/DOM — покрывается vitest-тестами напрямую.
//
// Статусы: unknown → loading | stale → available | none | error
//   unknown  — preview ещё ни разу не выполнялся для аккаунта
//   loading  — запрос выполняется, прежних данных нет
//   stale    — запрос выполняется, старые планы ещё показываются
//   available/none — успешный ответ (есть/нет планы)
//   error    — ошибка последней проверки (retry вручную или по TTL)

export const PREVIEW_TTL_MS = 5 * 60 * 1000;

export function newClaimState() {
  return { status: "unknown", plans: [], error: null, checkedAt: null, requestId: 0 };
}

// Совместимость с записями старой сессии ({plans, err, busy}).
export function coerceClaimState(v) {
  if (!v || typeof v !== "object" || v.status === undefined) {
    const s = newClaimState();
    if (v && Array.isArray(v.plans) && v.plans.length) {
      s.plans = v.plans;
      s.status = "stale";
    }
    return s;
  }
  return v;
}

export function beginPreview(s) {
  const st = coerceClaimState(s);
  const hasData = (st.plans || []).length > 0;
  return {
    ...st,
    status: hasData ? "stale" : "loading",
    error: null,
    requestId: st.requestId + 1,
  };
}

export function resolvePreview(s, requestId, plans, now = Date.now()) {
  if (!s || requestId !== s.requestId) return s; // запоздавший ответ — игнорируем
  const list = Array.isArray(plans) ? plans : [];
  return {
    ...s,
    status: list.length ? "available" : "none",
    plans: list,
    error: null,
    checkedAt: now,
  };
}

export function failPreview(s, requestId, error, now = Date.now()) {
  if (!s || requestId !== s.requestId) return s;
  return { ...s, status: "error", error, checkedAt: now };
}

// Переводит состояние в «перепроверяется», сохраняя старые планы (если есть).
export function markStale(s) {
  const st = coerceClaimState(s);
  if (st.status === "available" || st.status === "stale") return { ...st, status: "stale" };
  if (st.status === "none") return { ...st, status: "loading" };
  return st; // unknown/loading/error не трогаем
}

export function isStale(s, ttl = PREVIEW_TTL_MS, now = Date.now()) {
  if (!s) return true;
  const st = coerceClaimState(s);
  if (st.status === "unknown") return true;
  if (!st.checkedAt) return true; // loading/stale без отметки — подождём завершения
  return now - st.checkedAt > ttl;
}

export function plansOf(s) {
  const st = coerceClaimState(s);
  return Array.isArray(st.plans) ? st.plans : [];
}

// Очередь preview: максимум `concurrency` задач одновременно,
// пауза gapMs между стартами (анти-429), дедупликация и отмена.
export function createPreviewQueue({ concurrency = 2, gapMs = 350, task } = {}) {
  const queue = [];
  const inflight = new Set();
  let running = 0;
  let nextAllowedAt = 0;

  function pump() {
    while (running < concurrency && queue.length) {
      const wait = nextAllowedAt - Date.now();
      if (wait > 0) {
        setTimeout(pump, wait);
        return;
      }
      const item = queue.shift();
      if (item.cancelled || inflight.has(item.id)) continue;
      running += 1;
      nextAllowedAt = Date.now() + gapMs;
      inflight.add(item.id);
      Promise.resolve()
        .then(() => task(item.id))
        .catch(() => {})
        .finally(() => {
          running -= 1;
          inflight.delete(item.id);
          setTimeout(pump, 0);
        });
    }
  }

  return {
    enqueue(id) {
      if (inflight.has(id) || queue.some((x) => x.id === id)) return false;
      queue.push({ id, cancelled: false });
      pump();
      return true;
    },
    cancel(id) {
      const item = queue.find((x) => x.id === id);
      if (!item) return false;
      item.cancelled = true;
      return true;
    },
    clear() {
      queue.length = 0;
    },
    pending() {
      return queue.filter((x) => !x.cancelled).map((x) => x.id);
    },
    isBusy(id) {
      return inflight.has(id);
    },
  };
}
