/**
 * Phase 7I staging-only CLI:
 * - Builds league-scoped weekly score candidates from the existing rollup computation path.
 * - Defaults to dry-run.
 * - Shadow write requires BOTH --shadowWrite and --confirmStaging.
 *
 * Usage:
 *   npm run rollup:league-player-weekly-scores -- --leagueId <id> --season 2026 --week 4 --dryRun
 *   npm run rollup:league-player-weekly-scores -- --leagueId <id> --season 2026 --week 4 --shadowWrite --confirmStaging
 */
import { PrismaLeaguePlayerWeeklyScoreAdapter } from '@/lib/scoring/league-player-weekly-score-prisma-adapter'
import {
  buildLeaguePlayerWeeklyScoreCandidates,
  persistLeaguePlayerWeeklyScoreCandidates,
  type ShadowWriteTelemetryPayload,
} from '@/lib/scoring/league-player-weekly-score-store'
import { runPlayerWeeklyScoreRollup } from '@/lib/scoring/player-weekly-score-rollup'

function logShadowTelemetry(event: string, payload: ShadowWriteTelemetryPayload) {
  console.log(
    JSON.stringify({
      event,
      subsystem: 'league_player_weekly_score_shadow',
      ...payload,
    }),
  )
}

function parseArgs(argv: string[]) {
  let leagueId = ''
  let season = Number.NaN
  let week = Number.NaN
  let shadowWrite = false
  let confirmStaging = false
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--leagueId' && argv[i + 1]) {
      leagueId = String(argv[++i]).trim()
      continue
    }
    if (arg === '--season' && argv[i + 1]) {
      season = Number.parseInt(String(argv[++i]), 10)
      continue
    }
    if (arg === '--week' && argv[i + 1]) {
      week = Number.parseInt(String(argv[++i]), 10)
      continue
    }
    if (arg === '--shadowWrite') {
      shadowWrite = true
      continue
    }
    if (arg === '--confirmStaging') {
      confirmStaging = true
      continue
    }
    if (arg === '--dryRun') {
      shadowWrite = false
      continue
    }
  }
  return { leagueId, season, week, shadowWrite, confirmStaging }
}

async function main() {
  const { leagueId, season, week, shadowWrite, confirmStaging } = parseArgs(process.argv)
  if (!leagueId) {
    console.error('Missing --leagueId')
    process.exit(1)
  }
  if (!Number.isFinite(season) || season < 1900) {
    console.error('Missing or invalid --season (calendar year, e.g. 2026)')
    process.exit(1)
  }
  if (!Number.isFinite(week) || week < 1) {
    console.error('Missing or invalid --week')
    process.exit(1)
  }

  if (shadowWrite && !confirmStaging) {
    console.error(
      '[league-shadow-rollup] blocked: --shadowWrite requires --confirmStaging. Staging-only writes are never enabled by default.',
    )
    process.exit(2)
  }

  console.error(
    shadowWrite
      ? '[league-shadow-rollup] WARNING: staging shadow write enabled for LeaguePlayerWeeklyScore only.'
      : '[league-shadow-rollup] Dry-run mode (default): no writes will be executed.',
  )

  const rollupResult = await runPlayerWeeklyScoreRollup({
    leagueId,
    season,
    week,
    write: false,
    jobName: 'scripts/run-league-player-weekly-score-rollup:build-candidates',
  })

  const built = buildLeaguePlayerWeeklyScoreCandidates(
    rollupResult.candidateRows.map((row) => ({
      leagueId,
      playerId: row.playerId,
      season,
      week,
      sport: row.sport,
      fantasyPts: row.computedFantasyPts,
      stats: {
        source: 'player_weekly_score_rollup_candidate',
        gamesMerged: row.gamesMerged,
        deltaVsGlobal: row.delta,
      },
      isFinalized: row.existingIsFinalized,
      source: 'rollup_pgs_shadow',
      lineageJobName: 'scripts/run-league-player-weekly-score-rollup',
      rollupVersion: 1,
      scoringProfileId: null,
      scoringRulesHash: null,
    })),
  )

  const shadowResult = await persistLeaguePlayerWeeklyScoreCandidates({
    candidates: built.candidates,
    write: shadowWrite,
    allowShadowWrite: shadowWrite && confirmStaging,
    adapter: shadowWrite && confirmStaging ? new PrismaLeaguePlayerWeeklyScoreAdapter() : undefined,
    jobName: 'scripts/run-league-player-weekly-score-rollup',
    leagueId,
    season,
    week,
    telemetry: logShadowTelemetry,
  })

  console.log(
    JSON.stringify(
      {
        leagueId,
        season,
        week,
        shadowWriteRequested: shadowWrite,
        confirmStaging,
        rollupSummary: {
          candidateRows: rollupResult.candidateRows.length,
          missingPlayers: rollupResult.missingPlayers.length,
          notes: rollupResult.notes,
        },
        shadowSummary: shadowResult,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

