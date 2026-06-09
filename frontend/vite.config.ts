import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendTarget =
  process.env.LISTENING_BACKEND_URL ?? 'http://127.0.0.1:5173'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/tracks.json': backendTarget,
      '/audio': backendTarget,
      '/transcripts': backendTarget,
    },
  },
  preview: {
    host: true,
    port: 4174,
  },
})
