import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./app', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['src/__tests__/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
