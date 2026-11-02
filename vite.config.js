import { defineConfig } from "vite";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// Vite 8 / ESM: __dirname недоступен — корень через import.meta.url.
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome105",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        settings: resolve(root, "settings.html"),
        captcha: resolve(root, "captcha.html"),
      },
    },
  },
});
