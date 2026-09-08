import { defineConfig } from 'vitest/config'
import fs from 'node:fs'
import path from 'node:path'

/** Load .env into process.env for service-role integration tests (never log values). */
function loadLocalEnv() {
  try {
    const text = fs.readFileSync(path.resolve(__dirname, '.env'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (!(key in process.env) || process.env[key] === '') process.env[key] = val
    }
  } catch {
    // .env optional in CI without secrets — tests skipIf(!configured)
  }
}

loadLocalEnv()

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Phase 2C/2D SQL selftests mutate shared synthetic rows — run files serially.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
