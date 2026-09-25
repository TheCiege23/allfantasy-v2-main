import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The per-league "Trade grades" list gained the same breakdown sentences the cross-league
 * board carries, and it gained ONE piece of logic the board does not have: a gate.
 *
 * 🛑 WHAT THIS FILE GUARDS IS THE GATE, NOT THE SENTENCES. `buildTradeBreakdown` is unit
 * tested on its own. This path additionally decides WHETHER to caption a trade at all, and
 * it can only do so honestly for the viewer's own trades: `collapseMirroredTradeRows` keeps
 * the viewer's copy of a mirrored trade where one exists, and where it did not,
 * `history.sleeperUsername` is a numeric platform USER ID rather than a display name.
 *
 * Inverting that gate does not throw, does not fail a typecheck, and does not look wrong in
 * a diff. It captions another manager's trade with the word "You".
 */

const LEAGUE_ID = 'lg-1'
const VIEWER_SLEEPER_ID = '591462610482806784'
const OTHER_SLEEPER_ID = '111111111111111111'

let tradeOwner = VIEWER_SLEEPER_ID

vi.mock('@/lib/core-app/sleeperTradeHistory', () => ({ getSleeperTradeHistory: vi.fn(async () => null) }))
vi.mock('@/lib/provider-trades/scanPendingSleeperTrades', () => ({
  scanPendingSleeperTrades: vi.fn(async () => null),
}))

/*
 * THE ONE GRADE (2026-09-25): the list grades through `gradeArchivedTrade` on a league grader, no
 * longer in rank space. The grader is faked by NAME — the only handle the list hands it — and the
 * real `gradeArchivedTrade` runs, so the side orientation (received vs gave) is exercised for real.
 */
const PRICES: Record<string, number> = { 'Alpha Back': 9000, 'Beta Wide': 3000 }
vi.mock('@/lib/player-analytics', () => ({ getPlayerAnalyticsBatch: vi.fn(async () => new Map()) }))
vi.mock('@/lib/decision-os/trade/completedTradeGrade', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/decision-os/trade/completedTradeGrade')>()
  const { gradeTrade } = await import('@/lib/decision-os/trade/tradeGrade')
  const total = (xs: Array<{ kind: string; name?: string }>) => xs.reduce((s, x) => s + (PRICES[x.name ?? ''] ?? 0), 0)
  return {
    ...actual,
    completedTradeGraderFor: async () => ({
      leagueId: LEAGUE_ID,
      chart: {},
      grade: async (args: { give: Array<{ kind: string; name?: string }>; get: Array<{ kind: string; name?: string }> }) => {
        const giveValue = total(args.give)
        const getValue = total(args.get)
        return gradeTrade({
          giveValue, getValue, giveMarket: giveValue, getMarket: getValue, unpriced: 0,
          giveCount: args.give.length, getCount: args.get.length, basis: 'Dynasty · Superflex · 12 teams · PPR',
          scoringApplied: false, needApplied: false, needGap: null,
          lines: [
            ...args.give.map((a) => ({ side: 'give' as const, name: a.name ?? '', marketValue: PRICES[a.name ?? ''] ?? null, leagueValue: PRICES[a.name ?? ''] ?? null })),
            ...args.get.map((a) => ({ side: 'get' as const, name: a.name ?? '', marketValue: PRICES[a.name ?? ''] ?? null, leagueValue: PRICES[a.name ?? ''] ?? null })),
          ],
          moves: [],
        })
      },
    }),
  }
})

vi.mock('@/lib/prisma', () => {
  const empty = new Proxy(
    {},
    {
      get: (_t, m: string) => {
        if (m === 'findMany' || m === 'groupBy') return async () => []
        if (m === 'count') return async () => 12
        return async () => null
      },
    },
  )
  const overrides: Record<string, Record<string, unknown>> = {
    league: {
      findUnique: async () => ({
        id: LEAGUE_ID,
        name: 'KBFL',
        platform: 'sleeper',
        leagueType: 'dynasty',
        settings: {},
        platformLeagueId: '1338541390891606016',
        season: 2026,
        sport: 'NFL',
      }),
    },
    leagueTeam: {
      findFirst: async () => ({ platformUserId: VIEWER_SLEEPER_ID, externalId: '4' }),
      findMany: async () => [],
      count: async () => 12,
    },
    userProfile: { findUnique: async () => null },
    leagueTradeHistory: {
      findMany: async () => [{ id: 'h1', sleeperUsername: tradeOwner }],
    },
    leagueTrade: {
      findMany: async () => [
        {
          transactionId: 'tx-1',
          season: 2026,
          week: 3,
          playersReceived: ['p1'],
          playersGiven: ['p2'],
          picksReceived: [],
          picksGiven: [],
          partnerName: 'Gridiron Vultures',
          tradeDate: new Date('2026-09-05T22:16:13Z'),
          history: { sleeperUsername: tradeOwner },
        },
      ],
    },
    sportsPlayer: {
      findMany: async () => [
        { sleeperId: 'p1', name: 'Alpha Back', position: 'RB' },
        { sleeperId: 'p2', name: 'Beta Wide', position: 'WR' },
      ],
    },
  }
  const prisma = new Proxy(
    {},
    {
      get: (_t, model: string) => {
        const o = overrides[model]
        if (!o) return empty
        return new Proxy(o, {
          get: (t, m: string) =>
            (t as Record<string, unknown>)[m] ?? (empty as Record<string, unknown>)[m],
        })
      },
    },
  )
  return { prisma, default: prisma }
})

const loadGrades = async () => {
  const { getTradesData } = await import('@/lib/core-app/trades')
  const data = await getTradesData(LEAGUE_ID, 'user-1')
  return data.grades
}

describe('per-league grade breakdown', () => {
  beforeEach(() => {
    vi.resetModules()
    tradeOwner = VIEWER_SLEEPER_ID
  })

  it("captions the viewer's own trade, naming both sides", async () => {
    const grades = await loadGrades()
    expect(grades.available).toBe(true)
    const row = grades.available ? grades.data[0] : null
    expect(row).toBeTruthy()
    expect(row!.letter).toBe('A')
    expect(row!.breakdown[0]).toMatch(/^You came out well ahead/)
    expect(row!.breakdown.join(' ')).toContain('Alpha Back')
    /* The partner's real name, from `partnerName` — never a platform id. */
    expect(row!.breakdown.join(' ')).not.toContain(VIEWER_SLEEPER_ID)
  })

  /*
   * 🛑 THE HALF THAT MATTERS. Same trade, same prices, same letter — only the owning history
   * differs. A gate that is inverted, or absent, prints "You" over a trade the viewer was
   * not in.
   */
  it('stays silent on a trade between two other managers', async () => {
    tradeOwner = OTHER_SLEEPER_ID
    const grades = await loadGrades()
    expect(grades.available).toBe(true)
    const row = grades.available ? grades.data[0] : null
    expect(row).toBeTruthy()
    /* Still graded — the gate withholds the CAPTION, never the letter. */
    expect(row!.letter).toBe('A')
    expect(row!.breakdown).toEqual([])
  })
})
