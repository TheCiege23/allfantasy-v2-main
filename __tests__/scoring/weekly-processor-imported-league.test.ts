/**
 * `processLeagueWeek` must not invent a schedule for an IMPORTED league.
 *
 * The batch driver is filtered (see weekly-processor-native-only.test.ts), but `processLeagueWeek`
 * is also reachable per league from `/api/leagues/[leagueId]/scoring/process-week`,
 * `queueLeagueScoringRecalcAfterRulesChange` and `reprocessWeekAfterStatCorrection`. None of those
 * consults `League.platform`, so the guard has to live in the function itself.
 *
 * What must NOT happen for an import: a NEW `TeamWeekResult` row. Its `opponentRosterId` comes
 * from `buildRoundRobinPairsForWeek`, a synthetic circle-method pairing over sorted roster ids —
 * the real schedule is on the host platform and this pipeline never reads it.
 *
 * What MUST still happen: the week is PURGED. Nothing else in the codebase writes that table, so
 * any row an import holds came from a run predating this guard, and this is what clears it.
 *
 * 🛑 AND `recomputeStandingsForSeason` MUST BE SKIPPED TOO — the least obvious half. It seeds an
 * aggregate for EVERY roster at 0-0-0 and upserts `FantasyStanding` for all of them whether or not
 * any `TeamWeekResult` exists. Skipping only the writes and still calling it would swap invented
 * opponents for an invented 0-0 record — a test that checked only `teamWeekResult.create` would
 * pass while the league's standings were still being overwritten.
 *
 * What must still happen: per-player `WeeklyScore`. That is the half worth keeping, and asserting
 * it pins the guard as a SPLIT rather than a blanket refusal — a `throw` at the top of the
 * function would satisfy every negative assertion here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLeagueFindUnique = vi.hoisted(() => vi.fn())
const mockWeeklyScoreCreateMany = vi.hoisted(() => vi.fn())
const mockWeeklyScoreDeleteMany = vi.hoisted(() => vi.fn())
const mockTwrCreate = vi.hoisted(() => vi.fn())
const mockTwrDeleteMany = vi.hoisted(() => vi.fn())
const mockResolveMatchupOutcomes = vi.hoisted(() => vi.fn())
const mockRecomputeStandings = vi.hoisted(() => vi.fn())
const mockBuildRoundRobinPairs = vi.hoisted(() => vi.fn(() => new Map<string, string | null>()))

const tx = {
  weeklyScore: { deleteMany: mockWeeklyScoreDeleteMany, createMany: mockWeeklyScoreCreateMany },
  teamWeekResult: { create: mockTwrCreate, deleteMany: mockTwrDeleteMany },
  playerWeeklyScore: { findUnique: vi.fn().mockResolvedValue({ stats: { pts: 10 } }) },
  sportsPlayer: { findUnique: vi.fn().mockResolvedValue({ name: 'A', position: 'RB', team: 'KC' }) },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique, findMany: vi.fn().mockResolvedValue([]) },
    weeklyScore: { count: vi.fn().mockResolvedValue(1) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  },
}))
vi.mock('@/server/services/matchupEngine', () => ({
  resolveMatchupOutcomesForWeek: mockResolveMatchupOutcomes,
}))
vi.mock('@/server/services/standingsEngine', () => ({
  recomputeStandingsForSeason: mockRecomputeStandings,
}))
vi.mock('@/server/services/roundRobinSchedule', () => ({
  buildRoundRobinPairsForWeek: mockBuildRoundRobinPairs,
}))
vi.mock('@/lib/multi-sport/MultiSportScoringResolver', () => ({
  resolveScoringRulesForLeague: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/waiver-wire/roster-utils', () => ({ getRosterPlayerIds: () => ['p1'] }))
vi.mock('@/lib/scoring-engine/rosterLineup', () => ({ getStarterPlayerIdsForScoring: () => ['p1'] }))
vi.mock('@/server/services/scoringEngine', () => ({
  computePlayerFantasyPointsPipeline: () => ({ points: 12.5, statLine: {} }),
}))
vi.mock('@/lib/guillotine/guillotineGuard', () => ({ isRosterChopped: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/survivor/SurvivorRosterState', () => ({
  isRosterCurrentlyEliminated: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/realtime-events/realtimeEventService', () => ({
  publishMatchupLiveTickDebounced: vi.fn(),
}))

import { processLeagueWeek } from '@/server/services/weeklyProcessor'

function leagueRow(platform: string) {
  return {
    id: 'lg1',
    platform,
    sport: 'NFL',
    settings: null,
    season: 2026,
    bestBallMode: false,
    bbMatchupFormat: 'h2h',
    leagueVariant: null,
    rosters: [{ id: 'r1', playerData: {} }, { id: 'r2', playerData: {} }],
  }
}

describe('processLeagueWeek — imported leagues get scores but not a schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildRoundRobinPairs.mockReturnValue(new Map())
  })

  it.each(['sleeper', 'ESPN', 'yahoo', 'mfl', 'some-provider-added-next-year'])(
    'writes no TeamWeekResult and no standings for platform %s',
    async (platform) => {
      mockLeagueFindUnique.mockResolvedValue(leagueRow(platform))

      const result = await processLeagueWeek({ leagueId: 'lg1', season: 2026, week: 3 })

      // The fabrication itself.
      expect(mockTwrCreate).not.toHaveBeenCalled()
      // Not even the synthetic pairing is computed.
      expect(mockBuildRoundRobinPairs).not.toHaveBeenCalled()
      // ...but the week IS purged. Nothing else writes TeamWeekResult, so any row an import
      // holds is a fabrication from before this guard existed, and this is what clears it.
      expect(mockTwrDeleteMany).toHaveBeenCalledTimes(1)
      expect(mockTwrDeleteMany).toHaveBeenCalledWith({
        where: { leagueId: 'lg1', season: 2026, week: 3 },
      })
      // The non-obvious half: standings would otherwise be upserted at 0-0-0.
      expect(mockRecomputeStandings).not.toHaveBeenCalled()
      expect(mockResolveMatchupOutcomes).not.toHaveBeenCalled()

      // ...but per-player scoring still ran. Without this the guard could be a bare `throw`.
      expect(mockWeeklyScoreCreateMany).toHaveBeenCalledTimes(1)
      expect(result.matchupsWritten).toBe(false)
      expect(result.rostersProcessed).toBe(2)
    },
  )

  it.each(['allfantasy', 'manual', '', 'AllFantasy'])(
    'still writes the full matchup + standings pipeline for native platform "%s"',
    async (platform) => {
      mockLeagueFindUnique.mockResolvedValue(leagueRow(platform))

      const result = await processLeagueWeek({ leagueId: 'lg1', season: 2026, week: 3 })

      expect(mockBuildRoundRobinPairs).toHaveBeenCalledWith(['r1', 'r2'], 3)
      expect(mockTwrDeleteMany).toHaveBeenCalledTimes(1)
      expect(mockTwrCreate).toHaveBeenCalledTimes(2)
      expect(mockResolveMatchupOutcomes).toHaveBeenCalledWith('lg1', 2026, 3)
      expect(mockRecomputeStandings).toHaveBeenCalledWith('lg1', 2026)
      expect(mockWeeklyScoreCreateMany).toHaveBeenCalledTimes(1)
      expect(result.matchupsWritten).toBe(true)
    },
  )
})
