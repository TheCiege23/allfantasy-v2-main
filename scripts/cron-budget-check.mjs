/**
 * Cron budget guard.
 *
 * Vercel caps how many cron jobs a project may register, and the cap is per
 * PLAN, not per project — so the ceiling can move without this repo changing.
 * The failure mode when you cross it is the bad kind: jobs stop being
 * registered, nothing in the build output says so, and the first symptom is
 * stale data weeks later.
 *
 * ⚠ THIS REPO IS NOT CURRENTLY OVER ANY LIMIT. Verified with `vercel crons ls`:
 * all declared jobs were registered. This guard exists so that stays true
 * without anyone having to remember to check.
 *
 *   node scripts/cron-budget-check.mjs
 *   node scripts/cron-budget-check.mjs --report   # print, never fail
 *
 * Three rules, in increasing order of how much they actually catch:
 *
 *   1. CEILING — total declared crons must stay at or under CEILING.
 *
 *   2. NO DUPLICATE (path, schedule) PAIRS — two entries whose paths differ only
 *      by query string AND that share a schedule are one job wearing two cron
 *      slots. That is exactly what `/api/cron/import-scores` and
 *      `?sport=NCAAF` were: same route, same two-minute schedule, two slots. Fold the
 *      variants into the handler and declare the route once. This is the rule
 *      that answers "make sure new crons are combined with the existing ones",
 *      because it fails the moment someone adds the next one.
 *
 *   3. BUDGET REPORT — prints the cadence buckets, so anyone adding a job can
 *      see which existing dispatcher it belongs next to rather than inventing
 *      a new schedule.
 *
 * Rule 2 is a hard failure, not a warning. A warning here would be read past.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Deliberately below any current Vercel plan cap, so this trips while there is
 * still headroom to fix it rather than at the moment jobs start being dropped.
 * Raise it consciously, in a commit that says why.
 */
const CEILING = 60

const reportOnly = process.argv.includes('--report')
const root = process.cwd()

const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
const crons = config.crons ?? []

const basePath = (p) => String(p).split('?')[0]

const failures = []
const lines = []

lines.push(`crons declared: ${crons.length}  (ceiling ${CEILING})`)

// ── Rule 1: ceiling ────────────────────────────────────────────────────────
if (crons.length > CEILING) {
  failures.push(
    `Declared ${crons.length} cron jobs, over the ceiling of ${CEILING}.\n` +
      `    Fold the new job into an existing route or an existing cadence rather than\n` +
      `    adding a slot. See docs/crons.md.`,
  )
}

// ── Rule 2: same route + same schedule = one job in two slots ──────────────
const pairs = new Map()
for (const c of crons) {
  // Carry route and schedule in the VALUE rather than encoding them into the
  // key and splitting them back out — a cron path can contain almost anything,
  // so there is no separator that is safe to round-trip through.
  const key = `${basePath(c.path)} @ ${c.schedule}`
  if (!pairs.has(key)) {
    pairs.set(key, { route: basePath(c.path), schedule: c.schedule, paths: [] })
  }
  pairs.get(key).paths.push(c.path)
}
for (const { route, schedule, paths } of pairs.values()) {
  if (paths.length > 1) {
    failures.push(
      `${paths.length} cron slots for ONE job: ${route} on "${schedule}".\n` +
        paths.map((p) => `      ${p}`).join('\n') +
        `\n    These differ only by query string. Make the handler cover both cases when the\n` +
        `    parameter is absent, and declare the route once — that is what import-scores\n` +
        `    and import-injuries do for ?sport=NCAAF.`,
    )
  }
}

// ── Rule 3: cadence buckets, as guidance ───────────────────────────────────
const buckets = new Map()
for (const c of crons) {
  buckets.set(c.schedule, (buckets.get(c.schedule) ?? 0) + 1)
}
lines.push(`distinct schedules: ${buckets.size}`)
const busiest = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
for (const [schedule, n] of busiest) {
  lines.push(`  ${String(schedule).padEnd(18)} ${n}`)
}

console.log(lines.join('\n'))

if (failures.length && !reportOnly) {
  console.error('\ncron-budget-check FAILED:\n')
  for (const f of failures) console.error(`  - ${f}\n`)
  process.exit(1)
}

if (failures.length) {
  console.log(`\n(${failures.length} issue(s); --report so not failing)`)
} else {
  console.log('\ncron-budget-check OK')
}
