import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const apiTarget = process.env.ARTISANAL_API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [vue()],
  build: { outDir: 'dist/web' },
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/v1': { target: apiTarget, changeOrigin: true },
      '/operator': { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
});
