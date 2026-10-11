/**
 * Dynasty picks priced by where they are projected to land (trade grade audit, Guap 2026-10-11:
 * "go ahead with dynasty pick slots").
 *
 * 1. FantasyCalc's tier rows ("2027 1st (Early)") were never parsed, so every 2027 1st priced at the
 *    generic row whatever tier was asked for.
 * 2. A pick whose ORIGINAL owner is known, for the draft after the season being played, is priced from
 *    that owner's projected finish — moving from the generic row toward the tier price as the odds firm up.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTeam: { findMany: (...a: unknown[]) => findMany(...a) } } }))

import type { FantasyCalcPlayer } from '@/lib/fantasycalc'
import {
  livePickValue,
  loadPickSlotProjection,
  priceLeagueTradePick,
  resolveAssets,
  withDatedMarket,
  type LeagueTradeChart,
} from '@/lib/trade-value-console/leagueTradePricing'
import {
  describeOdds,
  oddsCertainty,
  projectedPickPrice,
  projectedPicksNote,
  projectPickSlots,
  type PickSlotProjection,
  type StandingsTeam,
} from '@/lib/trade-value/pickSlotProjection'
import { gradeInputsFromPending } from '@/lib/decision-os/trade/tradeGradeInputs'
import { completedTradeInputs } from '@/lib/decision-os/trade/completedTradeGrade'
import type { GradedTrade, TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'

const row = (name: string, value: number) => ({ player: { name, position: 'PICK' }, value }) as FantasyCalcPlayer
/** The 12-team 1-QB PPR dynasty board's 2027 1st, as measured in production 2026-10-11. */
const CHART = [
  row('2027 1st', 2764),
  row('2027 1st (Early)', 4565),
  row('2027 1st (Mid)', 3006),
  row('2027 1st (Late)', 2328),
  row('2027 2nd', 1200),
  row('2027 2nd (Early)', 1500),
  row('2027 2nd (Mid)', 1150),
  row('2027 2nd (Late)', 950),
  row('2028 1st', 2900),
]
const pricing = { fcPlayers: CHART, nflCtx: { asOfDate: '2026-10-11', isSuperFlex: false, numTeams: 12, fantasyCalcPlayers: CHART } }

describe('tier rows are read', () => {
  it('a tiered pick prices at its tier row; an untiered one keeps the generic row', () => {
    expect(livePickValue(CHART, 2027, 1, 'early')).toBe(4565)
    expect(livePickValue(CHART, 2027, 1, 'mid')).toBe(3006)
    expect(livePickValue(CHART, 2027, 1, 'late')).toBe(2328)
    expect(livePickValue(CHART, 2027, 1, null)).toBe(2764)
  })

  it('a season with no tier rows prices every tier at its round row, as before', () => {
    expect(livePickValue(CHART, 2028, 1, 'early')).toBe(2900)
    expect(livePickValue(CHART, 2028, 1, null)).toBe(2900)
  })

  it('a chart with ONLY tier rows prices an untiered pick at their average', () => {
    const tiersOnly = CHART.filter((r) => r.player.name !== '2027 1st')
    expect(livePickValue(tiersOnly, 2027, 1, null)).toBe(Math.round((4565 + 3006 + 2328) / 3))
  })
})

const team = (id: string, wins: number, losses: number, pointsFor: number): StandingsTeam => ({ id, wins, losses, ties: 0, pointsFor })
/** Twelve teams after five games: team `t0` 0-5 and lowest scoring, up to `t11` 5-0 and highest. */
const WEEK5 = Array.from({ length: 12 }, (_, i) => team(`t${i}`, Math.round((i * 5) / 11), 5 - Math.round((i * 5) / 11), 500 + i * 20))

