import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies:
//  - /bmkg  → BMKG open data API (avoids browser CORS issues in development)
//  - /api, /ws → backend server (only used when VITE_USE_MOCK=false)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.VITE_BACKEND_PROXY_TARGET || 'http://localhost:8080';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/bmkg': {
          target: 'https://api.bmkg.go.id',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/bmkg/, ''),
        },
        '/api': { target: backend, changeOrigin: true },
        '/ws': { target: backend.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
      },
    },
  };
});
