import { PrismaLeaguePlayerWeeklyScoreAdapter } from '@/lib/scoring/league-player-weekly-score-prisma-adapter'
import {
  buildLeagueScoreCanarySummary,
  evaluateLeagueScoreParityGate,
  resolveCanaryShadowWrite,
} from '@/lib/scoring/league-player-weekly-score-canary'
import { assessStagingEnvironment } from '@/lib/scoring/staging-environment-guard'
import {
  buildLeaguePlayerWeeklyScoreCandidates,
  persistLeaguePlayerWeeklyScoreCandidates,
  type ShadowWriteTelemetryPayload,
} from '@/lib/scoring/league-player-weekly-score-store'
import { runPlayerWeeklyScoreRollup } from '@/lib/scoring/player-weekly-score-rollup'
import { runStatDriftProbe } from '@/lib/scoring/stat-drift-probe'

type CanaryArgs = {
  leagueId: string
  season: number
  week: number
  shadowWrite: boolean
  confirmStaging: boolean
  scoringRulesHashMissingDocumented: boolean
  expectedMissingPlayerGameStatCount: number
  expectedDuplicateInputCount: number
  unexpectedGlobalFallbackCount: number
}

function parseBooleanFlag(arg: string | undefined): boolean {
  if (!arg) return false
  return ['1', 'true', 'yes'].includes(arg.trim().toLowerCase())
}

function parseArgs(argv: string[]): CanaryArgs {
  let leagueId = ''
  let season = Number.NaN
  let week = Number.NaN
  let shadowWrite = false
  let confirmStaging = false
  let scoringRulesHashMissingDocumented = false
  let expectedMissingPlayerGameStatCount = 0
  let expectedDuplicateInputCount = 0
  let unexpectedGlobalFallbackCount = 0

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
    if (arg === '--scoringRulesHashMissingDocumented') {
      scoringRulesHashMissingDocumented = true
      continue
    }
    if (arg === '--expectedMissingPlayerGameStatCount' && argv[i + 1]) {
      expectedMissingPlayerGameStatCount = Number.parseInt(String(argv[++i]), 10)
      continue
    }
    if (arg === '--expectedDuplicateInputCount' && argv[i + 1]) {
      expectedDuplicateInputCount = Number.parseInt(String(argv[++i]), 10)
      continue
    }
    if (arg === '--unexpectedGlobalFallbackCount' && argv[i + 1]) {
      unexpectedGlobalFallbackCount = Number.parseInt(String(argv[++i]), 10)
      continue
    }
    if (arg === '--dryRun') {
      shadowWrite = false
      continue
    }
    if (arg === '--documentHashMissing' && argv[i + 1]) {
      scoringRulesHashMissingDocumented = parseBooleanFlag(argv[++i])
      continue
    }
  }

  return {
    leagueId,
    season,
    week,
    shadowWrite,
    confirmStaging,
    scoringRulesHashMissingDocumented,
    expectedMissingPlayerGameStatCount: Number.isFinite(expectedMissingPlayerGameStatCount)
      ? Math.max(0, expectedMissingPlayerGameStatCount)
      : 0,
    expectedDuplicateInputCount: Number.isFinite(expectedDuplicateInputCount)
      ? Math.max(0, expectedDuplicateInputCount)
      : 0,
    unexpectedGlobalFallbackCount: Number.isFinite(unexpectedGlobalFallbackCount)
      ? Math.max(0, unexpectedGlobalFallbackCount)
      : 0,
  }
}

function logShadowTelemetry(event: string, payload: ShadowWriteTelemetryPayload) {
  console.log(
    JSON.stringify({
      event,
      subsystem: 'league_player_weekly_score_shadow',
      ...payload,
    }),
  )
}

