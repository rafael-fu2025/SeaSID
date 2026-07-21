import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Allow any trycloudflare.com quick-tunnel hostname (regenerated on each
    // `cloudflared tunnel --url` run) so the dev server doesn't block
    // requests from the public tunnel. Safe for local dev only.
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.trycloudflare.com',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
