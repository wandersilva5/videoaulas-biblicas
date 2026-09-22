import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build gera arquivos estáticos em ../web/dist, servidos pelo
// scripts/servidor.mjs (zero-dependência) em produção.
// Em dev (`npm run dev`), /api, /media, /pdfs e /api/progresso (SSE)
// são proxied para o servidor.mjs local.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: '../web/dist',
    emptyOutDir: true,
  },
  server: {
    port: 5177,
    proxy: {
      '/api': 'http://127.0.0.1:5176',
      '/media': 'http://127.0.0.1:5176',
      '/pdfs': 'http://127.0.0.1:5176',
    },
  },
});
