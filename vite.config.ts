import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/salesman': 'http://localhost:5173' },
    port: 5174,
    strictPort: true,
  },
});
