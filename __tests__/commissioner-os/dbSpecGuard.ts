/**
 * Commissioner OS · a setup guard for the database-backed specs.
 *
 * 🛑 WHY THIS EXISTS, WRITTEN DOWN BECAUSE IT NEARLY WENT WRONG.
 *
 * The `.spec.ts` suites are written for a non-production database: they seed
 * tenants, insert audit rows, and several of them `CREATE TABLE` scratch
 * probes. Each file says so at the top.
 *
 * On 2026-08-31 they were run with `npm run test:commissioner-os` against the
 * default connection — and `@prisma/client` loads `.env` on import, so
 * "the default connection" was PRODUCTION. Nothing was written: every suite
 * failed at its first assertion because the commish_* roles and the tenancy
 * tables do not exist there, and the CREATE TABLE statements sit after those.
 * Verified afterwards — zero scratch tables in production.
 *
 * That is a near miss, not a safeguard. The suites were stopped by the very
 * thing they exist to set up: the moment T-001 and T-101 are applied, the
 * assertions that failed first would pass, and the same command would reach the
 * CREATE TABLE statements against production.
 *
 * ⚠ A COMMENT AT THE TOP OF EACH FILE IS NOT A CONTROL. This is.
 *
 * The gate is an explicit opt-in rather than hostname matching, deliberately.
 * The root CLAUDE.md records that a `.vercel.app` URL is NOT proof you are off
 * the production database — previews use it — so a host allowlist would be the
 * kind of check that looks careful and answers the wrong question. An env var
 * someone must set for this run cannot be satisfied by accident.
 */

import { beforeAll } from 'vitest'

const OPT_IN = 'COMMISH_DB_SPECS'

beforeAll(() => {
  if (process.env[OPT_IN] === '1') return

  throw new Error(
    [
      '',
      'Commissioner OS database specs are gated.',
      '',
      `  These suites seed tenants, write audit rows and CREATE TABLE scratch`,
      `  probes. They are written for a NON-PRODUCTION database, and`,
      `  @prisma/client loads .env on import — so running them without thinking`,
      `  points them at whatever DATABASE_URL/DIRECT_URL happens to be, which in`,
      `  this repo is production.`,
      '',
      '  To run them, confirm the target first and then opt in:',
      '',
      '    npx tsx scripts/check-staging-env.ts     # exit 1 = not safe',
      `    ${OPT_IN}=1 npm run test:commissioner-os`,
      '',
      '  The unit suites need none of this and run in CI as usual:',
      '',
      '    npx vitest run __tests__/commissioner-os/',
      '',
    ].join('\n'),
  )
})
