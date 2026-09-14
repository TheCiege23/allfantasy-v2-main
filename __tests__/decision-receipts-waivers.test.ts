// @vitest-environment node
/**
 * Waiver-add receipts (retention item 6, 2026-09-14): your adds this season and what each
 * player scored FOR YOU after — only weeks on your roster, stopping when you let him go.
 * Too early withheld; no scores on file is never "0 pts"; a shared league's facts are found
 * under a league-mate's League row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  teamFind: vi.fn(),
  leagueFind: vi.fn(),
  factFind: vi.fn(),
  scoreFind: vi.fn(),
  playerFind: vi.fn(),
  cacheFind: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: h.teamFind },
    league: { findMany: h.leagueFind },
    transactionFact: { findMany: h.factFind },
    leaguePlayerWeeklyScore: { findMany: h.scoreFind },
    sportsPlayer: { findMany: h.playerFind },
    sportsDataCache: { findMany: h.cacheFind },
  },
}))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ TRADE_GRADES_CACHE_PREFIX: 'trade-grades:v2:' }))

import {
  MAX_WAIVER_RECEIPTS,
  MIN_WEEKS_FOR_RECEIPT,
  getDecisionReceipts,
  getWaiverReceipts,
} from '@/lib/core-app/decisionReceipts'

const USER = 'u1'
const ICE = { id: 'af-ice', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: 'sl-ice', season: 2026 }
const MY_ROSTER = '4'

type Fact = { transactionId: string; leagueId: string; type: string; rosterId: string; weekOrPeriod: number; payload: Record<string, unknown> }
const fact = (over: Partial<Fact> & { adds?: string[]; drops?: string[]; bid?: number | null }): Fact => ({
  transactionId: `tx-${Math.random()}`,
  leagueId: ICE.id,
  type: 'waiver',
  rosterId: MY_ROSTER,
  weekOrPeriod: 3,
  ...over,
  payload: { adds: over.adds ?? [], drops: over.drops ?? [], waiverBid: over.bid ?? null, createdAt: `2026-09-${10 + (over.weekOrPeriod ?? 3)}T00:00:00Z` },
})

type Score = { leagueId: string; week: number; playerId: string; rosterId: number | null; isStarter: boolean; points: number }
const score = (week: number, points: number, over: Partial<Score> = {}): Score => ({
  leagueId: 'sl-ice', week, playerId: '9221', rosterId: Number(MY_ROSTER), isStarter: true, points, ...over,
})

/** Mocks that honour the where clauses the loader sends, so a wrong filter shows up as a wrong answer. */
function db({ facts = [] as Fact[], scores = [] as Score[], siblings = [] as Array<{ id: string; platformLeagueId: string }> } = {}) {
  h.teamFind.mockResolvedValue([{ leagueId: ICE.id, externalId: MY_ROSTER }])
  h.leagueFind.mockResolvedValue([{ id: ICE.id, platformLeagueId: ICE.platformLeagueId }, ...siblings])
  h.factFind.mockImplementation(async ({ where }: { where: { OR: Array<{ leagueId: { in: string[] }; rosterId: string; season: number }>; type: { in: string[] } } }) =>
    facts.filter((f) => where.type.in.includes(f.type) && where.OR.some((c) => c.leagueId.in.includes(f.leagueId) && c.rosterId === f.rosterId)),
  )
  h.scoreFind.mockImplementation(async ({ where }: { where: { OR: Array<{ leagueId: string; week: { gte: number } }>; playerId: { in: string[] } } }) =>
    scores.filter((s) => where.playerId.in.includes(s.playerId) && where.OR.some((c) => c.leagueId === s.leagueId && s.week >= c.week.gte)),
  )
  h.playerFind.mockResolvedValue([{ sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB' }])
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.cacheFind.mockResolvedValue([])
})

describe('getWaiverReceipts', () => {
  it('🛑 points he scored FOR YOU since the add, starts counted, FAAB named', async () => {
    db({
      facts: [fact({ adds: ['9221'], weekOrPeriod: 3, bid: 12 })],
      scores: [score(3, 10.5), score(4, 8, { isStarter: false }), score(5, 22.7)],
    })
    const out = await getWaiverReceipts({ userId: USER, leagues: [ICE], currentWeek: 7 })
    expect(out?.waivers).toEqual([
      expect.objectContaining({
        playerName: 'Jahmyr Gibbs', position: 'RB', leagueName: 'Ice Kings', week: 3, via: 'waiver', faab: 12,
        points: 41.2, starts: 2, weeksScored: 3, leftWeek: null, href: '/core/waivers?league=af-ice',
      }),
    ])
  })

  it('🛑 weeks he spent on ANOTHER roster are never credited to you', async () => {
    db({
      facts: [fact({ adds: ['9221'], weekOrPeriod: 3 })],
      scores: [score(3, 10), score(4, 30, { rosterId: 9 })],
    })
    const out = await getWaiverReceipts({ userId: USER, leagues: [ICE], currentWeek: 7 })
    expect(out?.waivers[0]).toMatchObject({ points: 10, weeksScored: 1 })
  })

  it('🛑 credit stops the week before you dropped (or traded) him', async () => {
    db({
      facts: [
        fact({ adds: ['9221'], weekOrPeriod: 3 }),
        fact({ type: 'trade', drops: ['9221'], weekOrPeriod: 5 }),
      ],
      scores: [score(3, 10), score(4, 12), score(5, 40), score(6, 40)],
    })
    const out = await getWaiverReceipts({ userId: USER, leagues: [ICE], currentWeek: 8 })
    expect(out?.waivers[0]).toMatchObject({ points: 22, weeksScored: 2, leftWeek: 5 })
  })

  it('🛑 a shared league: facts under a LEAGUE-MATE’s League row still produce your receipt', async () => {
    db({
      siblings: [{ id: 'af-ice-mate', platformLeagueId: 'sl-ice' }],
      facts: [fact({ leagueId: 'af-ice-mate', adds: ['9221'], weekOrPeriod: 3 })],
      scores: [score(3, 15)],
    })
    const out = await getWaiverReceipts({ userId: USER, leagues: [ICE], currentWeek: 7 })
    expect(out?.waivers).toHaveLength(1)
    expect(h.factFind.mock.calls[0][0].where.OR[0].leagueId.in.sort()).toEqual(['af-ice', 'af-ice-mate'])
  })

  it('other rosters’ adds are not your receipts', async () => {
    db({ facts: [fact({ rosterId: '9', adds: ['9221'] })], scores: [score(3, 10, { rosterId: 9 })] })
    const out = await getWaiverReceipts({ userId: USER, leagues: [ICE], currentWeek: 7 })
    expect(out).toEqual({ waivers: [], tooEarly: 0, unscored: 0 })
  })

  it(`🛑 fewer than ${MIN_WEEKS_FOR_RECEIPT} weeks old, or the week unknown → too early, and no score read`, async () => {
    db({ facts: [fact({ adds: ['9221'], weekOrPeriod: 5 })], scores: [score(5, 30)] })
    const early = await getWaiverReceipts({ userId: USER, leagues: [ICE], currentWeek: 5 + MIN_WEEKS_FOR_RECEIPT - 1 })
    expect(early).toEqual({ waivers: [], tooEarly: 1, unscored: 0 })
    const unknown = await getWaiverReceipts({ userId: USER, leagues: [ICE], currentWeek: null })
    expect(unknown?.tooEarly).toBe(1)
    expect(h.scoreFind).not.toHaveBeenCalled()
  })

  it('🛑 no weekly scores on file is counted as unscored — never shown as 0 pts', async () => {
    db({ facts: [fact({ adds: ['9221'], weekOrPeriod: 3 })], scores: [] })
    const out = await getWaiverReceipts({ userId: USER, leagues: [ICE], currentWeek: 8 })
    expect(out).toEqual({ waivers: [], tooEarly: 0, unscored: 1 })
  })

  it('dropped before he ever played for you is a real 0, shown', async () => {
    db({
      facts: [fact({ adds: ['9221'], weekOrPeriod: 3 }), fact({ type: 'free_agent', drops: ['9221'], weekOrPeriod: 3 })],
      scores: [],
    })
    const out = await getWaiverReceipts({ userId: USER, leagues: [ICE], currentWeek: 8 })
    expect(out?.waivers[0]).toMatchObject({ points: 0, starts: 0, leftWeek: 3 })
  })

  it('a league with two claimed teams is ambiguous and skipped; no claimed team → null', async () => {
    db({ facts: [fact({ adds: ['9221'] })], scores: [score(3, 10)] })
    h.teamFind.mockResolvedValue([{ leagueId: ICE.id, externalId: '4' }, { leagueId: ICE.id, externalId: '5' }])
    expect(await getWaiverReceipts({ userId: USER, leagues: [ICE], currentWeek: 8 })).toBeNull()
  })

  it('non-Sleeper leagues and leagues without a season are not read', async () => {
    expect(
      await getWaiverReceipts({ userId: USER, leagues: [{ ...ICE, platform: 'espn' }, { ...ICE, id: 'x', season: null }], currentWeek: 8 }),
    ).toBeNull()
    expect(h.teamFind).not.toHaveBeenCalled()
  })

  it(`most recent adds first, at most ${MAX_WAIVER_RECEIPTS}; unknown player named honestly`, async () => {
    const facts = Array.from({ length: MAX_WAIVER_RECEIPTS + 2 }, (_, i) => fact({ adds: [`p${i}`], weekOrPeriod: i + 1 }))
    const scores = facts.map((f, i) => score(i + 1, 5, { playerId: `p${i}` }))
    db({ facts, scores })
    h.playerFind.mockResolvedValue([])
    const out = await getWaiverReceipts({ userId: USER, leagues: [ICE], currentWeek: 12 })
    expect(out?.waivers).toHaveLength(MAX_WAIVER_RECEIPTS)
    expect(out?.waivers[0]).toMatchObject({ week: MAX_WAIVER_RECEIPTS + 2, playerName: 'Unmatched player' })
  })
})

describe('getDecisionReceipts', () => {
  it('🛑 each kind fails alone: a trade-cache failure still shows waiver receipts', async () => {
    db({ facts: [fact({ adds: ['9221'] })], scores: [score(3, 10)] })
    h.cacheFind.mockRejectedValue(new Error('cache down'))
    const out = await getDecisionReceipts({ userId: USER, leagues: [ICE], ownerSleeperId: 'sl-me', currentWeek: 8 })
    expect(out?.trades).toEqual([])
    expect(out?.waivers).toHaveLength(1)
  })

  it('nothing readable for either kind → null', async () => {
    const out = await getDecisionReceipts({ userId: USER, leagues: [{ ...ICE, platform: 'espn' }], ownerSleeperId: null, currentWeek: 8 })
    expect(out).toBeNull()
  })
})
