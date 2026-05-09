import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // Vite 8 (rolldown-vite) routes transforms through oxc instead of esbuild
  // and silently ignores the `esbuild` block. With no `oxc.jsx` set, JSX
  // tokens reach the SSR parser untransformed and fail with
  // `Unexpected JSX expression`. Configure oxc explicitly so .tsx tests parse.
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'react' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['__tests__/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}', 'lib/**/__tests__/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      // Vitest does not apply Next's server/client split; stub side-effect-only package.
      'server-only': path.resolve(__dirname, './tests/__mocks__/server-only.ts'),
    },
  },
})
