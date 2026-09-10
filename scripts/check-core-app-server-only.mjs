#!/usr/bin/env node
/**
 * Every `lib/core-app` module that reaches the database must carry a
 * `server-only` marker.
 *
 * 🛑 THIS GUARDS THE HALF THE BUNDLER CANNOT SEE, AND ONLY THAT HALF.
 * `next build` already refuses a client component that imports a `server-only`
 * module, at ANY depth — `webpack-config.js` registers
 * `next-invalid-import-error-loader` against `/^server-only$/` unconditionally,
 * and webpack propagates the issuer's layer to every module it imports.
 * `typescript.ignoreBuildErrors` does not suppress it: that flag is read in
 * exactly one place in `next/dist/build`, where it gates the `tsc` step, and
 * this is a webpack error.
 *
 * ⚠ SO A CLIENT-SIDE IMPORT SCANNER IS THE WRONG THING TO WRITE, AND ONE WAS
 * WRITTEN HERE FIRST. `__tests__/core-client-server-boundary.test.ts` walked
 * `components/core-app/` classifying value-vs-type imports. A max-effort review
 * found it blind to side-effect imports (`import '@/lib/core-app/x'`), to
 * `await import()`, to `export … from`, to relative specifiers, to any module
 * name containing a hyphen or slash, and to any file whose `'use client'` sat
 * below a block comment — this repo's house style. It also missed a LIVE
 * instance two hops away through `app/dev/handoff-preview/fixtures.ts`. It
 * duplicated the bundler badly while missing the case below.
 *
 * 🛑 THE CASE BELOW IS THE ONE NOTHING CATCHES. A module that reads the database
 * but carries NO marker gives the loader nothing to trip on. It bundles clean,
 * ships `@prisma/client` into the browser graph, and `next.config.js`'s
 * `resolve.fallback = { fs: false }` swallows the loudest symptom. Measured
 * 2026-09-10: `lib/prisma.ts` itself deliberately carries no marker, with its own
 * comment explaining that webpack still bundles client paths importing it. So
 * "is it marked" and "is it dangerous" are different questions, and the marker
 * is the one the toolchain answers.
 *
 * Usage:
 *   node scripts/check-core-app-server-only.mjs
 *   node scripts/check-core-app-server-only.mjs --update-baseline
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB_DIR = join(ROOT, 'lib', 'core-app')
const BASELINE_FILE = join(ROOT, 'scripts', 'core-app-server-only-baseline.json')

/** An import of the prisma client, by alias or relative path, plus raw SQL. */
const DB_REACH = [
  /from\s+['"]@\/lib\/prisma['"]/,
  /from\s+['"][.][^'"]*\/prisma['"]/,
  /require\(\s*['"]@\/lib\/prisma['"]\s*\)/,
  /\$queryRaw/,
  /\$queryRawUnsafe/,
  /\$executeRaw/,
  /\$transaction/,
]

/** The marker, anchored: a mention inside a comment is not an import. */
const MARKER = /^import\s+['"]server-only['"]/m

/**
 * ⚠ ANCHORED ON PURPOSE. `grep -l "server-only" lib/core-app/*.ts` returns 89;
 * the anchored import returns 68. The 21-file gap is files whose comments say
 * they deliberately do NOT have it ("⚠ NO 'server-only', NO PRISMA — DELIBERATELY").
 * A substring count would treat every one of those as compliant — and a wrong
 * count from exactly that grep reached a commit message here on 2026-09-10.
 */
function reachesDb(src) {
  return DB_REACH.some((re) => re.test(src))
}

function main() {
  const files = readdirSync(LIB_DIR)
    .filter((f) => /\.tsx?$/.test(f))
    .sort()

  const violations = []
  let marked = 0
  let scanned = 0

  for (const f of files) {
    const src = readFileSync(join(LIB_DIR, f), 'utf8')
    scanned += 1
    const hasMarker = MARKER.test(src)
    if (hasMarker) marked += 1
    if (reachesDb(src) && !hasMarker) violations.push(`lib/core-app/${f}`)
  }

  /*
   * 🛑 A CHECK THAT SCANNED NOTHING READS AS A PASS. If the directory moves or
   * the extension filter stops matching, `violations` is empty and this exits 0
   * looking exactly like compliance. Pin the corpus, and pin that the marker
   * detector actually finds markers.
   */
  if (scanned < 50) {
    console.error(`\nREFUSING: scanned only ${scanned} file(s) under lib/core-app/.`)
    console.error('That is not a clean run, it is a run that measured nothing.\n')
    process.exit(1)
  }
  if (marked === 0) {
    console.error(`\nREFUSING: found 0 of ${scanned} files carrying a server-only marker.`)
    console.error('The detector is broken; a zero here cannot be a real result.\n')
    process.exit(1)
  }

  const baseline = existsSync(BASELINE_FILE)
    ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
    : null

  if (process.argv.includes('--update-baseline')) {
    const was = baseline ?? []
    const added = violations.filter((v) => !was.includes(v))
    if (baseline && added.length) {
      console.error(`\nREFUSING to add to the baseline: ${added.join(', ')}`)
      console.error('It only ratchets down. Add the marker instead.\n')
      process.exit(1)
    }
    writeFileSync(BASELINE_FILE, JSON.stringify(violations, null, 2) + '\n')
    console.log(`\nBaseline written: ${violations.length} unmarked DB-reaching module(s).`)
    return
  }

  const allowed = new Set(baseline ?? [])
  const regressions = violations.filter((v) => !allowed.has(v))

  console.log(`Scanned ${scanned} module(s) under lib/core-app/; ${marked} carry a server-only marker.`)

  if (regressions.length) {
    console.error(`\n${regressions.length} module(s) reach the database with no server-only marker:\n`)
    for (const r of regressions) console.error(`  ${r}`)
    console.error(`
A lib/core-app module that touches the database must open with:

  import 'server-only'

Without it the bundler has nothing to refuse, so the module can be pulled into a
client bundle silently — no 500, no build failure, no test.
`)
    process.exit(1)
  }

  const stale = [...allowed].filter((a) => !violations.includes(a))
  console.log(`\nOK — no unmarked DB-reaching modules under lib/core-app/.`)
  if (allowed.size) {
    console.log(`  ${allowed.size} baselined; ${violations.length} still present.`)
    console.log('  ⚠ Baselined ones are debt, not approval.')
  }
  if (stale.length) {
    console.log(`  ${stale.length} baseline entr(y/ies) now clean — run --update-baseline to lock in.`)
  }
}

main()
