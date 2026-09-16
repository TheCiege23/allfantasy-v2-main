// @vitest-environment node
/**
 * Chimmy's "add X" receipts (retention item 6, user decision 2026-09-14: waiver claims only).
 * "You added him" uses the waiver receipts' reads and tenure rule; "you didn't" is claimed only
 * once the league's transactions reach past the follow window; a passed-on player never gets
 * points; too early, unscored and unknown are counted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  list: vi.fn(),
  teamFind: vi.fn(),
  leagueFind: vi.fn(),
  factFind: vi.fn(),
  factGroup: vi.fn(),
  scoreFind: vi.fn(),
  playerFind: vi.fn(),
  swapFind: vi.fn(),
  cacheFind: vi.fn(),
  rosterFind: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: h.teamFind },
    league: { findMany: h.leagueFind },
    transactionFact: { findMany: h.factFind, groupBy: h.factGroup },
    leaguePlayerWeeklyScore: { findMany: h.scoreFind },
    sportsPlayer: { findMany: h.playerFind },
    autoCoachSwapLog: { findMany: h.swapFind },
    sportsDataCache: { findMany: h.cacheFind },
    roster: { findMany: h.rosterFind },
  },
}))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ TRADE_GRADES_CACHE_PREFIX: 'trade-grades:v2:' }))
vi.mock('@/lib/chimmy-advice/adviceStore', () => ({ listAdviceForUser: h.list }))

import { getChimmyAdviceReceipts, getDecisionReceipts } from '@/lib/core-app/decisionReceipts'

const USER = 'u1'
const ICE = { id: 'af-ice', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: 'sl-ice', season: 2026 }
const WRIGHT = '11620'

const addAdvice = (over: Record<string, unknown> = {}) => ({
  leagueId: ICE.id,
  sport: 'NFL',
  season: 2026,
  week: 3,
  adviceType: 'add',
  surface: 'chimmy_chat_waiver',
  rec: { key: WRIGHT, name: 'Jaylen Wright' },
  alt: null,
  slot: null,
  confidencePct: 68,
  givenAt: new Date('2026-09-23T12:00:00Z'),
  ...over,
})

const fact = (week: number, over: Record<string, unknown> = {}) => ({
  transactionId: `t${week}`,
  leagueId: ICE.id,
  type: 'waiver',
  rosterId: '4',
  weekOrPeriod: week,
  payload: { adds: [WRIGHT], waiverBid: 12, createdAt: `2026-09-${10 + week}T10:00:00Z` },
  ...over,
})

const scoresFrom = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ leagueId: 'sl-ice', week: from + i, playerId: WRIGHT, rosterId: 4, isStarter: i > 0, points: 10 }))

function db({
  rows = [addAdvice()] as unknown[],
  facts = [fact(3)] as unknown[],
  syncedWeek = 6 as number | null,
  scores = scoresFrom(3, 6),
  /** Last season's rows, which the history sync writes under the SAME League.id. */
  priorSeasonWeek = null as number | null,
} = {}) {
  h.list.mockResolvedValue(rows)
  h.teamFind.mockResolvedValue([{ leagueId: ICE.id, externalId: '4' }])
  h.leagueFind.mockResolvedValue([{ id: ICE.id, platformLeagueId: 'sl-ice' }])
  h.factFind.mockResolvedValue(facts)
  const groups = [
    ...(syncedWeek == null ? [] : [{ leagueId: ICE.id, season: 2026, _max: { weekOrPeriod: syncedWeek } }]),
    ...(priorSeasonWeek == null ? [] : [{ leagueId: ICE.id, season: 2025, _max: { weekOrPeriod: priorSeasonWeek } }]),
  ]
  // Filters by season the way the database would, so a query WITHOUT the filter sees last season.
  h.factGroup.mockImplementation(async ({ where }: { where: { season?: { in: number[] } } }) =>
    where.season ? groups.filter((g) => where.season!.in.includes(g.season)) : groups,
  )
  h.scoreFind.mockImplementation(async ({ where }: { where: { playerId: { in: string[] } } }) => scores.filter((s) => where.playerId.in.includes(s.playerId)))
  h.playerFind.mockResolvedValue([])
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.swapFind.mockResolvedValue([])
  h.cacheFind.mockResolvedValue([])
  h.rosterFind.mockResolvedValue([])
})

const read = (currentWeek: number | null = 7) => getChimmyAdviceReceipts({ userId: USER, leagues: [ICE], currentWeek })

