// Тестовый мок IPC: только для dev-сборки и только при ?mock=<сценарий> в URL.
// В production-сборке applyMock возвращает оригинальный invoke без изменений.
// Никаких реальных данных — только обезличенные фикстуры.

const SCENARIOS = new Set(["claim-available", "claim-none", "claim-error", "many-accounts", "long-content"]);

const MOCK_PLAN = {
  plan_id: "plan-mock-001",
  name: "Mock Weekend Pack",
  description: "Обезличенный тестовый пакет для UI-проверок",
  priority: 100,
  grant_items: [{ name: "GLM-5.3", units: 1500000, period: "daily" }],
};

function accountsFor(scenario) {
  const count = scenario === "many-accounts" ? 13 : 3;
  const long = scenario === "long-content";
  const out = [];
  for (let i = 0; i < count; i++) {
    const name = long
      ? `Очень-Длинное-Имя-Аккаунта-Номер-${i + 1}-с-добавочными-словами`
      : i === 0 ? "first.account@example.com" : `mock.account.${i + 1}@example.com`;
    out.push({
      id: `mock-${i + 1}`,
      name,
      created_at: "2026-10-01 12:00",
      updated_at: "2026-11-02 09:00",
      has_config: i !== 2,
      has_user_info: true,
      is_active: i === 0,
      identity: {
        email: name,
        username: long ? "очень_длинный_юзернейм_без_пробелов_1234567" : `mock_user_${i + 1}`,
      },
      jwt_expired: false,
    });
  }
  return out;
}

export function mockScenario() {
  if (!import.meta.env.DEV) return null;
  const m = new URLSearchParams(window.location.search).get("mock");
  return m && SCENARIOS.has(m) ? m : null;
}

export function applyMock(invoke) {
  const scenario = mockScenario();
  if (!scenario) return invoke;
  const accounts = accountsFor(scenario);
  return async (cmd, args = {}) => {
    switch (cmd) {
      case "app_version":
        return "0.0.0-mock";
      case "get_state":
        return {
          accounts,
          language: new URLSearchParams(window.location.search).get("lang") || "ru",
          zcode_running: false,
          zcode_path_ok: true,
          live_logged_in: false,
          auto_claim: false,
          launch_after_switch: true,
          hot_switch: false,
          close_to_tray: true,
        };
      case "reveal_main":
        return null;
      case "get_account_quota":
        return { plans: [], items: [], plan_tier: null };
      case "claim_preview":
        if (scenario === "claim-error" && args.id === "mock-2") {
          throw "preview_req: HTTP 500: mock failure";
        }
        return scenario === "claim-available" && args.id === "mock-1" ? [MOCK_PLAN] : [];
      case "claim_start":
        throw "claim.none_pending";
      case "claim_refresh":
        if (scenario === "claim-error" && args.id === "mock-2") {
          throw "preview_req: HTTP 500: mock failure";
        }
        return { plans: scenario === "claim-available" && args.id === "mock-1" ? [MOCK_PLAN] : [], activated: false, activationError: null };
      default:
        return null;
    }
  };
}
