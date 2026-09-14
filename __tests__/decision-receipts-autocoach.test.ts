// @vitest-environment node
/**
 * AutoCoach receipts (retention item 6, Chimmy advice, 2026-09-14): how AutoCoach's recent
 * calls turned out. On an imported league a swap never reaches Sleeper, so "followed" comes
 * from Sleeper's own starters; the week comes only from an exact game match; pending,
 * unscored and unreadable calls are counted, never shown as numbers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  swapFind: vi.fn(),
  teamFind: vi.fn(),
  gameFind: vi.fn(),
  scoreFind: vi.fn(),
  cacheFind: vi.fn(),
  factFind: vi.fn(),
  leagueFind: vi.fn(),
  rosterFind: vi.fn(),
  playerFind: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    autoCoachSwapLog: { findMany: h.swapFind },
    leagueTeam: { findMany: h.teamFind },
    sportsGame: { findMany: h.gameFind },
    leaguePlayerWeeklyScore: { findMany: h.scoreFind },
    sportsDataCache: { findMany: h.cacheFind },
    transactionFact: { findMany: h.factFind },
    league: { findMany: h.leagueFind },
    roster: { findMany: h.rosterFind },
    sportsPlayer: { findMany: h.playerFind },
  },
}))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ TRADE_GRADES_CACHE_PREFIX: 'trade-grades:v2:' }))

import { MAX_AUTOCOACH_RECEIPTS, getAutoCoachReceipts, getDecisionReceipts } from '@/lib/core-app/decisionReceipts'

const USER = 'u1'
const ICE = { id: 'af-ice', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: 'sl-ice', season: 2026 }
const KICKOFF = new Date('2026-10-04T17:00:00Z')

const swap = (over: Record<string, unknown> = {}) => ({
  leagueId: ICE.id,
  slotPosition: 'FLEX',
  playerOutId: 'out',
  playerOutName: 'Sam LaPorta',
  playerInId: 'in',
  playerInName: 'Jahmyr Gibbs',
  gameStartsAt: KICKOFF,
  ...over,
})

type Score = { leagueId: string; seasonYear: number; week: number; playerId: string; rosterId: number | null; isStarter: boolean; points: number }
const score = (playerId: string, points: number, isStarter: boolean, over: Partial<Score> = {}): Score => ({
  leagueId: 'sl-ice', seasonYear: 2026, week: 5, playerId, rosterId: 4, isStarter, points, ...over,
})

function db({ swaps = [swap()] as unknown[], scores = [] as Score[], games = [{ startTime: KICKOFF, week: 5, season: 2026 }] as unknown[] } = {}) {
  h.swapFind.mockResolvedValue(swaps)
  h.teamFind.mockResolvedValue([{ leagueId: ICE.id, externalId: '4' }])
  h.gameFind.mockResolvedValue(games)
  h.scoreFind.mockImplementation(async ({ where }: { where: { OR: Array<{ leagueId: string; seasonYear: number; week: number }>; playerId: { in: string[] } } }) =>
    scores.filter((s) => where.playerId.in.includes(s.playerId) && where.OR.some((c) => c.leagueId === s.leagueId && c.seasonYear === s.seasonYear && c.week === s.week)),
  )
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.cacheFind.mockResolvedValue([])
  h.factFind.mockResolvedValue([])
  h.leagueFind.mockResolvedValue([])
  h.rosterFind.mockResolvedValue([])
  h.playerFind.mockResolvedValue([])
})

describe('getAutoCoachReceipts', () => {
  it('🛑 a right call you followed ON SLEEPER: both players’ points, the slot, followed from Sleeper’s starters', async () => {
    db({ scores: [score('in', 18.24, true), score('out', 6, false)] })
    const out = await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out?.autocoach).toEqual([
      {
        id: 'af-ice:2026:5:in:out',
        leagueId: 'af-ice',
        leagueName: 'Ice Kings',
        season: 2026,
        week: 5,
        slot: 'FLEX',
        recommended: { name: 'Jahmyr Gibbs', points: 18.2 },
        instead: { name: 'Sam LaPorta', points: 6 },
        followed: 'yes',
        call: 'right',
        href: '/core/my-team?league=af-ice',
      },
    ])
  })

  it('🛑 a wrong call you did not follow is stated plainly', async () => {
    db({ scores: [score('in', 4, false), score('out', 15, true)] })
    const out = await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out?.autocoach[0]).toMatchObject({ followed: 'no', call: 'wrong' })
  })

  it('within a point is about the same; both started is unclear', async () => {
    db({ scores: [score('in', 10.4, true), score('out', 10, true)] })
    const out = await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out?.autocoach[0]).toMatchObject({ followed: 'unclear', call: 'same' })
  })

  it('🛑 the week comes ONLY from an exact regular-season game match; no match is unreadable, not guessed', async () => {
    db({ scores: [score('in', 18, true), score('out', 6, false)], games: [] })
    const out = await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out).toEqual({ autocoach: [], pending: 0, unscored: 0, unreadable: 1 })
    expect(h.gameFind.mock.calls[0][0].where).toMatchObject({ sport: 'NFL', seasonType: 'regular' })
    expect(h.scoreFind).not.toHaveBeenCalled()
  })

  it('providers that disagree on the week make the call unreadable', async () => {
    db({
      scores: [score('in', 18, true), score('out', 6, false)],
      games: [{ startTime: KICKOFF, week: 5, season: 2026 }, { startTime: KICKOFF, week: 6, season: 2026 }],
    })
    expect((await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: 8 }))?.unreadable).toBe(1)
  })

  it('a swap with no game start time is unreadable', async () => {
    db({ swaps: [swap({ gameStartsAt: null })] })
    expect(await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: 8 })).toEqual({ autocoach: [], pending: 0, unscored: 0, unreadable: 1 })
  })

  it('🛑 a week still being played (or the week unknown) is pending, with no score read', async () => {
    db({ scores: [score('in', 18, true), score('out', 6, false)] })
    expect(await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: 5 })).toEqual({ autocoach: [], pending: 1, unscored: 0, unreadable: 0 })
    expect(await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: null })).toMatchObject({ pending: 1 })
    expect(h.scoreFind).not.toHaveBeenCalled()
  })

  it('🛑 either player with no score that week is unscored, never 0 pts', async () => {
    db({ scores: [score('in', 18, true)] })
    expect(await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })).toEqual({ autocoach: [], pending: 0, unscored: 1, unreadable: 0 })
  })

  it('🛑 a player not on YOUR roster that week makes the call unreadable', async () => {
    db({ scores: [score('in', 18, true), score('out', 6, false, { rosterId: 9 })] })
    expect((await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 }))?.unreadable).toBe(1)
  })

  it('no single claimed team in the league makes the call unreadable', async () => {
    db({ scores: [score('in', 18, true), score('out', 6, false)] })
    // The scored roster (4) is the LAST claim read, so only the two-claims rule can refuse it.
    h.teamFind.mockResolvedValue([{ leagueId: ICE.id, externalId: '5' }, { leagueId: ICE.id, externalId: '4' }])
    expect((await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 }))?.unreadable).toBe(1)
  })

  it('duplicate log rows for one call count once', async () => {
    db({ swaps: [swap(), swap()], scores: [score('in', 18, true), score('out', 6, false)] })
    expect((await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 }))?.autocoach).toHaveLength(1)
  })

  it(`reads YOUR swaps in YOUR Sleeper leagues; newest weeks first, at most ${MAX_AUTOCOACH_RECEIPTS}`, async () => {
    const kick = (w: number) => new Date(Date.UTC(2026, 8, 7 + 7 * w, 17))
    const swaps = Array.from({ length: MAX_AUTOCOACH_RECEIPTS + 2 }, (_, i) => swap({ playerInId: `in${i}`, playerOutId: `out${i}`, gameStartsAt: kick(i + 1) }))
    const games = swaps.map((s, i) => ({ startTime: s.gameStartsAt, week: i + 1, season: 2026 }))
    const scores = swaps.flatMap((s, i) => [score(`in${i}`, 10, true, { week: i + 1 }), score(`out${i}`, 5, false, { week: i + 1 })])
    db({ swaps, games, scores })
    const out = await getAutoCoachReceipts({ userId: USER, leagues: [ICE, { ...ICE, id: 'espn', platform: 'espn' }], currentWeek: 12 })
    expect(h.swapFind.mock.calls[0][0].where).toMatchObject({ userId: USER, leagueId: { in: ['af-ice'] } })
    expect(out?.autocoach).toHaveLength(MAX_AUTOCOACH_RECEIPTS)
    expect(out?.autocoach[0].week).toBe(MAX_AUTOCOACH_RECEIPTS + 2)
  })

  it('🛑 no swaps → null (no card section) and nothing else is read', async () => {
    db({ swaps: [] })
    expect(await getAutoCoachReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })).toBeNull()
    expect(h.teamFind).not.toHaveBeenCalled()
    expect(h.gameFind).not.toHaveBeenCalled()
  })
})

describe('getDecisionReceipts + AutoCoach', () => {
  it('🛑 AutoCoach receipts ride alongside the other kinds and fail alone', async () => {
    db({ scores: [score('in', 18, true), score('out', 6, false)] })
    h.cacheFind.mockRejectedValue(new Error('cache down'))
    const out = await getDecisionReceipts({ userId: USER, leagues: [ICE], ownerSleeperId: 'sl-me', currentWeek: 6 })
    expect(out?.trades).toEqual([])
    expect(out?.autocoach?.[0]).toMatchObject({ call: 'right', followed: 'yes' })
  })
})
