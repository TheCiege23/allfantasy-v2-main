import { describe, expect, it } from 'vitest'

import {
  projectGrade,
  combinedUncertainty,
  buildTradeExpectation,
  describeLeague,
  requiredStarters,
  starterGapsFor,
} from '@/lib/trade-intel/tradeExpectation'
import type { GradedTrade, TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import type { MarketValuesPayload } from '@/lib/trade-intel/marketValueService'

/** The real league that prompted this: 12-team superflex dynasty, PPR + TE premium. */
const ROSTER_POSITIONS = [
  'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX',
  'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN',
]

const CONTEXT = {
  teams: 12,
  variant: { idp: false, superflex: true, dynasty: true, keeper: false, bestBall: false },
  roster: { positions: ROSTER_POSITIONS, starters: {}, starterCount: 10, bench: 10 },
  scoring: {
    settings: { rec: 1, bonus_rec_te: 0.5, rec_td: 6, rush_td: 6 },
    receptionWeight: 1,
    format: 'ppr' as const,
    idp: { present: false, tacklePts: 0, sackPts: 0, intPts: 0, emphasis: null },
  },
}

function asset(playerId: string, name: string, position: string) {
  return {
    playerId,
    name,
    position,
    pointsBySeason: {},
    creditedBySeason: {},
    departed: null,
    gamesMissedBySeason: {},
  }
}

function pickAsset(round: number) {
  return {
    season: '2026',
    round,
    originalRosterId: 1,
    label: `2026 round ${round}`,
    resolved: null,
    pending: true,
    rerouted: false,
  }
}

function side(o: {
  rosterId: number
  managerName: string
  playersIn: ReturnType<typeof asset>[]
  playersOut: ReturnType<typeof asset>[]
  picksIn: ReturnType<typeof pickAsset>[]
  picksOut: ReturnType<typeof pickAsset>[]
}): TradeSideGrade {
  return {
    rosterId: o.rosterId,
    ownerId: `o${o.rosterId}`,
    managerName: o.managerName,
    teamName: null,
    avatar: null,
    playersIn: o.playersIn,
    playersOut: o.playersOut,
    picksIn: o.picksIn,
    picksOut: o.picksOut,
    madePlayoffs: null,
    seasonNets: [{ season: '2026', net: 0, partial: true }],
    cumulativeNet: 0,
    initialGrade: 'C',
    currentGrade: 'C',
    trend: 'steady',
  }
}

const TRADE: GradedTrade = {
  id: 'l:t',
  season: '2026',
  week: 1,
  createdIso: '2026-08-12T01:31:00.000Z',
  multiTeam: false,
  tie: true,
  hasPendingPicks: true,
  sides: [
    side({
      rosterId: 1,
      managerName: 'managerOne',
      playersIn: [asset('9480', 'Brenton Strange', 'TE')],
      picksIn: [pickAsset(2)],
      playersOut: [asset('8676', 'Rashid Shaheed', 'WR'), asset('12474', 'Woody Marks', 'RB')],
      picksOut: [pickAsset(3)],
    }),
    side({
      rosterId: 8,
      managerName: 'managerTwo',
      playersIn: [asset('8676', 'Rashid Shaheed', 'WR'), asset('12474', 'Woody Marks', 'RB')],
      picksIn: [pickAsset(3)],
      playersOut: [asset('9480', 'Brenton Strange', 'TE')],
      picksOut: [pickAsset(2)],
    }),
  ],
}

// Real 2025 totals rescored under this league's settings (TE premium included).
const LS = 'league-scored' as const
const PRIOR = {
  season: '2025',
  byPlayerId: {
    // Mode travels per player; the trade's own assets decide what we claim.
    '9480': { points: 141.0, games: 12, mode: LS },
    '8676': { points: 144.6, games: 18, mode: LS },
    '12474': { points: 145.1, games: 16, mode: LS },
  },
}

const MARKET = {
  bySleeperId: {
    '9480': { name: 'Brenton Strange', sleeperId: '9480', position: 'TE', value: 2100, overallRank: 90, trend30Day: 0 },
    '8676': { name: 'Rashid Shaheed', sleeperId: '8676', position: 'WR', value: 1400, overallRank: 140, trend30Day: 0 },
    '12474': { name: 'Woody Marks', sleeperId: '12474', position: 'RB', value: 1900, overallRank: 100, trend30Day: 0 },
  },
  pickByRound: { '2026:2': 1500, '2026:3': 700 },
} as unknown as MarketValuesPayload

describe('league settings are stated, not assumed', () => {
  it('names superflex, dynasty, PPR and TE premium', () => {
    const note = describeLeague(CONTEXT)
    expect(note).toContain('12-team')
    expect(note).toContain('superflex')
    expect(note).toContain('dynasty')
    expect(note).toContain('full PPR')
    // TE premium is the setting most often missed when judging a TE trade.
    expect(note).toContain('TE premium (+0.5/rec)')
  })

  it('counts required starters with every flex kind pooled', () => {
    const req = requiredStarters(ROSTER_POSITIONS)
    expect(req.QB).toBe(1)
    expect(req.RB).toBe(2)
    expect(req.WR).toBe(2)
    expect(req.TE).toBe(1)
    // FLEX + FLEX + FLEX + SUPER_FLEX all pool into one flex bucket.
    expect(req.FLEX).toBe(4)
    expect(req.BN).toBeUndefined()
  })
})

describe('roster needs are counted, never opined on', () => {
  it('reports a position with too few bodies for its required slots', () => {
    const gaps = starterGapsFor({ QB: 1, RB: 1, WR: 4, TE: 1 }, requiredStarters(ROSTER_POSITIONS))
    expect(gaps).toEqual([{ position: 'RB', required: 2, rostered: 1 }])
  })

  it('never reports flex as a hole, since any skill player fills it', () => {
    const gaps = starterGapsFor({ QB: 1, RB: 2, WR: 2, TE: 1 }, requiredStarters(ROSTER_POSITIONS))
    expect(gaps.find((g) => g.position === 'FLEX')).toBeUndefined()
    expect(gaps).toEqual([])
  })
})

describe('what is knowable before kickoff', () => {
  const built = buildTradeExpectation({
    trade: TRADE,
    context: CONTEXT,
    marketValues: MARKET,
    priorSeason: PRIOR,
    rosteredByPosition: { 1: { QB: 2, RB: 1, WR: 5, TE: 2 }, 8: { QB: 2, RB: 3, WR: 4, TE: 1 } },
    pickValueLookup: (season, round) => MARKET.pickByRound[`${season}:${round}`] ?? null,
  })

  it('uses last season rescored under the league, not a generic PPR number', () => {
    const one = built.sides[0]!
    // Strange scored 118.0 in Sleeper's generic PPR but 141.0 with TE premium.
    expect(one.priorIn).toBe(141)
    expect(one.priorOut).toBe(289.7)
    expect(one.priorNet).toBe(-148.7)
    expect(built.scoringMode).toBe('league-scored')
    expect(built.priorSeason).toBe('2025')
  })

  it('prices an undrafted pick at market instead of zero', () => {
    const one = built.sides[0]!
    const pick = one.assetsIn.find((a) => a.isPick)
    expect(pick?.marketValue).toBe(1500)
    // Market: got Strange 2100 + R2 1500 = 3600; gave 1400 + 1900 + R3 700 = 4000.
    expect(one.marketIn).toBe(3600)
    expect(one.marketOut).toBe(4000)
    expect(one.marketNet).toBe(-400)
  })

  it('tracks the positional swing each side actually made', () => {
    expect(built.sides[0]!.positionDelta).toEqual({ TE: 1, WR: -1, RB: -1 })
    expect(built.sides[1]!.positionDelta).toEqual({ TE: -1, WR: 1, RB: 1 })
  })

  it('flags the side that can no longer fill its RB slots', () => {
    expect(built.sides[0]!.starterGaps).toEqual([{ position: 'RB', required: 2, rostered: 1 }])
    expect(built.sides[1]!.starterGaps).toEqual([])
  })

  it('is available when anything at all was measured', () => {
    expect(built.available).toBe(true)
    // This fixture passes no blended AF values, so the only gap is corroboration.
    expect(built.missing).toEqual(['second value source unavailable — values are single-source'])
  })
})

describe('missing inputs are admitted, not zeroed', () => {
  const built = buildTradeExpectation({
    trade: TRADE,
    context: CONTEXT,
    marketValues: null,
    priorSeason: null,
    rosteredByPosition: null,
  })

  it('returns null rather than 0 for every unmeasured quantity', () => {
    const one = built.sides[0]!
    expect(one.marketIn).toBeNull()
    expect(one.marketNet).toBeNull()
    expect(one.priorIn).toBeNull()
    expect(one.priorNet).toBeNull()
    expect(one.starterGaps).toBeNull()
  })

  it('names each missing input and reports itself unavailable', () => {
    expect(built.available).toBe(false)
    expect(built.missing).toHaveLength(3)
    expect(built.missing.join(' ')).toContain('market values')
    expect(built.missing.join(' ')).toContain('prior-season stats')
    expect(built.missing.join(' ')).toContain('rosters')
  })

  it('still states the league shape, which needs no feed', () => {
    expect(built.leagueNote).toContain('superflex')
  })
})

describe('projected grade — graded on value, not player count', () => {
  const built = buildTradeExpectation({
    trade: TRADE,
    context: CONTEXT,
    marketValues: MARKET,
    priorSeason: PRIOR,
    rosteredByPosition: { 1: { QB: 2, RB: 1, WR: 5, TE: 2 }, 8: { QB: 2, RB: 3, WR: 4, TE: 1 } },
    pickValueLookup: (season, round) => MARKET.pickByRound[`${season}:${round}`] ?? null,
  })

  it('grades the 1-for-2 on value edge rather than punishing the consolidator', () => {
    // Market: got 3600, gave 4000 -> net -400 on a 3800 mean = -10.5% edge.
    // The old totals-based grade gave this side an F purely for receiving fewer players.
    const one = built.sides[0]!.projected!
    expect(one.valueNet).toBe(-400)
    expect(one.valueEdge).toBeCloseTo(-0.105, 3)
    expect(one.letter).toBe('D')
    expect(built.sides[1]!.projected!.letter).toBe('B')
  })

  it('is scale-free: the same edge grades the same in a cheap or expensive deal', () => {
    const cheap = projectGrade({ marketIn: 100, marketOut: 140, priorNet: null, uncertainty: null })
    const rich = projectGrade({ marketIn: 10000, marketOut: 14000, priorNet: null, uncertainty: null })
    expect(cheap!.valueEdge).toBeCloseTo(rich!.valueEdge, 6)
    expect(cheap!.letter).toBe(rich!.letter)
  })

  it('calls it a fair deal when the edge is inside the valuations own uncertainty', () => {
    const p = projectGrade({ marketIn: 3600, marketOut: 4000, priorNet: null, uncertainty: 600 })!
    // A 400 gap between assets that themselves swing +/-600 is not a gap.
    expect(p.insideNoise).toBe(true)
    expect(p.letter).toBe('C')
    expect(p.confidence).toBe('low')
  })

  it('combines uncertainty by root-sum-square, not by naive addition', () => {
    // 300 and 400 -> 500, not 700. Summing would overstate doubt and swallow real edges.
    expect(combinedUncertainty([300, 400])).toBe(500)
    expect(combinedUncertainty([null, null])).toBeNull()
    expect(combinedUncertainty([])).toBeNull()
  })

  it('drops confidence when last season points the other way', () => {
    const p = projectGrade({ marketIn: 5000, marketOut: 4000, priorNet: -200, uncertainty: 100 })!
    expect(p.productionDisagrees).toBe(true)
    expect(p.confidence).toBe('moderate')
  })

  it('refuses to project when nothing was priced', () => {
    expect(projectGrade({ marketIn: null, marketOut: 4000, priorNet: 50, uncertainty: null })).toBeNull()
    expect(projectGrade({ marketIn: 0, marketOut: 0, priorNet: 50, uncertainty: null })).toBeNull()
    const blind = buildTradeExpectation({
      trade: TRADE, context: CONTEXT, marketValues: null,
      priorSeason: PRIOR, rosteredByPosition: null,
    })
    expect(blind.sides[0]!.projected).toBeNull()
  })
})

describe('scoring mode reflects the traded players, not the whole board', () => {
  it('claims league-scored only when every traded player genuinely was', () => {
    const built = buildTradeExpectation({
      trade: TRADE, context: CONTEXT, marketValues: MARKET,
      priorSeason: PRIOR, rosteredByPosition: null,
    })
    expect(built.scoringMode).toBe('league-scored')
  })

  it('drops to format-approx when any traded player fell back', () => {
    // One approximated player is enough to stop us claiming league accuracy.
    const mixed = {
      season: '2025',
      byPlayerId: {
        ...PRIOR.byPlayerId,
        '12474': { points: 145.1, games: 16, mode: 'format-approx' as const },
      },
    }
    const built = buildTradeExpectation({
      trade: TRADE, context: CONTEXT, marketValues: MARKET,
      priorSeason: mixed, rosteredByPosition: null,
    })
    expect(built.scoringMode).toBe('format-approx')
  })

  it('is null when no traded player carried a mode at all', () => {
    const noModes = {
      season: '2025',
      byPlayerId: { '9480': { points: 141.0, games: 12 } },
    }
    const built = buildTradeExpectation({
      trade: TRADE, context: CONTEXT, marketValues: MARKET,
      priorSeason: noModes, rosteredByPosition: null,
    })
    expect(built.scoringMode).toBeNull()
  })
})
