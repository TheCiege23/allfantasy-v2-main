/**
 * 🛑 A TEST RUN MUST NEVER INHERIT THE PRODUCTION DATABASE BY DEFAULT.
 *
 * This file runs before every other setup file and before any test module is
 * imported. It exists because of one non-obvious fact about this repo:
 *
 *     IMPORTING `@prisma/client` POPULATES `process.env` FROM `.env`.
 *
 * Measured on 2026-08-31:
 *
 *     node -e "console.log(process.env.DIRECT_URL ? 'SET':'unset');
 *              require('@prisma/client');
 *              console.log(process.env.DIRECT_URL ? 'SET':'unset')"
 *
 *       DIRECT_URL before require: unset
 *       DIRECT_URL after  require: SET
 *       host after require       : ep-curly-block-….neon.tech   ← PRODUCTION
 *
 * So a test that mentions no database, calls no dotenv, and is passed no env
 * var still ends up holding a production connection string the moment anything
 * in its import graph touches Prisma. Nothing in the test is wrong; nothing in
 * it is even visible.
 *
 * ⚠ THE OPT-IN FLAGS ALREADY IN THE DB SUITES DO NOT COVER THIS, AND THAT IS
 * THE WHOLE POINT. Every DB integration suite here is gated — `RUN_EVENT_DB_IT`,
 * `IMPORT_INTEGRATION_DB`, `TEST_DATABASE_URL`. Each one gates WHETHER it runs.
 * None of them gates WHAT IT CONNECTS TO. Their headers say "DATABASE_URL
 * pointed at a NON-prod DB", which is a sentence addressed to a human, not a
 * control. Run `RUN_EVENT_DB_IT=1 npm test` and forget the URL — and the author's
 * reasonable assumption, that an unset variable means "no database", is false
 * here. It means production.
 *
 * ─── HOW THIS SEPARATES A CHOSEN TARGET FROM AN INHERITED ONE ────────────────
 *
 * Setup files run BEFORE any test module is imported, so at this instant `.env`
 * has not been read. Therefore:
 *
 *   DATABASE_URL is set here   →  a human exported it deliberately. Keep it.
 *   DATABASE_URL is unset here →  the only thing that can set it later is
 *                                 Prisma's own `.env` load, which yields
 *                                 production. Pin it shut.
 *
 * `process.env` assignment wins permanently, because dotenv does not overwrite
 * variables that already exist. Pinning here is what stops the later load.
 *
 * ⚠ NO HOSTNAME MATCHING, DELIBERATELY. The root CLAUDE.md records that a
 * `.vercel.app` URL is not proof you are off the production database — previews
 * use it — and `lib/email/undeliverableDomains.ts` records the 114 test rows
 * that belief put in a 146-row table. A host allowlist looks careful and answers
 * the wrong question. "Did a human name this target" is the right question, and
 * it is the one this file asks.
 *
 * ⚠ AND NO ESCAPE-HATCH FLAG. There is deliberately no `ALLOW_PROD_DB_IN_TESTS`.
 * Exporting the URL you want IS the escape hatch, and it is better than a flag
 * because it cannot be set once in a shell profile and then forgotten — it names
 * the target every time, in the same command.
 *
 * ─── POSITIVE CONTROL ────────────────────────────────────────────────────────
 * Prove this can fail before trusting that it passes:
 *
 *     RUN_EVENT_DB_IT=1 npx vitest run __tests__/events/outbox-db.integration.test.ts
 *
 * WITHOUT this file that connects to production and the suite goes green.
 * WITH it, measured on 2026-08-31: exit 1, `Can't reach database server at
 * 127.0.0.1:1`, and zero occurrences of the production host anywhere in the
 * output. A GREEN run there is the failure, which is exactly why the check has
 * to be run red once.
 *
 * ⚠ And read the reason, not the exit code. The first attempt at that control
 * used `--reporter=basic`, which this vitest does not have; it exited 1 on a
 * reporter load error, before a single test ran. Non-zero looked like the guard
 * working. Grep the output for the sentinel address and for the production host
 * — the second count being zero is the assertion, not the exit status.
 */

/**
 * A syntactically valid URL that cannot resolve to anything.
 *
 * Port 1 refuses instantly rather than hanging.
 *
 * ⚠ THE ERROR YOU WILL ACTUALLY SEE NAMES ONLY THE HOST. Measured:
 *
 *     PrismaClientInitializationError: Can't reach database server at `127.0.0.1:1`
 *
 * `P1001` does not echo the database name, so the descriptive name below is NOT
 * what tells the reader why — it shows up in psql and in some tooling, and it is
 * grep-able in this repo, but the tell in a failing test run is the address.
 * `127.0.0.1:1` in a stack trace means this file pinned it, and that is the
 * string to search for. (Said plainly because the first version of this comment
 * claimed the name surfaces in the error. It does not.)
 */
const UNREACHABLE =
  'postgresql://vitest_guard:vitest_guard@127.0.0.1:1/set_DATABASE_URL_to_a_non_production_database'

/**
 * Only the two variables `.env` actually supplies, and only these.
 *
 * ⚠ `TEST_DATABASE_URL` IS DELIBERATELY ABSENT and must stay absent.
 * `__tests__/decision-os/*-integration.test.ts` uses its mere PRESENCE as the
 * opt-in (`const RUN = !!URL`). Pinning it would set it, flip those suites from
 * skipped to running, and point them at an address that refuses — turning a
 * guard into the outage it exists to prevent. `.env` does not define it, so it
 * needs no protection here anyway.
 */
const INHERITED_FROM_DOTENV = ['DATABASE_URL', 'DIRECT_URL'] as const

let pinned = false

for (const name of INHERITED_FROM_DOTENV) {
  // `?.trim()` because an empty string is not a chosen target — it is a variable
  // someone cleared, and treating it as deliberate would let `DATABASE_URL= npm test`
  // sail straight past this.
  if (!process.env[name]?.trim()) {
    process.env[name] = UNREACHABLE
    pinned = true
  }
}

/**
 * The signal a suite can branch on: "no human named a database for this run".
 *
 * ⚠ A SUITE THAT NEEDS A DATABASE MUST **SKIP** ON THIS, NOT FAIL ON IT.
 * Pinning the URL alone turns a silent production read into a red suite, and a
 * permanently-red default suite is one nobody reads — which is how the original
 * problem survives in a new costume. Three suites needed this on the day the
 * guard landed (`real-data-validation-phase33/34/35`): each says in its own
 * header to run it with `DATABASE_URL` taken from `.env.test`, none of them
 * gated on that actually happening, and all three were passing in every
 * `npm test` by doing real unmocked execution against production.
 *
 *     const needsDb = process.env.VITEST_NO_DATABASE === '1'
 *     describe.skipIf(needsDb)('…', () => { … })
 *
 * Use `skipIf` rather than an early `return`: a skipped suite is visible in the
 * run summary, so "nobody has run this in months" stays discoverable. A suite
 * that quietly returns reports itself as passing.
 */
if (pinned) {
  process.env.VITEST_NO_DATABASE = '1'
}