async function main() {
  const args = parseArgs(process.argv)

  if (!args.leagueId) {
    console.error('Missing --leagueId')
    process.exit(1)
  }
  if (!Number.isFinite(args.season) || args.season < 1900) {
    console.error('Missing or invalid --season (calendar year, e.g. 2026)')
    process.exit(1)
  }
  if (!Number.isFinite(args.week) || args.week < 1) {
    console.error('Missing or invalid --week')
    process.exit(1)
  }

  const stagingAssessment = assessStagingEnvironment(process.env)
  const writeMode = resolveCanaryShadowWrite({
    shadowWrite: args.shadowWrite,
    confirmStaging: args.confirmStaging,
    stagingConfirmed: stagingAssessment.confirmed,
  })

  if (writeMode.writeRequested && !writeMode.writeAllowed) {
    console.error(
      '[league-score-canary] blocked: shadow write requires --confirmStaging and a positively confirmed staging environment. Dry-run is always safe and remains default.',
    )
    console.error(
      JSON.stringify(
        {
          event: 'staging_environment_guard_blocked_write',
          stagingAssessment,
          writeMode,
        },
        null,
        2,
      ),
    )
    process.exit(2)
  }

  console.error(
    args.shadowWrite
      ? '[league-score-canary] WARNING: staging shadow write enabled for LeaguePlayerWeeklyScore only.'
      : '[league-score-canary] Dry-run mode: no writes will be executed.',
  )

  const rollupResult = await runPlayerWeeklyScoreRollup({
    leagueId: args.leagueId,
    season: args.season,
    week: args.week,
    write: false,
    jobName: 'scripts/run-league-score-canary:build-candidates',
  })

  const built = buildLeaguePlayerWeeklyScoreCandidates(
    rollupResult.candidateRows.map((row) => ({
      leagueId: args.leagueId,
      playerId: row.playerId,
      season: args.season,
      week: args.week,
      sport: row.sport,
      fantasyPts: row.computedFantasyPts,
      stats: {
        source: 'player_weekly_score_rollup_candidate',
        gamesMerged: row.gamesMerged,
        deltaVsGlobal: row.delta,
      },
      isFinalized: row.existingIsFinalized,
      source: 'rollup_pgs_shadow',
      lineageJobName: 'scripts/run-league-score-canary',
      rollupVersion: 1,
      scoringProfileId: null,
      scoringRulesHash: null,
    })),
  )

  const shadowResult = await persistLeaguePlayerWeeklyScoreCandidates({
    candidates: built.candidates,
    write: writeMode.writeRequested,
    allowShadowWrite: writeMode.writeAllowed,
    adapter: writeMode.writeAllowed ? new PrismaLeaguePlayerWeeklyScoreAdapter() : undefined,
    jobName: 'scripts/run-league-score-canary',
    leagueId: args.leagueId,
    season: args.season,
    week: args.week,
    telemetry: logShadowTelemetry,
  })

  const driftResult = await runStatDriftProbe({
    leagueId: args.leagueId,
    season: args.season,
    week: args.week,
    jobName: 'scripts/run-league-score-canary',
  })

  const summary = buildLeagueScoreCanarySummary({
    leagueId: args.leagueId,
    season: args.season,
    week: args.week,
    rollup: rollupResult,
    shadow: shadowResult,
    drift: driftResult,
  })
  const parity = evaluateLeagueScoreParityGate({
    summary,
    scoringRulesHashMissingDocumented: args.scoringRulesHashMissingDocumented,
    expectedMissingPlayerGameStatCount: args.expectedMissingPlayerGameStatCount,
    expectedDuplicateInputCount: args.expectedDuplicateInputCount,
    unexpectedGlobalFallbackCount: args.unexpectedGlobalFallbackCount,
  })

  console.log(
    JSON.stringify(
      {
        leagueId: args.leagueId,
        season: args.season,
        week: args.week,
        shadowWriteRequested: args.shadowWrite,
        confirmStaging: args.confirmStaging,
        stagingAssessment,
        writeMode,
        summary,
        parity,
      },
      null,
      2,
    ),
  )

  if (!parity.pass) {
    process.exit(3)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
