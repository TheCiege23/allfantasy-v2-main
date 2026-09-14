// @vitest-environment node
/**
 * Chimmy advice receipts (retention item 6, 2026-09-14): how Chimmy's start/sit calls turned
 * out, resolved at read time from the platform's weekly scores. The advice table is parked
 * (unapplied), so "unavailable" must hide the section, never read as "no advice".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  list: vi.fn(),
  teamFind: vi.fn(),
  scoreFind: vi.fn(),
  swapFind: vi.fn(),
  cacheFind: vi.fn(),
  factFind: vi.fn(),
  leagueFind: vi.fn(),
  rosterFind: vi.fn(),
  playerFind: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: h.teamFind },
    leaguePlayerWeeklyScore: { findMany: h.scoreFind },
    autoCoachSwapLog: { findMany: h.swapFind },
    sportsDataCache: { findMany: h.cacheFind },
    transactionFact: { findMany: h.factFind },
    league: { findMany: h.leagueFind },
    roster: { findMany: h.rosterFind },
    sportsPlayer: { findMany: h.playerFind },
  },
}))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ TRADE_GRADES_CACHE_PREFIX: 'trade-grades:v2:' }))
vi.mock('@/lib/chimmy-advice/adviceStore', () => ({ listAdviceForUser: h.list }))

import { MAX_CHIMMY_RECEIPTS, getChimmyAdviceReceipts, getDecisionReceipts } from '@/lib/core-app/decisionReceipts'

const USER = 'u1'
const ICE = { id: 'af-ice', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: 'sl-ice', season: 2026 }

const advice = (over: Record<string, unknown> = {}) => ({
  leagueId: ICE.id,
  sport: 'NFL',
  season: 2026,
  week: 5,
  adviceType: 'start_sit',
  surface: 'start_vs_comparison',
  rec: { key: 'in', name: 'Jahmyr Gibbs' },
  alt: { key: 'out', name: 'Sam LaPorta' },
  slot: 'FLEX',
  confidencePct: 64,
  givenAt: new Date('2026-10-03T12:00:00Z'),
  ...over,
})

type Score = { leagueId: string; seasonYear: number; week: number; playerId: string; rosterId: number | null; isStarter: boolean; points: number }
const score = (playerId: string, points: number, isStarter: boolean, over: Partial<Score> = {}): Score => ({
  leagueId: 'sl-ice', seasonYear: 2026, week: 5, playerId, rosterId: 4, isStarter, points, ...over,
})

function db({ rows = [advice()] as unknown[] | null, scores = [] as Score[] } = {}) {
  h.list.mockResolvedValue(rows)
  h.teamFind.mockResolvedValue([{ leagueId: ICE.id, externalId: '4' }])
  h.scoreFind.mockImplementation(async ({ where }: { where: { OR: Array<{ leagueId: string; seasonYear: number; week: number }>; playerId: { in: string[] } } }) =>
    scores.filter((s) => where.playerId.in.includes(s.playerId) && where.OR.some((c) => c.leagueId === s.leagueId && c.seasonYear === s.seasonYear && c.week === s.week)),
  )
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.swapFind.mockResolvedValue([])
  h.cacheFind.mockResolvedValue([])
  h.factFind.mockResolvedValue([])
  h.leagueFind.mockResolvedValue([])
  h.rosterFind.mockResolvedValue([])
  h.playerFind.mockResolvedValue([])
})

describe('getChimmyAdviceReceipts', () => {
  it('🛑 a right call you followed: both players’ points, slot, confidence, followed from Sleeper’s starters', async () => {
    db({ scores: [score('in', 18.24, true), score('out', 6, false)] })
    const out = await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out?.chimmy).toEqual([
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
        confidencePct: 64,
      },
    ])
    expect(h.list.mock.calls[0][0]).toMatchObject({ userId: USER, leagueIds: ['af-ice'] })
  })

  it('🛑 a wrong call you did not follow is stated plainly; within a point is the same', async () => {
    db({ scores: [score('in', 4, false), score('out', 15, true)] })
    expect((await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 }))?.chimmy[0]).toMatchObject({ followed: 'no', call: 'wrong' })
    db({ scores: [score('in', 10.4, true), score('out', 10, true)] })
    expect((await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 }))?.chimmy[0]).toMatchObject({ followed: 'unclear', call: 'same' })
  })

  it('🛑 the advice table missing (null) or empty → null, and nothing else is read', async () => {
    db({ rows: null })
    expect(await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })).toBeNull()
    db({ rows: [] })
    expect(await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })).toBeNull()
    expect(h.teamFind).not.toHaveBeenCalled()
  })

  it('only start/sit advice with an alternative becomes a receipt (adds and chat swaps come later)', async () => {
    db({ rows: [advice({ adviceType: 'add', alt: null })] })
    expect(await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })).toBeNull()
    db({ rows: [advice({ adviceType: 'lineup_swap' })], scores: [score('in', 18, true), score('out', 6, false)] })
    expect(await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })).toBeNull()
  })

  it('🛑 a week still being played (or unknown) is pending, with no score read', async () => {
    db({ scores: [score('in', 18, true), score('out', 6, false)] })
    expect(await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: 5 })).toEqual({ chimmy: [], pending: 1, unscored: 0, unreadable: 0 })
    expect(await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: null })).toMatchObject({ pending: 1 })
    expect(h.scoreFind).not.toHaveBeenCalled()
  })

  it('🛑 either player unscored is unscored, never 0 pts; off your roster that week is unreadable', async () => {
    db({ scores: [score('in', 18, true)] })
    expect(await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })).toEqual({ chimmy: [], pending: 0, unscored: 1, unreadable: 0 })
    db({ scores: [score('in', 18, true), score('out', 6, false, { rosterId: 9 })] })
    expect(await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })).toEqual({ chimmy: [], pending: 0, unscored: 0, unreadable: 1 })
  })

  it('no single claimed team is unreadable (the scored roster is the last claim read)', async () => {
    db({ scores: [score('in', 18, true), score('out', 6, false)] })
    h.teamFind.mockResolvedValue([{ leagueId: ICE.id, externalId: '5' }, { leagueId: ICE.id, externalId: '4' }])
    expect((await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 }))?.unreadable).toBe(1)
    expect(h.teamFind.mock.calls[0][0].where).toEqual({ leagueId: { in: ['af-ice'] }, claimedByUserId: USER })
  })

  it('🛑 no claimed team at all is unreadable before any score is read — never "unscored"', async () => {
    db({ scores: [] })
    h.teamFind.mockResolvedValue([])
    expect(await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })).toEqual({ chimmy: [], pending: 0, unscored: 0, unreadable: 1 })
    expect(h.scoreFind).not.toHaveBeenCalled()
  })

  it(`reads only your Sleeper leagues; newest weeks first, at most ${MAX_CHIMMY_RECEIPTS}`, async () => {
    const rows = Array.from({ length: MAX_CHIMMY_RECEIPTS + 2 }, (_, i) => advice({ week: i + 1, rec: { key: `in${i}`, name: `In ${i}` }, alt: { key: `out${i}`, name: `Out ${i}` } }))
    const scores = rows.flatMap((_, i) => [score(`in${i}`, 10, true, { week: i + 1 }), score(`out${i}`, 5, false, { week: i + 1 })])
    db({ rows, scores })
    const out = await getChimmyAdviceReceipts({ userId: USER, leagues: [ICE, { ...ICE, id: 'espn', platform: 'espn' }], currentWeek: 12 })
    expect(h.list.mock.calls[0][0].leagueIds).toEqual(['af-ice'])
    expect(out?.chimmy).toHaveLength(MAX_CHIMMY_RECEIPTS)
    expect(out?.chimmy[0].week).toBe(MAX_CHIMMY_RECEIPTS + 2)
  })

  it('no user or no Sleeper league reads nothing', async () => {
    db()
    expect(await getChimmyAdviceReceipts({ userId: '', leagues: [ICE], currentWeek: 6 })).toBeNull()
    expect(await getChimmyAdviceReceipts({ userId: USER, leagues: [{ ...ICE, platform: 'espn' }], currentWeek: 6 })).toBeNull()
    expect(h.list).not.toHaveBeenCalled()
  })
})

describe('getDecisionReceipts + Chimmy', () => {
  it('🛑 Chimmy receipts ride alongside the other kinds and fail alone', async () => {
    db({ scores: [score('in', 18, true), score('out', 6, false)] })
    h.cacheFind.mockRejectedValue(new Error('cache down'))
    const out = await getDecisionReceipts({ userId: USER, leagues: [ICE], ownerSleeperId: 'sl-me', currentWeek: 6 })
    expect(out?.trades).toEqual([])
    expect(out?.chimmy?.[0]).toMatchObject({ call: 'right', followed: 'yes', confidencePct: 64 })
    h.list.mockRejectedValue(new Error('advice down'))
    const without = await getDecisionReceipts({ userId: USER, leagues: [ICE], ownerSleeperId: 'sl-me', currentWeek: 6 })
    expect(without && 'chimmy' in without).toBe(false)
  })
})
