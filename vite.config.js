import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/aemo': {
        target: 'https://nemweb.com.au',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/aemo/, ''),
      }
    }
  }
})