describe('projectPickSlots', () => {
  it('a finished season is certain: the worst four pick early, the best four late', () => {
    const p = projectPickSlots({ teams: WEEK5, seasonGames: 5, season: 2026 })!
    expect(p.draftYear).toBe(2027)
    expect(p.gamesLeft).toBe(0)
    expect(p.oddsByTeam.get('t0')).toEqual({ early: 1, mid: 0, late: 0 })
    expect(p.oddsByTeam.get('t5')).toEqual({ early: 0, mid: 1, late: 0 })
    expect(p.oddsByTeam.get('t11')).toEqual({ early: 0, mid: 0, late: 1 })
  })

  it('a tie in record picks earlier for the team that scored less', () => {
    const p = projectPickSlots({ teams: [team('a', 2, 3, 600), team('b', 2, 3, 500), team('c', 4, 1, 700)], seasonGames: 5, season: 2026 })!
    expect(p.oddsByTeam.get('b')!.early).toBe(1)
    expect(p.oddsByTeam.get('a')!.mid).toBe(1)
  })

  it('in week 5 of 14 a 0-5 team is likeliest early and a 5-0 team likeliest late, odds summing to 1', () => {
    const p = projectPickSlots({ teams: WEEK5, seasonGames: 14, season: 2026 })!
    expect(p.gamesLeft).toBe(9)
    const worst = p.oddsByTeam.get('t0')!
    const best = p.oddsByTeam.get('t11')!
    expect(worst.early).toBeGreaterThan(0.6)
    expect(best.late).toBeGreaterThan(0.6)
    for (const o of p.oddsByTeam.values()) expect(o.early + o.mid + o.late).toBeCloseTo(1, 10)
  })

  it('four games are a noisy read of a team: early odds stay spread, and firm up as the season runs', () => {
    const recs = [[0, 4], [1, 3], [1, 3], [1, 3], [2, 2], [2, 2], [2, 2], [2, 2], [3, 1], [3, 1], [3, 1], [4, 0]]
    const teams = recs.map(([w, l], i) => team(`t${i}`, w!, l!, 4 * (98 + i * 3.2)))
    const early = projectPickSlots({ teams, seasonGames: 14, season: 2026 })!
    const late = projectPickSlots({ teams, seasonGames: 6, season: 2026 })!
    // A 2-2 team in week 5 can still land in any third.
    expect(early.oddsByTeam.get('t5')!.early).toBeGreaterThan(0.15)
    expect(early.oddsByTeam.get('t5')!.late).toBeGreaterThan(0.1)
    // The 4-0, top-scoring team is likeliest late, but not yet certain.
    expect(early.oddsByTeam.get('t11')!.late).toBeLessThan(0.95)
    expect(late.oddsByTeam.get('t11')!.late).toBeGreaterThan(early.oddsByTeam.get('t11')!.late)
  })

  it('is reproducible: the same standings give the same odds', () => {
    const a = projectPickSlots({ teams: WEEK5, seasonGames: 14, season: 2026 })!
    const b = projectPickSlots({ teams: WEEK5, seasonGames: 14, season: 2026 })!
    expect([...a.oddsByTeam]).toEqual([...b.oddsByTeam])
  })

  it('nothing to project: fewer than three teams, or no season length', () => {
    expect(projectPickSlots({ teams: WEEK5.slice(0, 2), seasonGames: 14, season: 2026 })).toBeNull()
    expect(projectPickSlots({ teams: WEEK5, seasonGames: 0, season: 2026 })).toBeNull()
  })
})

describe('projectedPickPrice', () => {
  const prices = { early: 4565, mid: 3006, late: 2328, generic: 2764 }
  it('an even split is the market’s own price for an unplaced pick, not the tier mean', () => {
    expect(oddsCertainty({ early: 1 / 3, mid: 1 / 3, late: 1 / 3 })).toBeCloseTo(0, 10)
    expect(projectedPickPrice({ early: 1 / 3, mid: 1 / 3, late: 1 / 3 }, prices)).toBe(2764)
  })
  it('a settled third is that tier’s price', () => {
    expect(projectedPickPrice({ early: 1, mid: 0, late: 0 }, prices)).toBe(4565)
    expect(projectedPickPrice({ early: 0, mid: 0, late: 1 }, prices)).toBe(2328)
  })
  it('a likely-early pick sits between the generic and the early price', () => {
    const v = projectedPickPrice({ early: 0.75, mid: 0.2, late: 0.05 }, prices)
    expect(v).toBeGreaterThan(2764)
    expect(v).toBeLessThan(4565)
  })
  it('says the likeliest third and its odds', () => {
    expect(describeOdds({ early: 0.62, mid: 0.3, late: 0.08 })).toBe('projected early (62%)')
  })
})

const SLOTS: PickSlotProjection = {
  draftYear: 2027,
  gamesLeft: 9,
  oddsByTeam: new Map([
    ['1', { early: 1, mid: 0, late: 0 }],
    ['12', { early: 0, mid: 0, late: 1 }],
  ]),
}

