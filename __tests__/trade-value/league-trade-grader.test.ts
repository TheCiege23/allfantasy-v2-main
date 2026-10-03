/**
 * The one grader, end to end with the data layer stubbed: league → chart → price → grade.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  prices: new Map<string, number>(),
  chart: [] as Array<{ player: { name: string; position: string }; value: number }>,
  needCalls: 0,
  pricePickCalls: 0,
  leagueType: 'dynasty',
  needFactor: 1,
  rosterNeedCalls: [] as unknown[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/trade-value-console/league-loader', () => ({
  loadLeagueForTrade: async () => ({
    id: 'L1',
    platformLeagueId: null,
    name: 'Dynasty for life',
    sport: 'NFL',
    leagueSize: 12,
    isDynasty: true,
    leagueType: h.leagueType,
    scoring: 'ppr',
    settings: { scoring_settings: { rec: 1 }, roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'] },
    waiverBudget: 100,
    taxiSlots: 0,
    leagueVariant: 'dynasty',
    bestBallMode: false,
    starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
  }),
}))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: async () => ({ ok: false }) }))
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: async () => h.chart,
  // The chart now carries its sync time, so every grade line can date its market value.
  getFantasyCalcChartDbFirst: async () => ({ players: h.chart, syncedAt: '2026-09-28T14:27:28.097Z' }),
}))
vi.mock('@/lib/league-values/leagueTradeValues', () => ({ loadLeagueTradeValues: async () => null }))
vi.mock('@/lib/data/players', () => ({ getPlayer: async () => null, searchPlayers: async () => [] }))
vi.mock('@/lib/shared-services/player-identity/PlayerIdentityResolver', () => ({ resolvePlayer: async () => ({ confidence: 'none' }) }))
vi.mock('@/lib/trade-value/viewerNeedFactors', () => ({
  loadViewerNeedFactors: async (a: { give: unknown[]; get: unknown[] }) => {
    h.needCalls += 1
    return {
      give: a.give.map(() => h.needFactor === 1 ? null : { kind: 'need', factor: h.needFactor, reason: 'after this trade you have surplus WR depth' }),
      get: a.get.map(() => null), gap: null,
    }
  },
  loadRosterNeedFactors: async (a: { give: unknown[]; get: unknown[]; playerData: unknown }) => {
    h.rosterNeedCalls.push(a.playerData)
    return { give: a.give.map(() => null), get: a.get.map(() => ({ kind: 'need', factor: 1.2, reason: 'fills a starting hole' })), gap: null }
  },
}))
vi.mock('@/lib/hybrid-valuation', () => {
  const asset = (name: string, mv: number, extra: Record<string, unknown> = {}) => ({
    name,
    type: 'player',
    value: mv,
    assetValue: { marketValue: mv, impactValue: Math.round(mv * 0.5), vorpValue: 50, volatility: 0.1 },
    source: 'fantasycalc',
    position: 'WR',
    ...extra,
  })
  return {
    compositeScore: (v: { marketValue: number }) => v.marketValue,
    pricePlayer: async (name: string) => {
      const mv = h.prices.get(name)
      return mv == null ? { ...asset(name, 0), unpriced: true, source: 'unknown' } : asset(name, mv)
    },
    // The historical pick file: deliberately a different number from the live chart below.
    pricePick: async (p: { year: number; round: number }) => {
      h.pricePickCalls += 1
      return asset(`${p.year} Round ${p.round}`, 999, { type: 'pick', position: 'PICK', source: 'excel' })
    },
  }
})

import { createLeagueTradeGrader, gradeDeal } from '@/lib/decision-os/trade/leagueTradeGrader'
import { oneGradeForCompletedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import { buildTradeGradeEmail } from '@/lib/trade-intel/tradeGradeEmail'
import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'

beforeEach(() => {
  h.leagueType = 'dynasty'
  h.prices = new Map([
    ['Puka Nacua', 6000],
    ['Drake London', 4000],
    ['Jaxon Smith-Njigba', 5000],
  ])
  h.chart = [
    { player: { name: '2027 Pick 1.01', position: 'PICK' }, value: 3000 },
    { player: { name: '2027 Pick 1.12', position: 'PICK' }, value: 1000 },
    { player: { name: '2027 Round 2', position: 'PICK' }, value: 700 },
  ]
  h.needCalls = 0
  h.pricePickCalls = 0
  h.needFactor = 1
  h.rosterNeedCalls = []
})

const graded = <T extends { graded: boolean }>(v: T) => {
  if (!v.graded) throw new Error(`withheld: ${JSON.stringify(v)}`)
  return v as Extract<T, { graded: true }>
}

describe('createLeagueTradeGrader', () => {
  it('reproduces the earlier chart’s minus-eight-percent roster utility without using it as the letter', async () => {
    h.prices.set('DK Metcalf', 1774)
    h.chart = [{ player: { name: '2027 2nd', position: 'PICK' }, value: 1574 }]
    h.needFactor = 0.96
    const grader = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const deal = { give: [{ kind: 'player' as const, name: 'DK Metcalf' }],
      get: [{ kind: 'pick' as const, year: 2027, round: 2 }] }
    const proposal = graded(await grader.grade({ ...deal, viewerSide: true }))
    const completion = graded(await grader.grade({ ...deal, viewerSide: false }))
    expect(proposal.rosterFit).toMatchObject({ giveValue: 1703, getValue: 1574, percentDiff: -8 })
    expect([proposal.letter, proposal.partnerLetter, proposal.percentDiff]).toEqual(['D', 'B', -11])
    expect([completion.letter, completion.partnerLetter, completion.percentDiff]).toEqual(['D', 'B', -11])
  })
  it('keeps DK Metcalf for a 2027 second D/B across proposal, completion and email despite surplus WR utility', async () => {
    h.prices.set('DK Metcalf', 1766)
    h.chart = [{ player: { name: '2027 Round 2', position: 'PICK' }, value: 1584 }]
    h.needFactor = 0.96
    const grader = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const proposal = graded(await grader.grade({
      give: [{ kind: 'player', name: 'DK Metcalf' }],
      get: [{ kind: 'pick', year: 2027, round: 2 }], viewerSide: true,
    }))
    const trade = {
      id: 'L:T', season: '2026', week: 3, multiTeam: false,
      sides: [
        { rosterId: 1, ownerId: 'you', managerName: 'TheCiege24', teamName: null,
          playersIn: [], playersOut: [{ name: 'DK Metcalf', position: 'WR' }],
          picksIn: [{ season: '2027', round: 2, label: '2027 second', resolved: null }], picksOut: [] },
        { rosterId: 2, ownerId: 'other', managerName: 'sharpshoooter', teamName: null,
          playersIn: [{ name: 'DK Metcalf', position: 'WR' }], playersOut: [], picksIn: [], picksOut: [] },
      ],
    } as unknown as GradedTrade
    const completion = graded(await oneGradeForCompletedTrade('L1', trade, 2026, { graderFor: async () => grader }))
    for (const read of [proposal, completion]) {
      expect([read.letter, read.partnerLetter, read.percentDiff, read.giveValue, read.getValue]).toEqual(['D', 'B', -10, 1766, 1584])
      expect(read.lines.map(line => line.leagueValue)).toEqual([1766, 1584])
      expect(read.needApplied).toBe(false)
      expect(read.moves).toEqual([])
    }
    expect(proposal.rosterFit).toMatchObject({ giveValue: 1695, getValue: 1584, percentDiff: -7 })
    expect(proposal.rosterFit?.moves[0]?.reasons).toContain('after this trade you have surplus WR depth')
    expect(completion.rosterFit).toBeNull()
    const email = buildTradeGradeEmail({ leagueName: 'ForMySleeperFriends', trade,
      grade: completion, viewerOwnerId: 'you', ledgerUrl: 'https://allfantasy.ai/core/trades' })
    expect(email.subject).toContain('you D, sharpshoooter B')
    expect(email.html).toContain('1,766')
    expect(email.html).toContain('1,584')
    expect(email.html).toContain('Personal roster fit is shown separately')
    expect(email.html).not.toContain('a bad season by the team that owes one moves this grade')
  })
  it('shares specialty coverage limits and rejects a prohibited format through the real grade path', async () => {
    const deal = { give: [{ kind: 'player' as const, name: 'Drake London' }], get: [{ kind: 'player' as const, name: 'Puka Nacua' }], viewerSide: false }
    h.leagueType = 'keeper'
    const keeper = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const read = graded(await keeper.grade(deal))
    expect(read.basis).toContain('Keeper costs and future keeper surplus are not included')
    h.leagueType = 'survivor_guillotine'
    const prohibited = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const result = await prohibited.grade(deal)
    expect(result.graded).toBe(false)
    if (!result.graded) expect(result.reason).toContain('trades are not permitted')
  })
  it('grades a 1.5x deal A for the receiver and F for the sender, on the league chart', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const v = graded(
      await g.grade({ give: [{ kind: 'player', name: 'Drake London' }], get: [{ kind: 'player', name: 'Puka Nacua' }], viewerSide: true }),
    )
    expect([v.letter, v.partnerLetter]).toEqual(['A', 'F'])
    expect([v.giveValue, v.getValue]).toEqual([4000, 6000])
    expect(v.basis).toBe('Dynasty · 1QB · 12 teams · PPR')
    expect(v.lines.map((l) => [l.side, l.name, l.leagueValue])).toEqual([
      ['give', 'Drake London', 4000],
      ['get', 'Puka Nacua', 6000],
    ])
  })

  it('every line records WHICH evidence priced it and WHEN — through the real grader (2026-09-28)', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const v = graded(
      await g.grade({ give: [{ kind: 'player', name: 'Drake London' }], get: [{ kind: 'player', name: 'Puka Nacua' }], viewerSide: true }),
    )
    expect(v.lines.map((l) => [l.name, l.valueSource, l.valueAsOf])).toEqual([
      ['Drake London', 'fantasycalc', '2026-09-28T14:27:28.097Z'],
      ['Puka Nacua', 'fantasycalc', '2026-09-28T14:27:28.097Z'],
    ])
  })

  it('a named roster prices roster fit for THAT roster — the partner’s side, with no user to look up', async () => {
    const grader = (await createLeagueTradeGrader({ leagueId: 'L1' }))!
    const view = graded(await grader.grade({
      give: [{ kind: 'player', name: 'Drake London' }],
      get: [{ kind: 'player', name: 'Jaxon Smith-Njigba' }],
      viewerSide: true,
      needRoster: { playerData: { players: ['p1'] } },
    }))
    expect(h.rosterNeedCalls).toEqual([{ players: ['p1'] }])
    expect(h.needCalls).toBe(0)
    expect(view.rosterFit?.percentDiff).toBeGreaterThan(0)
  })

  it('roster need is priced only when the graded side is the viewer', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const deal = { give: [{ kind: 'player' as const, name: 'Drake London' }], get: [{ kind: 'player' as const, name: 'Puka Nacua' }] }
    await g.grade({ ...deal, viewerSide: false })
    expect(h.needCalls).toBe(0)
    await g.grade({ ...deal, viewerSide: true })
    expect(h.needCalls).toBe(1)
  })

  it('🛑 a pick is priced off the LIVE chart, not the February pick file', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const v = graded(
      await g.grade({ give: [{ kind: 'pick', year: 2027, round: 1 }], get: [{ kind: 'player', name: 'Drake London' }], viewerSide: false }),
    )
    // Round average of the chart's own 2027 1st rows — 3000 and 1000 — never the file's 999.
    expect(v.giveValue).toBe(2000)
    expect(h.pricePickCalls).toBe(1) // still asked, for the pick's shape; its price is replaced
  })

  it('🛑 a pick the chart does not carry WITHHOLDS the letter — never the old pricer (2026-09-28)', async () => {
    // The old pricer's fallback (the historical file, else the formula curve) priced a 2027 1st at
    // 7,360 against FantasyCalc's ~2,900 in guillotine/survivor/zombie leagues (price coverage audit).
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const v = await g.grade({ give: [{ kind: 'pick', year: 2029, round: 3 }], get: [{ kind: 'player', name: 'Drake London' }], viewerSide: false })
    expect(v).toMatchObject({ graded: false, reason: expect.stringMatching(/no value on this league's chart/) })
    // [control] a pick the chart DOES carry still grades, from the chart.
    const charted = graded(
      await g.grade({ give: [{ kind: 'pick', year: 2027, round: 2 }], get: [{ kind: 'player', name: 'Drake London' }], viewerSide: false }),
    )
    expect(charted.giveValue).toBe(700)
  })

  it('an unpriced player withholds the letter rather than grading him as worthless', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const v = await g.grade({
      give: [{ kind: 'player', name: 'Nobody McUnknown' }],
      get: [{ kind: 'player', name: 'Puka Nacua' }],
      viewerSide: false,
    })
    expect(v.graded).toBe(false)
  })

  /*
   * 🛑 EVERY GRADE SAYS WHICH LEAGUE TYPE IT WAS PRICED UNDER, AND HOW WE KNOW (2026-09-25) — the
   * surfaces print it beside the letter. Withheld grades carry it too.
   */
  it('carries the league type on the grader and on every grade, graded or withheld', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    // The fixture's column says dynasty, but its settings carry no provider flag and no confirmation.
    const expected = { type: 'dynasty', label: 'Dynasty', source: 'assumed', platform: null }
    expect(g.leagueType).toEqual(expected)
    const graded1 = await g.grade({ give: [{ kind: 'player', name: 'Drake London' }], get: [{ kind: 'player', name: 'Puka Nacua' }], viewerSide: false })
    expect(graded1.leagueType).toEqual(expected)
    const withheld = await g.grade({ give: [{ kind: 'player', name: 'Nobody McUnknown' }], get: [{ kind: 'player', name: 'Puka Nacua' }], viewerSide: false })
    expect(withheld.graded).toBe(false)
    expect(withheld.leagueType).toEqual(expected)
  })
})

