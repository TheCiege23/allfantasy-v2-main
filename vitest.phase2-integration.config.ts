import { defineConfig } from 'vitest/config'
import path from 'path'

const repoRoot = process.cwd()

/**
 * Serialized runner for the Phase 2 real-database integration tests ONLY. These files talk to a real (isolated)
 * Postgres over a shared Neon pooler; running them on parallel workers causes connection contention. This
 * standalone config (NOT mergeConfig — that concatenates `include` and would pull the whole suite) runs exactly
 * the two files, in one worker, one at a time.
 *
 * One command (with TEST_DATABASE_URL pointed at a proven-isolated DB):
 *   TEST_DATABASE_URL=... DATABASE_URL=$TEST_DATABASE_URL DIRECT_URL=$TEST_DATABASE_URL npm run test:phase2:db
 * Gated: with no TEST_DATABASE_URL the files SKIP.
 */
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(repoRoot, 'vitest.setup.ts')],
    include: [
      '__tests__/decision-os/three-brain-phase2-integration.test.ts',
      '__tests__/decision-os/three-brain-phase2-hardening-integration.test.ts',
      '__tests__/decision-os/canonical-decision-store-integration.test.ts',
    ],
    fileParallelism: false,
    maxConcurrency: 1,
    poolOptions: { threads: { singleThread: true, maxThreads: 1, minThreads: 1 } },
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@': repoRoot,
      'server-only': path.resolve(repoRoot, 'tests/__mocks__/server-only.ts'),
    },
  },
})