describe('priceLeagueTradePick with projected slots', () => {
  it('prices a pick at its original owner’s projected tier and says so', async () => {
    const early = await priceLeagueTradePick({ year: 2027, round: 1, originalRosterId: '1' }, { ...pricing, pickSlots: SLOTS })
    const late = await priceLeagueTradePick({ year: 2027, round: 1, originalRosterId: '12' }, { ...pricing, pickSlots: SLOTS })
    expect([early.priced.value, early.dataSource, early.projection]).toEqual([4565, 'fantasycalc_pick_projected', '2027 1st projected early (100%)'])
    expect([late.priced.value, late.projection]).toEqual([2328, '2027 1st projected late (100%)'])
  })

  it('projects every round the chart tiers, not only the 1st', async () => {
    const r2 = await priceLeagueTradePick({ year: 2027, round: 2, originalRosterId: '1' }, { ...pricing, pickSlots: SLOTS })
    expect(r2.priced.value).toBe(1500)
  })

  it('[control] unchanged without the owner, for an unknown owner, for another draft, or without slots', async () => {
    const base = { ...pricing, pickSlots: SLOTS }
    for (const [pick, args] of [
      [{ year: 2027, round: 1 }, base],
      [{ year: 2027, round: 1, originalRosterId: '7' }, base],
      [{ year: 2028, round: 1, originalRosterId: '1' }, base],
      [{ year: 2027, round: 1, originalRosterId: '1' }, pricing],
    ] as const) {
      const r = await priceLeagueTradePick(pick, args)
      expect({ pick, dataSource: r.dataSource, projection: r.projection }).toEqual({ pick, dataSource: 'fantasycalc_pick', projection: undefined })
      expect(r.priced.value).toBe(pick.year === 2028 ? 2900 : 2764)
    }
  })

  it('a tier the manager named wins over the projection', async () => {
    const r = await priceLeagueTradePick({ year: 2027, round: 1, tier: 'late', originalRosterId: '1' }, { ...pricing, pickSlots: SLOTS })
    expect([r.priced.value, r.projection]).toEqual([2328, undefined])
  })

  it('a round the chart does not tier keeps its round row', async () => {
    const noTiers = [row('2027 1st', 2764)]
    const r = await priceLeagueTradePick({ year: 2027, round: 1, originalRosterId: '1' }, { fcPlayers: noTiers, nflCtx: { ...pricing.nflCtx, fantasyCalcPlayers: noTiers }, pickSlots: SLOTS })
    expect([r.priced.value, r.projection]).toEqual([2764, undefined])
  })

  it('the evaluator prices it the same and reports the projection for the grade’s note', async () => {
    const out = await resolveAssets([{ kind: 'pick', year: 2027, round: 1, originalRosterId: '1' }], {
      ...pricing, pickSlots: SLOTS, effectiveSport: 'NFL', waiverBudget: 100, dataGaps: [],
    })
    expect(out.lines[0]!.marketValue).toBe(4565)
    expect(out.pickProjections).toEqual(['2027 1st projected early (100%)'])
    expect(projectedPicksNote(out.pickProjections)).toBe(
      "Picks priced by where they are projected to land, from this season's standings (reverse order of record): 2027 1st projected early (100%).",
    )
    expect(projectedPicksNote([])).toBeNull()
  })
})

describe('the chart', () => {
  it('a dated chart (a past trade on its trade-date market) drops today’s projection', () => {
    const chart = { fcPlayers: CHART, nflCtx: pricing.nflCtx, pickSlots: SLOTS } as unknown as LeagueTradeChart
    expect(withDatedMarket(chart, { capturedOn: '2026-09-01', players: CHART }).pickSlots).toBeNull()
  })

  beforeEach(() => findMany.mockReset())

  it('loads current franchises by provider roster id, the season length from the league’s playoff week', async () => {
    findMany.mockResolvedValue(WEEK5.map((t) => ({ externalId: t.id, wins: t.wins, losses: t.losses, ties: 0, pointsFor: t.pointsFor })))
    const p = await loadPickSlotProjection({ leagueId: 'L1', settings: { playoff_week_start: 15 }, season: 2026 })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L1', lifecycleState: { not: 'ARCHIVED' } } }))
    expect(p).toMatchObject({ draftYear: 2027, gamesLeft: 9 })
    expect(p!.oddsByTeam.size).toBe(12)
  })

  it('no season length or no season: nothing loaded', async () => {
    expect(await loadPickSlotProjection({ leagueId: 'L1', settings: {}, season: 2026 })).toBeNull()
    expect(await loadPickSlotProjection({ leagueId: 'L1', settings: { playoff_week_start: 15 }, season: null })).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('the inputs carry the original owner', () => {
  it('a pending Sleeper offer', () => {
    const inputs = gradeInputsFromPending([
      { playerName: '2027 1st', isPick: true, pickYear: 2027, pickRoundNumber: 1, pickOriginalRosterExternalId: '4' },
      { playerName: '2027 2nd', isPick: true, pickYear: 2027, pickRoundNumber: 2, pickOriginalRosterExternalId: '' },
    ])
    expect(inputs.assets).toEqual([
      { kind: 'pick', year: 2027, round: 1, originalRosterId: '4' },
      { kind: 'pick', year: 2027, round: 2 },
    ])
  })

  it('a completed trade on the ledger', () => {
    const side = (o: Partial<TradeSideGrade>): TradeSideGrade => ({
      rosterId: 1, managerName: 'a', ownerId: '1', teamName: null, avatar: null,
      playersIn: [], playersOut: [], picksIn: [], picksOut: [],
      madePlayoffs: null, seasonNets: [], cumulativeNet: 0, initialGrade: 'C', currentGrade: 'C', trend: 'steady', ...o,
    })
    const pick = { season: '2027', round: 1, originalRosterId: 6, label: '2027 round 1', resolved: null, pending: true, rerouted: false }
    const t: GradedTrade = {
      id: 'L:1', season: '2026', week: 5, createdIso: '2026-10-08T00:00:00.000Z', multiTeam: false, tie: false, hasPendingPicks: true,
      sides: [side({ picksIn: [pick] }), side({ rosterId: 2, picksOut: [pick] })],
    }
    expect(completedTradeInputs(t, 2026)!.get.assets).toEqual([{ kind: 'pick', year: 2027, round: 1, originalRosterId: '6' }])
  })
})
