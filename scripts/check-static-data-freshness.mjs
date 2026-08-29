#!/usr/bin/env node
/**
 * Fails when a committed `data/` artifact has aged out of the period it describes.
 *
 * Two kinds of check, because there are two kinds of artifact:
 *   PERIOD   — the file carries the year it covers, so it can date itself.
 *   COVERAGE — the file carries NO date, so it is dated against one that does.
 *
 * ⚠ A CRON CANNOT REFRESH THESE, WHICH IS WHY A CHECK EXISTS INSTEAD. The period artifacts are
 * STATICALLY IMPORTED (`draftCapital.ts`, `teamTendencies.ts`) and so are bundled at build time;
 * the ADP export has no generator in this repo at all. A scheduled job would write to an
 * ephemeral filesystem and change nothing that is running. Only a human updates these.
 *
 * So the job is not to refresh, it is to REFUSE TO BE QUIET. `ingestCFBDStats` sat unscheduled
 * for months while a surface served stale columns and looked correct doing it. An artifact that
 * silently ages out every off-season is the same shape.
 *
 * Needs NO database and NO network — committed files and a clock — so it runs in CI, by hand,
 * and in any workflow without configuration.
 *
 *   node scripts/check-static-data-freshness.mjs
 *   node scripts/check-static-data-freshness.mjs --report-only   # never exits non-zero
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_ONLY = process.argv.includes('--report-only')

/**
 * The NFL draft runs in late April. Flagging from 1 June leaves a month of slack, so a run on
 * 1 May does not go red while the release is still being published.
 */
function latestCompletedDraft(now) {
  const y = now.getUTCFullYear()
  return now.getUTCMonth() >= 5 ? y : y - 1
}

/**
 * An NFL season labelled Y is played Sep Y through early Feb Y+1, so it is not COMPLETE until
 * the February after it starts. Flagging from March: in January the season in progress is not
 * finished and must not be demanded.
 */
function latestCompletedSeason(now) {
  const y = now.getUTCFullYear()
  return now.getUTCMonth() >= 2 ? y - 1 : y - 2
}

const normName = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

let failed = 0

/* =========================================================================================
 * PERIOD CHECKS — the artifact carries the year it covers.
 * ====================================================================================== */

const PERIOD = [
  {
    label: 'NFL draft capital',
    file: 'data/nfl-draft-capital.json',
    periodOf: (r) => Number(r?.draftYear),
    period: 'draft',
    expected: latestCompletedDraft,
    regenerate: ['npx tsx scripts/derive-nfl-draft-capital.ts'],
    consequence:
      'every defender drafted that year reads as undrafted, which is indistinguishable\n' +
      '  from genuinely undrafted in every surface that shows it.',
  },
  {
    label: 'team defense tendencies',
    file: 'data/team-defense-tendencies.json',
    periodOf: (r) => Number(r?.season),
    period: 'season',
    expected: latestCompletedSeason,
    /*
     * ⚠ THE YEARS ARE NOT OPTIONAL HERE. `derive-team-defense-tendencies.ts` defaults to
     * `FROM = 2024, TO = 2025` as HARDCODED literals, so running it bare regenerates exactly
     * the seasons already committed and looks like it worked. Anyone following this instruction
     * without arguments would see a no-op diff and conclude the check was wrong.
     */
    regenerate: [
      '# the years are REQUIRED — the script defaults to a hardcoded 2024..2025',
      'npx tsx scripts/derive-team-defense-tendencies.ts <fromSeason> <toSeason>',
    ],
    consequence:
      'the defence a surface describes is the one from a previous season, under a\n' +
      '  coordinator who may have left. `teamTendencies.ts` says to always render the season\n' +
      '  for exactly this reason.',
  },
]

for (const a of PERIOD) {
  let rows
  try {
    rows = JSON.parse(readFileSync(join(ROOT, a.file), 'utf8'))
  } catch (err) {
    console.error(`\n[${a.label}] cannot read ${a.file}: ${err.message}`)
    failed++
    continue
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error(`\n[${a.label}] artifact is empty or not an array.`)
    failed++
    continue
  }

  const periods = rows.map(a.periodOf).filter(Number.isFinite)
  if (periods.length === 0) {
    console.error(`\n[${a.label}] no usable ${a.period} values in ${rows.length} rows.`)
    failed++
    continue
  }

  const latest = Math.max(...periods)
  const expected = a.expected(new Date())
  const counts = new Map()
  for (const p of periods) counts.set(p, (counts.get(p) ?? 0) + 1)
  const recent = [...counts.entries()]
    .sort((x, y) => y[0] - x[0])
    .slice(0, 4)
    .map(([p, n]) => `${p}=${n}`)
    .join('  ')

  console.log(`\n[${a.label}] ${a.file}`)
  console.log(`  ${rows.length} rows, ${a.period}s ${Math.min(...periods)}-${latest}`)
  console.log(`  most recent: ${recent}`)
  console.log(`  expected latest completed ${a.period}: ${expected}`)

  if (latest >= expected) {
    console.log(`  OK — includes the most recent completed ${a.period}.`)
    continue
  }

  failed++
  console.error(`  STALE: stops at ${latest}, but ${a.period} ${expected} is complete.`)
  console.error('')
  console.error('  Nothing refreshes this automatically — it is statically imported and bundled')
  console.error('  at build time. Regenerate and commit it:')
  console.error('')
  for (const line of a.regenerate) console.error(`      ${line}`)
  console.error(`      git add ${a.file} && git commit`)
  console.error('')
  console.error(`  Until then, ${a.consequence}`)
}

