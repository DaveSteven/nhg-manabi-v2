import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
  ],
  server: {
    port: 5175,
    strictPort: true,
    // Same-origin API in dev (no CORS): FastAPI admin endpoints under /api.
    proxy: {
      '/api': { target: process.env.BACKEND_URL || 'http://localhost:8001' },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // antd is large by nature; it is split into its own chunk below.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules/antd') || id.includes('node_modules/@ant-design') || id.includes('node_modules/rc-')) return 'antd'
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts'
          return undefined
        },
      },
    },
  },
})
