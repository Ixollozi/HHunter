import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  appType: 'spa',
  plugins: [react()],
  // start.py без --dev поднимает «vite preview»; без no-store браузер может долго держать старый index.html.
  preview: {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.venv/**',
        '**/database/**',
        '**/logs/**',
        '**/hhunter-extension/**',
        '**/dist/**',
      ],
    },
  },
})