/* =========================================================================================
 * COVERAGE CHECKS — the artifact carries no date of its own.
 *
 * `nfl-adp-multiplatform.csv` is a hand-placed export: no season column, no generator in this
 * repo, nothing in it saying which year it describes. It can still be dated, because an ADP
 * board for season Y lists the players who entered the league in Y.
 *
 * Measured 2026-08-28, rounds 1-2 defenders present by class:
 *     2023: 93%   2024: 86%   2025: 90%   2026: 0%
 *
 * A clean break, not a name-matching artifact — the file predates the 2026 draft. So the newest
 * class in `nfl-draft-capital.json` dates it, and the two artifacts check each other.
 * ====================================================================================== */

const COVERAGE = [
  {
    label: 'multi-platform ADP',
    file: 'data/nfl-adp-multiplatform.csv',
    reference: 'data/nfl-draft-capital.json',
    /*
     * Real classes land at 86-93%; a missing class is 0%. 40% sits far below the observed floor
     * and far above zero, so ordinary variation — a deep pick with no ADP, a name spelled
     * differently — cannot trip it.
     */
    minPresentPct: 40,
    regenerate: [
      '# NO GENERATOR EXISTS IN THIS REPO — this file is a hand-placed export.',
      '# Drop a fresh multi-platform ADP export at data/nfl-adp-multiplatform.csv',
    ],
    consequence:
      'every player who entered the league that year is missing from the four static sources\n' +
      '  this file supplies (fantrax, sleeper, espn, mfl). Measured on production at week 35:\n' +
      '  skill-position rookies reach consensus 29, ffc 24, sleeper 4, espn 1, fantrax 0, mfl 0 —\n' +
      '  so `ffc` prices that whole class ALONE, at provider_count 1.\n' +
      '\n' +
      '  unified-player-service and chat enrichment now fall back to lib/adp/liveAdpFallback.ts,\n' +
      '  which reads those ffc-backed rows out of adp_data and reports the provider count so one\n' +
      '  source is not rendered as five agreeing. STILL UNCOVERED: the comparison lab\n' +
      '  (PlayerStatsResolver) reads the CSV directly, and the mock-draft pool takes its ADP from\n' +
      '  getLiveADP but still sources injury/health here, so rookies carry no health line.\n' +
      '\n' +
      '  The fallback narrows the blast radius; it does not refresh this file. A real export is\n' +
      '  still the only thing that restores multi-platform corroboration for the 2026 class.',
  },
]

for (const c of COVERAGE) {
  console.log(`\n[${c.label}] ${c.file}`)

  let capital
  try {
    capital = JSON.parse(readFileSync(join(ROOT, c.reference), 'utf8'))
  } catch (err) {
    console.error(`  cannot read reference ${c.reference}: ${err.message}`)
    failed++
    continue
  }

  const newestClass = Math.max(...capital.map((r) => Number(r?.draftYear)).filter(Number.isFinite))
  const expected = latestCompletedDraft(new Date())

  /*
   * If the REFERENCE is itself behind, it cannot date anything. Say so and move on rather than
   * raising a second confusing failure — the reference's own check above already reports it.
   */
  if (!Number.isFinite(newestClass) || newestClass < expected) {
    console.log(`  SKIPPED — the reference is itself stale (${newestClass} < ${expected}).`)
    console.log('  Fix that first; its own check above reports it.')
    continue
  }

  let haystack
  try {
    haystack = readFileSync(join(ROOT, c.file), 'utf8').toLowerCase()
  } catch (err) {
    console.error(`  cannot read ${c.file}: ${err.message}`)
    failed++
    continue
  }

  const cohort = capital.filter((r) => r.draftYear === newestClass && r.draftRound <= 2)
  if (cohort.length === 0) {
    console.log(`  SKIPPED — the reference carries no rounds 1-2 cohort for ${newestClass}.`)
    continue
  }

  const present = cohort.filter((r) => haystack.includes(normName(r.name))).length
  const pct = (present / cohort.length) * 100

  console.log(`  dated against the ${newestClass} class: ${present}/${cohort.length} present (${pct.toFixed(0)}%)`)
  console.log(`  threshold: ${c.minPresentPct}%`)

  if (pct >= c.minPresentPct) {
    console.log(`  OK — covers the ${newestClass} class.`)
    continue
  }

  failed++
  console.error(`  STALE: only ${pct.toFixed(0)}% of the ${newestClass} class appears — this file predates that draft.`)
  console.error('')
  for (const line of c.regenerate) console.error(`      ${line}`)
  console.error(`      git add ${c.file} && git commit`)
  console.error('')
  console.error(`  Until then, ${c.consequence}`)
}

const TOTAL = PERIOD.length + COVERAGE.length

if (failed > 0 && !REPORT_ONLY) {
  console.error(`\n${failed} of ${TOTAL} artifacts are stale or unreadable.`)
  process.exit(1)
}
console.log(
  `\n${TOTAL - failed} of ${TOTAL} artifacts current.` +
    (failed > 0 ? ' (--report-only: not failing)' : ''),
)
