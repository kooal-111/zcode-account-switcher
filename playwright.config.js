import { defineConfig } from "@playwright/test";

// UI-тесты гоняются против dev-сервера Vite (?mock= сценарии — только DEV).
// Браузер: системный Microsoft Edge (channel msedge) — без скачивания бинарей.
export default defineConfig({
  testDir: "tests-ui",
  timeout: 30000,
  retries: 0,
  use: {
    channel: "msedge",
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 680, height: 820 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173/",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
  projects: [{ name: "edge", use: { channel: "msedge" } }],
});
