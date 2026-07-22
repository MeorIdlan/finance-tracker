import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/.well-known/oauth-authorization-server': 'http://localhost:3000',
      '/.well-known/oauth-protected-resource': 'http://localhost:3000',
    },
  },
  build: {
    commonjsOptions: {
      include: [/shared/, /node_modules/],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
