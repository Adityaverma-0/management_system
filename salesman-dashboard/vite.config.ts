import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.UNIFIED_APP === '1' ? '/salesman/' : '/',
  server: { port: 5173, strictPort: true },
})
