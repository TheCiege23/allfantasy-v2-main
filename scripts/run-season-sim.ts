/**
 * CLI: seeded, bot-driven season simulations over the real canonical league runtimes.
 *
 *   npm run sim:season                                    # 1 redraft league, seed 1
 *   npm run sim:season -- --seed=42 --format=guillotine
 *   npm run sim:season -- --seed=nightly --leagues=50     # batch: alternates redraft / guillotine
 *   npm run sim:season -- --seed=42 --json --out=reports/season-sim/latest.json
 *
 * Exit 0 = every invariant held in every league. Exit 1 = at least one violation; each one prints its
 * seed, format, week, phase and a `reproduce` command that replays that exact season.
 *
 * The simulator is pure — no database, no providers, no notifications. As a backstop, DATABASE_URL is
 * pinned to an unreachable sentinel BEFORE anything is imported: `@prisma/client` loads `.env` on import,
 * and in this repo `.env` points at production. If anything in the import graph ever reaches for the
 * database, it fails at 127.0.0.1:1 instead of touching real data.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

process.env.DATABASE_URL = 'postgresql://season-sim:season-sim@127.0.0.1:1/season_sim'
process.env.DIRECT_URL = process.env.DATABASE_URL
process.env.SEASON_SIM = '1'

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function seedArg(raw: string | undefined): number | string {
  if (!raw) return 1
  return /^\d+$/.test(raw) ? Number(raw) : raw
}

async function main(): Promise<number> {
  // Imported only after the env pin above.
  const { runSeasonSim, runSeasonSimBatch } = await import('@/lib/season-sim')
  type Format = 'redraft' | 'guillotine'

  const seed = seedArg(arg('seed'))
  const leagues = Number(arg('leagues') ?? 1)
  const teams = arg('teams') ? Number(arg('teams')) : undefined
  const weeks = arg('weeks') ? Number(arg('weeks')) : undefined
  const format = arg('format') as Format | undefined
  const json = process.argv.includes('--json')
  const out = arg('out')

  const started = Date.now()
  const reports =
    leagues > 1
      ? runSeasonSimBatch({ seed, leagues, formats: format ? [format] : undefined, teamCount: teams })
      : [runSeasonSim({ seed, format, teamCount: teams, regularSeasonWeeks: weeks })]
  const elapsedMs = Date.now() - started
  const failed = reports.filter((report) => report.violations.length > 0)

  const summary = {
    leagues: reports.length,
    failed: failed.length,
    elapsedMs,
    violationCodes: failed
      .flatMap((report) => report.violations.map((violation) => violation.code))
      .reduce<Record<string, number>>((acc, code) => ({ ...acc, [code]: (acc[code] ?? 0) + 1 }), {}),
  }

  if (out) {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify({ summary, reports }, null, 2))
  }

  if (json) {
    console.log(JSON.stringify({ summary, reports }, null, 2))
  } else {
    console.log(`Season sim: ${reports.length - failed.length}/${reports.length} leagues clean in ${elapsedMs} ms`)
    for (const report of reports) {
      const mark = report.violations.length ? 'FAIL' : 'OK  '
      const s = report.signals
      console.log(
        `  [${mark}] ${report.format.padEnd(10)} seed=${String(report.seedInput).padEnd(12)} weeks=${report.weeksSimulated} champion=${report.championRosterId ?? '-'} ` +
          `waivers ${s.waiverClaimsWon}/${s.waiverClaimsSubmitted} won, ${s.waiverClaimsRejectedAtSubmit} rejected; trades ${s.tradesExecuted}/${s.tradesProposed}; ` +
          `inactive starters ${s.inactiveStarterWeeks}`,
      )
      for (const violation of report.violations.slice(0, 10)) {
        console.log(`      ${violation.code} wk${violation.week ?? '-'} ${violation.phase}: ${violation.message}`)
      }
      if (report.violations.length > 10) console.log(`      … ${report.violations.length - 10} more`)
      if (report.violations.length) console.log(`      reproduce: ${report.reproduce}`)
    }
    if (failed.length) console.log(`Violation codes: ${JSON.stringify(summary.violationCodes)}`)
  }
  return failed.length ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error)
    process.exit(2)
  })
