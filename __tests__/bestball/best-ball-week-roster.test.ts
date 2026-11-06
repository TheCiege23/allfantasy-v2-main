import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 BEST BALL SCORED THE CURRENT ROSTER. A Guilly chop is scored 24–48h after its week, so a free
 * agent added in that gap counted for a week already played, and a player dropped in it was erased
 * from the week he earned. These pin the replacement rule (lib/redraft/bestBallWeekRoster.ts): a
 * player counts for whoever held him at his first game lock of the week.
 */

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
  roster: { findMany: vi.fn(async () => []) },
  afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
}))
const kickoffMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/redraft/lineupLock', async (orig) => ({
  ...(await orig<typeof import('@/lib/redraft/lineupLock')>()),
  buildWeekKickoffMap: kickoffMock,
}))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import {
  clearBestBallKickoffCache,
  heldAtLock,
  loadBestBallWeekRosterRows,
  selectBestBallWeekRows,
  type BestBallRosterRow,
} from '@/lib/redraft/bestBallWeekRoster'
import { calculateScoreFromSportConfig, scoreRosterForWeek } from '@/lib/redraft/scoringEngine'

const T = (iso: string) => new Date(iso)
// Week: Thursday night game first; the player's own team plays Sunday 1pm.
const THU = T('2026-10-01T00:15:00Z')
const SUN = T('2026-10-04T17:00:00Z')
const KICKOFFS = { byTeam: new Map([['KC', SUN], ['DAL', THU]]), firstKickoff: THU }
const PRESEASON = T('2026-08-30T12:00:00Z')

const row = (o: Partial<BestBallRosterRow> & { playerId: string }): BestBallRosterRow => ({
  team: 'KC', addedAt: PRESEASON, droppedAt: null, acquisitionType: 'waiver', isKept: false, ...o,
})

describe('who held the player at his lock', () => {
  it('a drafted player counts; so does one added before his own game, even after the week began', () => {
    expect(heldAtLock(row({ playerId: 'd', acquisitionType: 'drafted' }), SUN)).toBe(true)
    // Added Friday, after Thursday's game but before his team's Sunday kickoff.
    expect(selectBestBallWeekRows('NFL', [row({ playerId: 'fri', addedAt: T('2026-10-02T15:00:00Z') })], KICKOFFS)).toHaveLength(1)
  })

  it('an add at or after his lock counts from next week — no points from games already played', () => {
    expect(heldAtLock(row({ playerId: 'late', addedAt: SUN }), SUN)).toBe(false)
    expect(heldAtLock(row({ playerId: 'mon', addedAt: T('2026-10-06T03:00:00Z') }), SUN)).toBe(false)
  })

  it('a drop after his lock still counts this week; a drop before it does not', () => {
    expect(heldAtLock(row({ playerId: 'x', droppedAt: T('2026-10-05T12:00:00Z') }), SUN)).toBe(true)
    expect(heldAtLock(row({ playerId: 'y', droppedAt: T('2026-10-03T12:00:00Z') }), SUN)).toBe(false)
  })

  it('drafted and kept players are held from season start whatever their row timestamp says', () => {
    const lateWrite = T('2026-10-04T18:00:00Z')
    expect(heldAtLock(row({ playerId: 'd', acquisitionType: 'drafted', addedAt: lateWrite }), SUN)).toBe(true)
    expect(heldAtLock(row({ playerId: 'k', acquisitionType: 'waiver', isKept: true, addedAt: lateWrite }), SUN)).toBe(true)
  })

  it('a player moved between teams around his lock scores for exactly one of them', () => {
    const drop = T('2026-10-05T12:00:00Z') // Monday, after his Sunday game
    const teamA = selectBestBallWeekRows('NFL', [row({ playerId: 'p', droppedAt: drop })], KICKOFFS)
    const teamB = selectBestBallWeekRows('NFL', [row({ playerId: 'p', addedAt: drop })], KICKOFFS)
    expect(teamA.length + teamB.length).toBe(1)
    expect(teamA).toHaveLength(1)
  })

  it('a team with no game this week falls back to the week\'s first kickoff', () => {
    const bye = row({ playerId: 'bye', team: 'NYJ', addedAt: T('2026-10-02T15:00:00Z') })
    expect(selectBestBallWeekRows('NFL', [bye], KICKOFFS)).toHaveLength(0)
  })

  it('with no schedule at all, only the current roster counts — exactly as before', () => {
    const none = { byTeam: new Map<string, Date>(), firstKickoff: null }
    const rows = [row({ playerId: 'cur' }), row({ playerId: 'gone', droppedAt: T('2026-10-05T12:00:00Z') })]
    expect(selectBestBallWeekRows('NFL', rows, none).map((r) => r.playerId)).toEqual(['cur'])
  })
})

describe('loading the week roster', () => {
  beforeEach(() => vi.clearAllMocks())
  const fakeDb = (rows: BestBallRosterRow[]) => ({ redraftRosterPlayer: { findMany: vi.fn(async () => rows) } }) as never

  it('an imported league keeps the current-roster read and never consults the schedule', async () => {
    const d = fakeDb([])
    await loadBestBallWeekRosterRows(d, { rosterIds: ['r1'], sport: 'NFL', season: 2026, week: 4, platform: 'sleeper', kickoffs: KICKOFFS as never })
    expect((d as any).redraftRosterPlayer.findMany).toHaveBeenCalledWith({ where: { rosterId: 'r1', droppedAt: null } })
  })

  it('a native league reads this week\'s drops too, then keeps who was held at each lock', async () => {
    const d = fakeDb([
      row({ playerId: 'kept-dropped', droppedAt: T('2026-10-05T12:00:00Z') }),
      row({ playerId: 'late-add', addedAt: T('2026-10-05T12:00:00Z') }),
      row({ playerId: 'drafted', acquisitionType: 'drafted' }),
    ])
    const out = await loadBestBallWeekRosterRows(d, { rosterIds: ['r1'], sport: 'NFL', season: 2026, week: 4, platform: 'manual', kickoffs: KICKOFFS as never })
    expect(out.map((r: any) => r.playerId).sort()).toEqual(['drafted', 'kept-dropped'])
    expect((d as any).redraftRosterPlayer.findMany).toHaveBeenCalledWith({
      where: { rosterId: 'r1', OR: [{ droppedAt: null }, { droppedAt: { gte: THU } }] },
    })
  })
})

