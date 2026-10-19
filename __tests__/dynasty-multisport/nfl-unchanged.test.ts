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
      return { projectionId: 'p', teamId: input.teamId, leagueId: input.leagueId, sport: 'NFL', championshipWindowScore: 0, rebuildProbability: 0, rosterStrength3Year: 0, rosterStrength5Year: 0, agingRiskScore: 0, futureAssetScore: 0, createdAt: new Date().toISOString() }
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

const NFL_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DST', 'FLEX', 'UTIL']

/**
 * NFL outputs must be byte-identical to origin/main (648cd539) after the multi-sport aging / pick
 * changes. `nfl-baseline.origin-main.json` was produced by running THIS file's snapshot code against
 * the unmodified origin/main sources (CAPTURE_OUT=<path> writes it). Covers: getPeakAgeRange,
 * AgingCurveService, RosterFutureValueCalculator, DraftPickValueModel + getPickValue (no sport AND
 * sport='NFL'), DynastyProjectionService curve/trend/trajectory/breakdown, and the
 * dynasty-projections handler's NFL player values.
 */
describe('NFL dynasty outputs are unchanged from origin/main', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2027-04-15T12:00:00Z')) })
  afterAll(() => vi.useRealTimers())
  it('matches the origin/main baseline exactly', async () => {
    const out: any = { peak: {}, age: {}, rosterRisk: 0, rfv: [], picks: [], pickBreakdown: null, dps: {}, handler: null }
    for (const p of NFL_POS) out.peak[p] = getPeakAgeRange('NFL', p)
    for (const p of NFL_POS) for (let a = 19; a <= 40; a++) for (const h of ['next', 'three', 'five'] as const) out.age[`${p}|${a}|${h}`] = ageMultiplier('NFL', p, a, h)
    const roster = NFL_POS.flatMap((p, i) => [21, 25, 28, 31, 34].map((a, j) => ({ playerId: `${p}${a}`, name: 'x', position: p, age: a, dynastyValue: 1000 + i * 350 + j * 120, recentInjuryScore: (i + j) % 3 / 10 })))
    roster.push({ playerId: 'noage', name: 'x', position: 'WR', age: null as any, dynastyValue: 3000, recentInjuryScore: 0 })
    out.rosterRisk = rosterAgingRiskScore('NFL', roster)
    for (const ctxs of [
      { sport: 'NFL', season: 2027, isDynasty: true, isSuperFlex: false, isTightEndPremium: false, teamCount: 12 },
      { sport: 'NFL', season: 2027, isDynasty: true, isSuperFlex: true, isTightEndPremium: true, teamCount: 10 },
    ]) out.rfv.push(calculateRosterFutureValue(roster, ctxs))
    for (const year of [2026, 2027, 2028, 2029, 2030, 2031]) for (const round of [1, 2, 3, 4, 5, 6, 7]) for (const dyn of [true, false]) for (const slot of [undefined, 1, 6, 12]) out.picks.push(getPickValue(year, round, dyn, slot, slot ? 12 : undefined))
    out.pickBreakdown = valueFuturePicks([2027, 2028, 2029, 2030].flatMap((s) => [1, 2, 3, 4, 5].map((r) => ({ season: s, round: r, pickNumber: r * 2, ownerTeamId: 't' }))), { sport: 'NFL', season: 2027, isDynasty: true, isSuperFlex: false, isTightEndPremium: false, teamCount: 12 })
    for (const p of ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'HB']) for (const a of [22, 27, 31, 35]) {
      const curve = getAgeCurve('NFL', p, a)
      const trend = buildDeterministicMarketValueTrend({ sport: 'NFL', position: p, age: a, currentValue: 5000, ageCurve: curve })
      const traj = getCareerTrajectory('NFL', p, a, 5000, trend)
      const bd = [false, true].map((sf) => buildDynastyValuationBreakdown({ sport: 'NFL', position: curve.position, age: a, currentValue: 5000, ageCurve: curve, marketValueTrend: trend, careerTrajectory: traj, isSuperFlex: sf, isTightEndPremium: sf }))
      const { updatedAt, ...trendRest } = trend as any
      out.dps[`${p}|${a}`] = { curve: { ...curve, points: curve.points.map((pt) => pt.multiplier) }, trend: trendRest, traj, bd }
    }
    setLeague('NFL', [
      { externalId: 'A', players: NFL_POS.map((p, i) => ({ id: `a${i}`, name: `A ${p}`, position: p, birthYear: 1995 + i })) },
    ])
    const res = await GET(makeReq('refresh=1'), ctx)
    expect(res.status).toBe(200)
    out.handler = state.generatedInputs.map((i: any) => ({ teamId: i.teamId, players: i.players, futurePicks: i.futurePicks }))
    if (process.env.CAPTURE_OUT) {
      writeFileSync(process.env.CAPTURE_OUT, JSON.stringify(out))
      return
    }
    const baseline = JSON.parse(readFileSync(join(__dirname, 'nfl-baseline.origin-main.json'), 'utf8'))
    // Blindness guard: the fixture must actually hold data for every section.
    expect(Object.keys(baseline.age).length).toBeGreaterThan(500)
    expect(baseline.handler[0].players.length).toBe(NFL_POS.length)
    expect(out).toEqual(baseline)
  })
})
