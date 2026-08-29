#!/usr/bin/env node
/**
 * Fails when `data/nfl-draft-capital.json` is missing the most recent completed NFL draft.
 *
 * ⚠ A CRON CANNOT REFRESH THIS ARTIFACT, WHICH IS WHY THIS CHECK EXISTS INSTEAD.
 * `lib/idp-projections/draftCapital.ts` STATICALLY IMPORTS the file, so it is bundled at build
 * time. A scheduled job on the deployed app would write to an ephemeral filesystem and change
 * nothing that is running. The only thing that updates it is a human running
 * `npx tsx scripts/derive-nfl-draft-capital.ts` and committing the result.
 *
 * So the job here is not to refresh, it is to REFUSE TO BE QUIET. The failure this guards
 * against is the `ingestCFBDStats` one: a writer nobody scheduled, feeding a surface that keeps
 * serving stale data and looks correct while doing it. An artifact that silently ages out after
 * every April draft is the same shape. This turns that silence into a red run with a date on it.
 *
 * Deliberately needs NO database and NO network — it reads the committed file and a clock. That
 * keeps it runnable in CI, by hand, and inside any workflow without secrets.
 *
 *   node scripts/check-draft-capital-freshness.mjs
 *   node scripts/check-draft-capital-freshness.mjs --report-only   # never exits non-zero
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ARTIFACT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'nfl-draft-capital.json')
const REPORT_ONLY = process.argv.includes('--report-only')

/**
 * The NFL draft runs in late April. A month of slack means a run on 1 May does not go red while
 * the release is still being published, and the artifact is still flagged well inside the season.
 */
const DRAFT_COMPLETE_MONTH = 5 // June (0-indexed), i.e. from 1 June the spring draft is old news

function expectedLatestDraftYear(now) {
  const y = now.getUTCFullYear()
  return now.getUTCMonth() >= DRAFT_COMPLETE_MONTH ? y : y - 1
}

function main() {
  let rows
  try {
    rows = JSON.parse(readFileSync(ARTIFACT, 'utf8'))
  } catch (err) {
    console.error(`draft-capital freshness: cannot read ${ARTIFACT}`)
    console.error(`  ${err.message}`)
    process.exit(REPORT_ONLY ? 0 : 1)
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    console.error('draft-capital freshness: artifact is empty or not an array.')
    process.exit(REPORT_ONLY ? 0 : 1)
  }

  const years = rows.map((r) => Number(r?.draftYear)).filter(Number.isFinite)
  const latest = Math.max(...years)
  const now = new Date()
  const expected = expectedLatestDraftYear(now)

  const byYear = new Map()
  for (const y of years) byYear.set(y, (byYear.get(y) ?? 0) + 1)
  const recent = [...byYear.entries()].sort((a, b) => b[0] - a[0]).slice(0, 4)

  console.log(`draft-capital artifact: ${rows.length} rows, draft years ${Math.min(...years)}-${latest}`)
  console.log(`  most recent years: ${recent.map(([y, n]) => `${y}=${n}`).join('  ')}`)
  console.log(`  expected latest completed draft: ${expected}`)

  if (latest >= expected) {
    console.log('OK — the artifact includes the most recent completed draft.')
    return
  }

  console.error('')
  console.error(`STALE: the artifact stops at ${latest}, but the ${expected} draft has happened.`)
  console.error('')
  console.error('Nothing refreshes this automatically — the file is statically imported and')
  console.error('bundled at build time. Regenerate and commit it:')
  console.error('')
  console.error('    npx tsx scripts/derive-nfl-draft-capital.ts')
  console.error('    git add data/nfl-draft-capital.json && git commit')
  console.error('')
  console.error('Until then every defender drafted in ' + expected + ' reads as undrafted, which')
  console.error('is indistinguishable from genuinely undrafted in every surface that shows it.')
  process.exit(REPORT_ONLY ? 0 : 1)
}

main()
