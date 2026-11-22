/**
 * The generic weekly processor seats a best ball team on the LEAGUE'S roster slots — the seats matchup
 * scoring uses (`buildBestBallSlots`) — not a hard-coded sport default (audit 2026-11-06, finding #17).
 *
 * The fixture is an NFL superflex best ball league. With its own slots, both quarterbacks start (QB and
 * SF); with the sport default (no superflex seat) the second quarterback would be benched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLeagueFindUnique = vi.hoisted(() => vi.fn())
const mockWeeklyScoreCreateMany = vi.hoisted(() => vi.fn())

const POINTS: Record<string, number> = { QB_A: 30, QB_B: 26, RB_1: 20, WR_1: 6 }
const POSITION: Record<string, string> = { QB_A: 'QB', QB_B: 'QB', RB_1: 'RB', WR_1: 'WR' }

const tx = vi.hoisted(() => ({
  weeklyScore: { deleteMany: vi.fn(), createMany: (...a: unknown[]) => mockWeeklyScoreCreateMany(...a) },
  teamWeekResult: { create: vi.fn(), deleteMany: vi.fn() },
  playerWeeklyScore: {
    findUnique: vi.fn(async (args: { where: { playerId_week_season_sport: { playerId: string } } }) => ({
      stats: { id: args.where.playerId_week_season_sport.playerId },
      isFinalized: true,
    })),
  },
  sportsPlayer: { findUnique: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique, findMany: vi.fn().mockResolvedValue([]) },
    weeklyScore: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]) },
    teamWeekResult: { findMany: vi.fn().mockResolvedValue([]) },
    roster: { findMany: vi.fn().mockResolvedValue([]) },
    redraftMatchup: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  },
}))
vi.mock('@/server/services/matchupEngine', () => ({ resolveMatchupOutcomesForWeek: vi.fn() }))
vi.mock('@/server/services/standingsEngine', () => ({ recomputeStandingsForSeason: vi.fn() }))
vi.mock('@/server/services/roundRobinSchedule', () => ({ buildRoundRobinPairsForWeek: vi.fn(() => new Map()) }))
vi.mock('@/lib/multi-sport/MultiSportScoringResolver', () => ({ resolveScoringRulesForLeague: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/waiver-wire/roster-utils', () => ({ getRosterPlayerIds: () => ['QB_A', 'QB_B', 'RB_1', 'WR_1'] }))
vi.mock('@/lib/scoring-engine/rosterLineup', () => ({ getStarterPlayerIdsForScoring: () => [] }))
vi.mock('@/server/services/scoringEngine', () => ({
  computePlayerFantasyPointsPipeline: ({ stats }: { stats: { id: string } }) => ({ points: POINTS[stats.id] ?? 0, statLine: {} }),
}))
vi.mock('@/lib/guillotine/guillotineGuard', () => ({
  isRosterChopped: vi.fn().mockResolvedValue(false),
  getChoppedRosterIds: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/survivor/SurvivorRosterState', () => ({ isRosterCurrentlyEliminated: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/realtime-events/realtimeEventService', () => ({ publishMatchupLiveTickDebounced: vi.fn() }))

import { processLeagueWeek } from '@/server/services/weeklyProcessor'

beforeEach(() => {
  vi.clearAllMocks()
  tx.sportsPlayer.findUnique.mockImplementation(async (args: { where: { id: string } }) => ({
    name: args.where.id,
    position: POSITION[args.where.id],
    team: 'KC',
  }))
  mockLeagueFindUnique.mockResolvedValue({
    id: 'lg1',
    // Imported: the processor writes per-player WeeklyScore and stops — enough to read the lineup.
    platform: 'sleeper',
    sport: 'NFL',
    settings: { roster: { config: { sections: [{ key: 'primary', slots: { QB: 1, SUPERFLEX: 1, BN: 6 } }] } } },
    season: 2026,
    bestBallMode: true,
    bbMatchupFormat: 'h2h',
    leagueVariant: null,
    rosters: [{ id: 'r1', playerData: {} }],
  })
})

describe('processLeagueWeek — best ball seats the league slots', () => {
  it('starts both quarterbacks in a superflex league (QB + SF), benching the higher-scoring RB', async () => {
    await processLeagueWeek({ leagueId: 'lg1', season: 2026, week: 3 })
    const rows = (mockWeeklyScoreCreateMany.mock.calls[0]![0] as { data: Array<{ playerId: string; isStarter: boolean; statLine: { bestBallSlot?: string | null } }> }).data
    const starters = rows.filter((r) => r.isStarter).map((r) => r.playerId).sort()
    expect(starters).toEqual(['QB_A', 'QB_B'])
    expect(rows.find((r) => r.playerId === 'RB_1')?.isStarter).toBe(false)
    expect(rows.filter((r) => r.isStarter).map((r) => r.statLine.bestBallSlot).sort()).toEqual(['QB', 'SF'])
  })
})
