import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist'
  },
  plugins: [react()],
  appType: 'custom',
  server: {
    middlewareMode: true,
    allowedHosts: true,
    ws: {
      host: 'sync.gitea.home',
      port: 80,
      protocol: 'ws'
    }
  }
});
