import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