describe('the production best ball scorer uses the week roster', () => {
  const SETTINGS = { sportConfig: { scoringPreset: 'PPR' }, roster: { config: { sections: [{ slots: { QB: 1, WR: 1, BN: 4 } }] } } }
  const ROWS = [
    { playerId: 'q1', position: 'QB', team: 'KC', acquisitionType: 'drafted', addedAt: PRESEASON, droppedAt: null, yards: 100 },
    { playerId: 'w1', position: 'WR', team: 'KC', acquisitionType: 'drafted', addedAt: PRESEASON, droppedAt: null, yards: 60 },
    // Dropped Monday after his Sunday game: his week stays.
    { playerId: 'wDrop', position: 'WR', team: 'KC', acquisitionType: 'drafted', addedAt: PRESEASON, droppedAt: T('2026-10-05T12:00:00Z'), yards: 120 },
    // Added Tuesday, after the week was played, with a huge week: must not count.
    { playerId: 'wLate', position: 'WR', team: 'KC', acquisitionType: 'free_agent', addedAt: T('2026-10-06T15:00:00Z'), droppedAt: null, yards: 400 },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    clearBestBallKickoffCache()
    db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: SETTINGS, bestBallMode: true, leagueType: 'best_ball', leagueVariant: null, guillotineMode: false, platform: 'manual' })
    db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { droppedAt?: null } }) =>
      ROWS.filter((r) => ('droppedAt' in where ? r.droppedAt === null : true)).map((r) => ({
        ...r, rosterId: 'home', sport: 'NFL', playerName: r.playerId, slotType: 'BN', isKept: false,
      })),
    )
    db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => {
      const r = ROWS.find((x) => x.playerId === where.playerId_week_season_sport.playerId)!
      return { stats: { rush_yds: r.yards }, isFinalized: true }
    })
    kickoffMock.mockResolvedValue({ ...KICKOFFS, warnings: [] })
  })

  const pts = (id: string) => {
    const r = ROWS.find((x) => x.playerId === id)!
    return calculateScoreFromSportConfig('L1', id, 4, { rush_yds: r.yards }, r.position)
  }

  it('starts the dropped-after-his-game WR and ignores the after-the-week pickup', async () => {
    const expected = Math.round(((await pts('q1')) + (await pts('wDrop'))) * 100) / 100
    const result = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'home', week: 4, seasonYear: 2026 })
    expect(result.points).toBe(expected)
    expect(result.bestBall?.assignments.map((a) => a.playerId).sort()).toEqual(['q1', 'wDrop'])
  })

  it('the week finalizer seals the same roster the scorer scores', async () => {
    const { finalizeRedraftWeek } = await import('@/lib/redraft/weekFinalizer')
    const updated: string[][] = []
    const prisma = {
      redraftSeason: { findFirst: vi.fn(async () => ({ id: 's1', leagueId: 'L1', sport: 'NFL', season: 2026 })) },
      redraftMatchup: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: 'm1', status: 'active', awayRosterId: 'away' }])
          .mockResolvedValue([{ status: 'final', awayRosterId: 'away' }]),
      },
      sportsGame: {
        findMany: vi.fn(async () => [{ status: 'final', startTime: SUN, source: 'espn', fetchedAt: T('2026-10-05T08:00:00Z'), season: 2026, week: 4 }]),
      },
      redraftRoster: { findMany: vi.fn(async () => [{ id: 'home' }]) },
      redraftRosterPlayer: { findMany: db.redraftRosterPlayer.findMany },
      league: { findFirst: vi.fn(async () => ({ bestBallMode: true, leagueType: 'best_ball', leagueVariant: null, platform: 'manual', settings: {} })) },
      roster: { findMany: vi.fn(async () => []) },
      afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
      playerWeeklyScore: {
        findMany: vi.fn(async () => ROWS.map((r) => ({ playerId: r.playerId, sport: 'NFL' }))),
        createMany: vi.fn(async (a: { data: unknown[] }) => ({ count: a.data.length })),
        updateMany: vi.fn(async (a: { where: { playerId: { in: string[] } } }) => {
          updated.push(a.where.playerId.in)
          return { count: a.where.playerId.in.length }
        }),
      },
    }
    const recalc = vi.fn(async () => ({ updated: 1, incomplete: 0, summaries: [] }))
    const result = await finalizeRedraftWeek(
      { seasonId: 's1', week: 4 },
      { prisma: prisma as never, now: () => T('2026-10-06T12:00:00Z'), recalculateMatchups: recalc as never },
    )
    expect(result.finalized).toBe(true)
    expect(updated.flat().sort()).toEqual(['q1', 'w1', 'wDrop'])
  })

  it('an unreadable schedule scores the current roster, as before', async () => {
    kickoffMock.mockRejectedValue(new Error('schedule down'))
    const expected = Math.round(((await pts('q1')) + (await pts('wLate'))) * 100) / 100
    const result = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'home', week: 4, seasonYear: 2026 })
    expect(result.points).toBe(expected)
  })
})
