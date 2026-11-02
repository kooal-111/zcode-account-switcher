import { defineConfig } from "vitest/config";

// Юнит-тесты чистых модулей (src/*.test.js). Playwright-спеки (tests-ui/) — отдельный раннер.
export default defineConfig({
  test: {
    include: ["src/**/*.test.js"],
    environment: "node",
  },
});
