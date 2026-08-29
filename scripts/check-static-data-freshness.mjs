#!/usr/bin/env node
/**
 * Fails when a committed `data/` artifact has aged out of the period it describes.
 *
 * ⚠ A CRON CANNOT REFRESH THESE, WHICH IS WHY A CHECK EXISTS INSTEAD. Both artifacts are
 * STATICALLY IMPORTED (`lib/idp-projections/draftCapital.ts`, `lib/idp-projections/teamTendencies.ts`),
 * so they are bundled at build time. A scheduled job on the deployed app would write to an
 * ephemeral filesystem and change nothing that is running. Only a human regenerating and
 * committing updates them.
 *
 * So the job is not to refresh, it is to REFUSE TO BE QUIET. `ingestCFBDStats` sat unscheduled
 * for months while a surface served stale columns and looked correct doing it. An artifact that
 * silently ages out every off-season is the same shape. This turns that silence into a red run
 * with a date on it.
 *
 * Deliberately needs NO database and NO network — it reads committed files and a clock, so it
 * runs in CI, by hand, and in any workflow without configuration.
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

const ARTIFACTS = [
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
     * the seasons that are already committed and looks like it worked. Anyone following this
     * instruction without the arguments would see a no-op diff and conclude the check was wrong.
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

let failed = 0

for (const a of ARTIFACTS) {
  const path = join(ROOT, a.file)
  let rows
  try {
    rows = JSON.parse(readFileSync(path, 'utf8'))
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

if (failed > 0 && !REPORT_ONLY) {
  console.error(`\n${failed} of ${ARTIFACTS.length} artifacts are stale or unreadable.`)
  process.exit(1)
}
console.log(
  `\n${ARTIFACTS.length - failed} of ${ARTIFACTS.length} artifacts current.` +
    (failed > 0 ? ' (--report-only: not failing)' : ''),
)
