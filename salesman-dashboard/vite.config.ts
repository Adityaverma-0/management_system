import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: loadEnv(mode, '.', 'UNIFIED_APP').UNIFIED_APP === '1' ? '/salesman/' : '/',
  server: { port: 5173, strictPort: true },
}))
