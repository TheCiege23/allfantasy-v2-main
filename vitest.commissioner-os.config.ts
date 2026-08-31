import { defineConfig } from 'vitest/config'
import path from 'path'

const repoRoot = process.cwd()

/**
 * Commissioner OS acceptance suites.
 *
 * Separate from vitest.config.ts because everything here needs a live database
 * with the T-001 roles provisioned. In the default suite these would be red on
 * every machine until someone runs prisma/roles/001_provision_roles.sql — and a
 * permanently-red suite is one nobody reads.
 *
 * The files are `.spec.ts` rather than `.test.ts` so the default config's
 * include pattern (`__tests__/**\/*.test.{ts,tsx}`) does not pick them up. That
 * keeps this opt-in without editing the shared config other sessions run
 * against.
 *
 *     npm run test:commissioner-os
 */
export default defineConfig({
  test: {
    // node, not jsdom: these talk to Postgres and nothing renders.
    environment: 'node',
    globals: true,
    include: ['__tests__/commissioner-os/**/*.spec.ts'],
    // 🛑 GATE. These suites write to a database, and @prisma/client loads .env
    // on import — so without this they point at production by default. See
    // dbSpecGuard.ts for the near miss that prompted it.
    // Two gates, and they answer different questions. db-guard asks WHAT this
    // run may connect to; dbSpecGuard asks WHETHER these suites may run at all.
    // COMMISH_DB_SPECS=1 on its own used to be enough to reach production,
    // because an unexported DATABASE_URL is not empty here — .env fills it in.
    setupFiles: [
      path.resolve(repoRoot, 'vitest.setup.db-guard.ts'),
      path.resolve(repoRoot, '__tests__/commissioner-os/dbSpecGuard.ts'),
    ],
    // Role and policy state is global to the database. Parallel files would
    // race each other's assumptions once T-102's isolation suite lands here.
    fileParallelism: false,
    testTimeout: 30000,
  },
  resolve: {
    preserveSymlinks: true,
    alias: { '@': repoRoot },
  },
})
