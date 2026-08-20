/**

 * CLI for `runPlayerWeeklyScoreRollup` (Phase 7E / 7F).

 *

 * Usage:

 *   npx tsx scripts/run-player-weekly-score-rollup.ts --leagueId <id> --season 2025 --week 5

 *   npx tsx scripts/run-player-weekly-score-rollup.ts --leagueId <id> --season 2025 --week 5 --write --allowGlobalOverwrite

 *   # If the league has scoring overrides or non-default format, also pass:

 *   npx tsx scripts/run-player-weekly-score-rollup.ts ... --write --allowGlobalOverwrite --allowCustomScoringWrite

 *

 * Default is dry-run (no `--write`). `--write` requires `--allowGlobalOverwrite` (script exits before DB work if missing).

 * See `docs/stat-substrate-ownership.md` Appendix G — global `PlayerWeeklyScore` collision risk.

 */

import { runPlayerWeeklyScoreRollup } from '@/lib/scoring/player-weekly-score-rollup'



function parseArgs(argv: string[]) {

  let leagueId = ''

  let season = NaN

  let week = NaN

  let write = false

  let allowGlobalOverwrite = false

  let allowCustomScoringWrite = false

  for (let i = 2; i < argv.length; i += 1) {

    const a = argv[i]

    if (a === '--leagueId' && argv[i + 1]) {

      leagueId = String(argv[++i]).trim()

      continue

    }

    if (a === '--season' && argv[i + 1]) {

      season = Number.parseInt(String(argv[++i]), 10)

      continue

    }

    if (a === '--week' && argv[i + 1]) {

      week = Number.parseInt(String(argv[++i]), 10)

      continue

    }

    if (a === '--write') {

      write = true

      continue

    }

    if (a === '--dryRun') {

      write = false

      continue

    }

    if (a === '--allowGlobalOverwrite') {

      allowGlobalOverwrite = true

      continue

    }

    if (a === '--allowCustomScoringWrite') {

      allowCustomScoringWrite = true

      continue

    }

  }

  return { leagueId, season, week, write, allowGlobalOverwrite, allowCustomScoringWrite }

}



async function main() {

  const { leagueId, season, week, write, allowGlobalOverwrite, allowCustomScoringWrite } = parseArgs(process.argv)

  if (!leagueId) {

    console.error('Missing --leagueId')

    process.exit(1)

  }

  if (!Number.isFinite(season) || season < 1900) {

    console.error('Missing or invalid --season (calendar year, e.g. 2025)')

    process.exit(1)

  }

  if (!Number.isFinite(week) || week < 1) {

    console.error('Missing or invalid --week')

    process.exit(1)

  }

  if (write && !allowGlobalOverwrite) {

    console.error(

      '[rollup] --write requires --allowGlobalOverwrite (PlayerWeeklyScore is global per player/week/season/sport). See docs/stat-substrate-ownership.md Appendix G.',

    )

    process.exit(2)

  }



  const result = await runPlayerWeeklyScoreRollup({

    leagueId,

    season,

    week,

    write,

    allowGlobalOverwrite: write ? allowGlobalOverwrite : false,

    allowCustomScoringWrite: write ? allowCustomScoringWrite : false,

    jobName: 'scripts/run-player-weekly-score-rollup',

  })



  console.log(JSON.stringify(result, null, 2))

  if (write && result.writeApplied) {

    console.error('[rollup] write mode completed — global row collision risk applies; do not schedule until policy/schema is resolved.')

  } else if (write && !result.writeApplied) {

    console.error('[rollup] write was requested but not applied — check notes / scoringRisk in JSON output.')

    process.exit(2)

  }

}



main().catch((e) => {

  console.error(e)

  process.exit(1)

})

