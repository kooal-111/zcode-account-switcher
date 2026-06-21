import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite отвечает только за сборку React-фронтенда (renderer)
// Главный процесс (main.js / preload.js) — чистый Node, не проходит через Vite
export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
