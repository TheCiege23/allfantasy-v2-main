import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
export default defineConfig({
  resolve: { alias: { '@': resolve(process.cwd()) } },
  test: {
    environment: 'node',
    globals: true,
    include: [
      '__tests__/values/idpCeilingBand.test.ts',
      '__tests__/values/idpCeilingCaveatWiring.test.ts',
      '__tests__/values/idpTradeLineupWarningWiring.test.ts',
      '__tests__/values/tradeRefusalCauses.test.ts',
    ],
    pool: 'forks',
  },
})
