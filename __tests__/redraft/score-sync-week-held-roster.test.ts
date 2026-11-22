/**
 * The score sync refreshes every player a best ball week COUNTS, not only the current roster (2026-11-07).
 *
 * Best ball scores the week as held (lib/redraft/bestBallWeekRoster.ts): a player dropped after his game,
 * and the whole roster of a Guilly team chopped after the week, still count for it. The sync used to read
 * `droppedAt: null` only, so a stat correction or a late stat line for exactly those players was never
 * written, and the week went on counting the stale score. It now adds them through the same loader the
 * scorer and the finalizer use. No provider is called: the NFL week fetcher is injected.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  adminAuditLog: { create: vi.fn() },
  league: { findFirst: vi.fn(), findUnique: vi.fn() },
  playerGameLogCache: { findMany: vi.fn() },
  playerGameStat: { findMany: vi.fn() },
  playerIdentityMap: { findFirst: vi.fn() },
  playerWeeklyScore: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  redraftRoster: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  sportsGame: { findMany: vi.fn() },
  sportsPlayer: { findFirst: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const weekRoster = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/lib/redraft/bestBallWeekRoster', () => ({ loadBestBallWeekRosterRows: weekRoster.load }))

// Static, so the (large) module graph loads during collection rather than inside the first test's timeout.
import { syncPlayerWeeklyScoresForRedraftSeason } from '@/lib/redraft/playerWeeklyScoreService'

const SEASON = { id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, currentWeek: 5 }
const DROPPED_AT = new Date('2026-10-07T15:00:00Z')

function row(playerId: string, droppedAt: Date | null = null, rosterId = 'roster-1') {
  return { playerId, playerName: `P${playerId}`, position: 'WR', sport: 'NFL', team: 'KC', rosterId, droppedAt }
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.redraftSeason.findFirst.mockResolvedValue(SEASON)
  prismaMock.league.findFirst.mockResolvedValue({ id: 'league-1', settings: {} })
  // Native (null platform -> Sleeper id space), best ball.
  prismaMock.league.findUnique.mockResolvedValue({ platform: null, survivorMode: false, settings: {}, bestBallMode: true })
  prismaMock.redraftRoster.findMany.mockResolvedValue([{ id: 'roster-1' }, { id: 'roster-chopped' }])
  // The current roster: one player still held.
  prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([row('1001')])
  prismaMock.playerGameLogCache.findMany.mockResolvedValue([])
  prismaMock.sportsGame.findMany.mockResolvedValue([])
  prismaMock.playerWeeklyScore.upsert.mockResolvedValue({})
  prismaMock.adminAuditLog.create.mockResolvedValue({})
  // The week as held: 1001 (still on), 2002 (dropped after his game), 3003 (a chopped team's player).
  weekRoster.load.mockResolvedValue([row('1001'), row('2002', DROPPED_AT), row('3003', DROPPED_AT, 'roster-chopped')])
})

const fetcher = () => vi.fn(async ({ playerIds }: { playerIds: readonly string[] }) => new Map(playerIds.map((id) => [id, { rec_yd: 50 }])))

async function runSync(fetchNflWeekStats: ReturnType<typeof fetcher>) {
  return syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 'season-1', week: 5, actorId: 'test', fetchNflWeekStats })
}

const upsertedIds = () =>
  prismaMock.playerWeeklyScore.upsert.mock.calls.map((c) => c[0].where.playerId_week_season_sport.playerId).sort()

describe('score sync — the best ball week as held', () => {
  it('🛑 refreshes a player dropped after his game and a chopped team’s player, through the week-roster loader', async () => {
    const f = fetcher()
    const summary = await runSync(f)

    expect(weekRoster.load).toHaveBeenCalledWith(prismaMock, {
      rosterIds: ['roster-1', 'roster-chopped'],
      sport: 'NFL',
      season: 2026,
      week: 5,
      platform: null,
    })
    expect([...f.mock.calls[0]![0].playerIds].sort()).toEqual(['1001', '2002', '3003'])
    expect(upsertedIds()).toEqual(['1001', '2002', '3003'])
    expect(summary.weekHeldDroppedPlayers).toBe(2)
    expect(summary.rosteredPlayers).toBe(3)
  })

  it('a Guilly league its commissioner made best ball is read the same way', async () => {
    prismaMock.league.findUnique.mockResolvedValue({ platform: null, survivorMode: false, settings: { best_ball: true }, bestBallMode: false, guillotineMode: true })
    await runSync(fetcher())
    expect(weekRoster.load).toHaveBeenCalledTimes(1)
    expect(upsertedIds()).toEqual(['1001', '2002', '3003'])
  })

  it('never doubles a player: one still held, or now on another roster, is not added again', async () => {
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([row('1001'), row('2002', null, 'roster-other')])
    weekRoster.load.mockResolvedValue([row('1001'), row('2002', DROPPED_AT), row('3003', DROPPED_AT), row('3003', DROPPED_AT, 'roster-chopped')])
    const f = fetcher()
    const summary = await runSync(f)
    expect([...f.mock.calls[0]![0].playerIds].sort()).toEqual(['1001', '2002', '3003'])
    expect(upsertedIds()).toEqual(['1001', '2002', '3003'])
    expect(summary.weekHeldDroppedPlayers).toBe(1)
  })

  it('a league that is not best ball keeps the current-roster read and never calls the loader', async () => {
    prismaMock.league.findUnique.mockResolvedValue({ platform: null, survivorMode: false, settings: {}, bestBallMode: false })
    const summary = await runSync(fetcher())
    expect(weekRoster.load).not.toHaveBeenCalled()
    expect(upsertedIds()).toEqual(['1001'])
    expect(summary.weekHeldDroppedPlayers).toBeUndefined()
  })

  it('an unreadable week roster never fails the sync: the current roster is still refreshed', async () => {
    weekRoster.load.mockRejectedValue(new Error('schedule unreadable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const summary = await runSync(fetcher())
    expect(upsertedIds()).toEqual(['1001'])
    expect(summary.weekHeldDroppedPlayers).toBeUndefined()
    warn.mockRestore()
  })
})
