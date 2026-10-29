import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./handlerHarness')).prismaMock }))
vi.mock('@/lib/api/require-league-access', () => ({ requireLeagueApiAccess: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/player-identity/findSportsPlayerByLeagueId', () => ({
  findSportsPlayersForLeague: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/dynasty-engine/DynastyQueryService', () => ({ getDynastyProjectionsForLeague: vi.fn(async () => []) }))
vi.mock('@/lib/dynasty-engine/DynastyProjectionGenerator', async () => {
  const h = await import('./handlerHarness')
  return {
    generateDynastyProjection: vi.fn(async (input: any) => {
      h.state.generatedInputs.push(input)
      return { projectionId: 'p', teamId: input.teamId, leagueId: input.leagueId, sport: input.leagueContext.sport, championshipWindowScore: 0, rebuildProbability: 0, rosterStrength3Year: 0, rosterStrength5Year: 0, agingRiskScore: 0, futureAssetScore: 0, createdAt: new Date().toISOString() }
    }),
  }
})

import { getPeakAgeRange } from '@/lib/dynasty-engine/SportDynastyResolver'
import { ageMultiplier, rosterAgingRiskScore } from '@/lib/dynasty-engine/AgingCurveService'
import { calculateRosterFutureValue } from '@/lib/dynasty-projection/RosterFutureValueCalculator'
import { valueFuturePicks } from '@/lib/dynasty-projection/DraftPickValueModel'
import { getPickValue } from '@/lib/fantasycalc'
import { getAgeCurve, getCareerTrajectory, buildDynastyValuationBreakdown, buildDeterministicMarketValueTrend } from '@/lib/dynasty-intelligence'
import { GET } from '@/app/api/leagues/[leagueId]/dynasty-projections/handler'
import { setLeague, makeReq, ctx, state } from './handlerHarness'

/**
 * MLB / NBA / NHL outputs must be byte-identical to origin/main (3335d1d3, after #2513) when the
 * college and soccer dynasty models change. `pro-sports-baseline.origin-main.json` was produced by
 * running THIS file against the unmodified origin/main sources (CAPTURE_OUT=<path> writes it).
 * The NFL equivalent is nfl-unchanged.test.ts.
 *
 * ⚠ RE-CAPTURED ONCE, DELIBERATELY, for the rookie-draft calendar fix: NHL's rookie draft moved from
 * August to July (after the late-June Entry Draft), so at the pinned 2027-04-15 the 2027 NHL picks
 * (56 values, plus 2 in `pickBreakdown`) now carry the 90-day pre-draft bump (x1.03). A structural
 * diff of old vs new showed those NHL pick values and nothing else changed.
 */
const POS: Record<string, string[]> = {
  MLB: ['SP', 'RP', 'P', 'C', '1B', '2B', '3B', 'SS', 'OF', 'CF', 'DH', 'UTIL', 'ZZ'],
  NBA: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'F-C', 'UTIL', 'ZZ'],
  NHL: ['C', 'LW', 'RW', 'W', 'F', 'D', 'G', 'UTIL', 'ZZ'],
}

describe('MLB / NBA / NHL dynasty outputs are unchanged from origin/main', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2027-04-15T12:00:00Z')) })
  afterAll(() => vi.useRealTimers())

  it('matches the origin/main baseline exactly', async () => {
    const out: any = {}
    for (const sport of ['MLB', 'NBA', 'NHL']) {
      const positions = POS[sport]
      const o: any = { peak: {}, age: {}, rosterRisk: 0, rfv: [], picks: [], pickBreakdown: null, dps: {}, handler: null }
      for (const p of positions) o.peak[p] = getPeakAgeRange(sport, p)
      for (const p of positions) for (let a = 19; a <= 40; a++) for (const h of ['next', 'three', 'five'] as const) o.age[`${p}|${a}|${h}`] = ageMultiplier(sport, p, a, h)
      const roster = positions.flatMap((p, i) => [21, 25, 28, 31, 34].map((a, j) => ({ playerId: `${p}${a}`, name: 'x', position: p, age: a, dynastyValue: 1000 + i * 350 + j * 120, recentInjuryScore: (i + j) % 3 / 10 })))
      roster.push({ playerId: 'noage', name: 'x', position: positions[0], age: null as any, dynastyValue: 3000, recentInjuryScore: 0 })
      o.rosterRisk = rosterAgingRiskScore(sport, roster)
      for (const flags of [{ sf: false, tep: false, n: 12 }, { sf: true, tep: true, n: 10 }]) {
        o.rfv.push(calculateRosterFutureValue(roster, { sport, season: 2027, isDynasty: true, isSuperFlex: flags.sf, isTightEndPremium: flags.tep, teamCount: flags.n }))
      }
      for (const year of [2026, 2027, 2028, 2029, 2030, 2031]) for (const round of [1, 2, 3, 4, 5, 6, 7]) for (const dyn of [true, false]) for (const slot of [undefined, 1, 6, 12]) o.picks.push(getPickValue(year, round, dyn, slot, slot ? 12 : undefined, sport))
      o.pickBreakdown = valueFuturePicks([2027, 2028, 2029, 2030].flatMap((s) => [1, 2, 3, 4, 5].map((r) => ({ season: s, round: r, pickNumber: r * 2, ownerTeamId: 't' }))), { sport, season: 2027, isDynasty: true, isSuperFlex: false, isTightEndPremium: false, teamCount: 12 })
      for (const p of positions) for (const a of [22, 27, 31, 35]) {
        const curve = getAgeCurve(sport, p, a)
        const trend = buildDeterministicMarketValueTrend({ sport, position: curve.position, age: a, currentValue: 5000, ageCurve: curve })
        const traj = getCareerTrajectory(sport, p, a, 5000, trend)
        const bd = [false, true].map((sf) => buildDynastyValuationBreakdown({ sport, position: curve.position, age: a, currentValue: 5000, ageCurve: curve, marketValueTrend: trend, careerTrajectory: traj, isSuperFlex: sf, isTightEndPremium: sf }))
        const { updatedAt, ...trendRest } = trend as any
        o.dps[`${p}|${a}`] = { curve: { ...curve, points: curve.points.map((pt) => pt.multiplier) }, trend: trendRest, traj, bd }
      }
      state.generatedInputs.length = 0
      setLeague(sport, [
        { externalId: 'A', players: positions.map((p, i) => ({ id: `a${i}`, name: `A ${p}`, position: p, birthYear: 1990 + i })) },
      ])
      const res = await GET(makeReq('refresh=1'), ctx)
      expect(res.status).toBe(200)
      o.handler = state.generatedInputs.map((i: any) => ({ teamId: i.teamId, players: i.players, futurePicks: i.futurePicks }))
      out[sport] = o
    }
    if (process.env.CAPTURE_OUT) {
      writeFileSync(process.env.CAPTURE_OUT, JSON.stringify(out))
      return
    }
    const baseline = JSON.parse(readFileSync(join(__dirname, 'pro-sports-baseline.origin-main.json'), 'utf8'))
    // Blindness guard: the fixture must actually hold data for every sport and section.
    for (const sport of ['MLB', 'NBA', 'NHL']) {
      expect(Object.keys(baseline[sport].age).length).toBeGreaterThan(500)
      expect(baseline[sport].picks.length).toBe(336)
      expect(baseline[sport].handler[0].players.length).toBe(POS[sport].length)
    }
    expect(out).toEqual(baseline)
  })
})
