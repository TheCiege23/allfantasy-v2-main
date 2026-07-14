import { defineConfig } from 'vitest/config'
import path from 'path'

const repoRoot = process.cwd()

export default defineConfig({
  // Vite 8 (rolldown) uses oxc for transforms and can ignore esbuild JSX options.
  // Configure oxc JSX explicitly so .tsx tests parse correctly.
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'react' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(repoRoot, 'vitest.setup.ts')],
    include: ['__tests__/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}', 'lib/**/__tests__/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
  },
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@': repoRoot,
      // Vitest does not apply Next's server/client split; stub side-effect-only package.
      'server-only': path.resolve(repoRoot, 'tests/__mocks__/server-only.ts'),
    },
  },
})
