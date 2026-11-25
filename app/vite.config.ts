import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The Node server (server/index.ts) listens on 5179 and serves both /api and the built app.
// During `npm run dev` the Vite dev server forwards /api to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  worker: { format: 'es' },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:5179' },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 3000,
  },
});
