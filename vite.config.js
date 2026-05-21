import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy /aemo-proxy/* → https://www.nemweb.com.au/*
      // This runs server-side so there are no CORS restrictions.
      '/aemo-proxy': {
        target: 'https://www.nemweb.com.au',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/aemo-proxy/, ''),
      },
    },
  },
});
