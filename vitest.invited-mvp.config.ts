import { defineConfig } from 'vitest/config'
import path from 'path'

const repoRoot = process.cwd()

export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'react' },
  },
  test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: [path.resolve(repoRoot, 'vitest.setup.ts')],
      include: [
        '__tests__/redraft/g58-invited-mvp-guardrails.test.ts',
        '__tests__/redraft/g59-certification-framework.test.ts',
        '__tests__/redraft/g60-rc1-freeze.test.ts',
        '__tests__/league-create-defaults-api.test.ts',
        '__tests__/leagues-import-commit-validation-wiring.test.ts',
        '__tests__/imported-league-commit-service-tier0.test.ts',
        '__tests__/live-draft-engine/draft-access-auth.test.ts',
        '__tests__/live-draft-engine/submitPick.transaction.test.ts',
        '__tests__/mock-draft-engine/sport-pool-isolation.test.ts',
        '__tests__/redraft/lineup-lock-engine.test.ts',
        '__tests__/redraft/lineup-validation.test.ts',
        '__tests__/waiver-claims-route-scope.test.ts',
        '__tests__/redraft/trades-tab-native-builder-wiring.test.tsx',
        '__tests__/redraft/standings-playoffs-ui-wiring.test.tsx',
        '__tests__/redraft/commissioner-operations-workspace.test.tsx',
        '__tests__/league-settings-subpanels-db-first.test.ts',
        '__tests__/chat-composer-mentions-ui.test.tsx',
        '__tests__/redraft-sport-adapter-parity.test.ts',
      ],
      pool: 'threads',
      maxWorkers: 1,
      testTimeout: 30000,
  },
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@': repoRoot,
      'server-only': path.resolve(repoRoot, 'tests/__mocks__/server-only.ts'),
    },
  },
})
