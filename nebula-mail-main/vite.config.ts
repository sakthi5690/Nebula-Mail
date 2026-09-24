import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
  test: {
    include: ['src/**/ai-realtime-sync.test.ts', 'src/**/ai-full-audit.test.ts'],
  },
});