describe('Chimmy add receipts', () => {
  it('🛑 you took the advice: your add, and his points ON YOUR ROSTER while yours', async () => {
    db()
    const out = await read()
    expect(out?.adds).toEqual([
      {
        id: 'af-ice:2026:3:add:11620',
        leagueId: 'af-ice',
        leagueName: 'Ice Kings',
        season: 2026,
        week: 3,
        playerName: 'Jaylen Wright',
        confidencePct: 68,
        added: { week: 3, points: 40, starts: 3, leftWeek: null },
        href: '/core/waivers?league=af-ice',
      },
    ])
    expect(out).toMatchObject({ chimmy: [], pending: 0, unscored: 0, unreadable: 0, addsTooEarly: 0, addsUnscored: 0, addsUnknown: 0 })
  })

  it('an add the week after the advice still counts; two weeks later does not', async () => {
    db({ facts: [fact(4)], scores: scoresFrom(4, 6) })
    expect((await read())?.adds?.[0].added).toMatchObject({ week: 4 })
    db({ facts: [fact(5)], scores: scoresFrom(5, 6) })
    expect((await read())?.adds?.[0].added).toBeNull()
  })

  it('🛑 an add BEFORE the advice, or of a different player, is not taking it', async () => {
    db({ facts: [fact(2, { weekOrPeriod: 2 })], scores: scoresFrom(2, 6) })
    expect((await read())?.adds?.[0].added).toBeNull()
    db({ facts: [fact(3, { payload: { adds: ['9999'], createdAt: '2026-09-13T10:00:00Z' } })] })
    expect((await read())?.adds?.[0].added).toBeNull()
  })

  it('exactly three weeks after the advice is old enough to call', async () => {
    db()
    expect(await read(6)).toMatchObject({ addsTooEarly: 0, adds: [expect.objectContaining({ week: 3 })] })
  })

  it('newest first, at most five add receipts', async () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((w) => addAdvice({ week: w, rec: { key: `p${w}`, name: `Player ${w}` } }))
    db({ rows, facts: [], syncedWeek: 12 })
    const out = await read(12)
    expect(out?.adds?.map((a) => a.week)).toEqual([7, 6, 5, 4, 3])
  })

  it('🛑 "you didn’t add him" only once the league’s transactions reach past the window — and never with points', async () => {
    db({ facts: [], syncedWeek: 4 })
    expect((await read())?.adds).toEqual([expect.objectContaining({ added: null })])
    db({ facts: [], syncedWeek: 3 })
    expect(await read()).toMatchObject({ adds: [], addsUnknown: 1 })
    db({ facts: [], syncedWeek: null })
    expect(await read()).toMatchObject({ adds: [], addsUnknown: 1 })
    expect(h.factGroup.mock.calls[0][0]).toEqual({
      by: ['leagueId', 'season'],
      where: { leagueId: { in: ['af-ice'] }, season: { in: [2026] } },
      _max: { weekOrPeriod: true },
    })
  })

  /*
   * 🛑 THE BUG THIS PINS. The history sync writes every past season under the current League.id,
   * and the sync check had no season — so last season's week 18 made a week-3 add that had not
   * synced yet read as "you didn't add him".
   */
  it('🛑 last season\'s transactions never make this season look synced', async () => {
    db({ facts: [], syncedWeek: 3, priorSeasonWeek: 18 })
    const out = await read()
    expect(out).toMatchObject({ adds: [], addsUnknown: 1 })
  })

  it('🛑 too early (under three weeks, or the week unknown) is counted, and nothing is read', async () => {
    db()
    expect(await read(5)).toMatchObject({ adds: [], addsTooEarly: 1, addsUnknown: 0 })
    expect(await read(null)).toMatchObject({ addsTooEarly: 1 })
    expect(h.teamFind).not.toHaveBeenCalled()
    expect(h.factFind).not.toHaveBeenCalled()
  })

  it('🛑 you added him but no score is on file: unscored, never 0 pts', async () => {
    db({ scores: [] })
    expect(await read()).toMatchObject({ adds: [], addsUnscored: 1 })
  })

  it('no single claimed team, or advice from another season, cannot be checked', async () => {
    db()
    h.teamFind.mockResolvedValue([])
    expect(await read()).toMatchObject({ adds: [], addsUnknown: 1 })
    db({ rows: [addAdvice({ season: 2025 })] })
    expect(await read()).toMatchObject({ adds: [], addsUnknown: 1 })
  })

  it('start/sit and add advice come back together', async () => {
    db({
      rows: [
        addAdvice(),
        { ...addAdvice(), adviceType: 'start_sit', surface: 'start_vs_comparison', week: 5, rec: { key: 'in', name: 'A' }, alt: { key: 'out', name: 'B' } },
      ],
    })
    const out = await read()
    expect(out?.adds).toHaveLength(1)
    expect(out?.pending).toBe(0)
  })

  it('🛑 getDecisionReceipts carries the add receipts through', async () => {
    db()
    const out = await getDecisionReceipts({ userId: USER, leagues: [ICE], ownerSleeperId: 'sl-me', currentWeek: 7 })
    expect(out?.chimmyAdds?.[0]).toMatchObject({ playerName: 'Jaylen Wright', added: { points: 40 } })
    expect(out).toMatchObject({ chimmyAddsTooEarly: 0, chimmyAddsUnscored: 0, chimmyAddsUnknown: 0 })
  })
})