describe('gradeDeal', () => {
  it('a league that could not be read is withheld, not graded', async () => {
    const v = await gradeDeal(null, { give: { assets: [], unpriceable: [] }, get: { assets: [], unpriceable: [] }, viewerSide: true })
    expect(v).toMatchObject({ graded: false, reason: expect.stringMatching(/could not be loaded/) })
  })

  it('an asset that cannot be priced withholds before anything is priced', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const v = await gradeDeal(g, {
      give: { assets: [{ kind: 'player', name: 'Drake London' }], unpriceable: [] },
      get: { assets: [], unpriceable: ['Future pick'] },
      viewerSide: true,
    })
    expect(v).toMatchObject({ graded: false, reason: expect.stringMatching(/^Future pick cannot be priced/) })
  })
})

describe('P0 package and team-direction regression through the shared league grader', () => {
  it('counts players separately from picks and requests review for a favorable 2-for-1 package', async () => {
    const grader = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const view = graded(await grader.grade({
      give: [{ kind: 'player', name: 'Jaxon Smith-Njigba' }],
      get: [{ kind: 'player', name: 'Drake London' }, { kind: 'player', name: 'Puka Nacua' }],
      viewerSide: true,
    }))
    expect(view.letter).toBe('A')
    expect(view.action).toBe('review')
    expect(view.recommendation).toContain('may require drops')
    expect(view.lines.map(line => line.assetKind)).toEqual(['player', 'player', 'player'])
  })
  it.each([0.85, 1.2])('roster utility factor %s changes fit while preserving the trade-value letter', async factor => {
    h.needFactor = factor
    const grader = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const assets = {
      give: [{ kind: 'player' as const, name: 'Drake London' }],
      get: [{ kind: 'player' as const, name: 'Jaxon Smith-Njigba' }],
    }
    const withRoster = graded(await grader.grade({ ...assets, viewerSide: true }))
    const shared = graded(await grader.grade({ ...assets, viewerSide: false }))
    expect(withRoster.rosterFit?.giveValue).toBe(Math.round(4000 * factor))
    expect([withRoster.letter, withRoster.partnerLetter]).toEqual(['B', 'D'])
    expect([withRoster.letter, withRoster.giveValue, withRoster.getValue]).toEqual([shared.letter, shared.giveValue, shared.getValue])
  })
})
