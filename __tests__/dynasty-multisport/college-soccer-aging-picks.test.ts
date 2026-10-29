import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { getPeakAgeRange, isCollegeDynastySport, hasNativeAgingCurve } from '@/lib/dynasty-engine/SportDynastyResolver'
import { ageMultiplier, rosterAgingRiskScore } from '@/lib/dynasty-engine/AgingCurveService'
import { calculateRosterFutureValue } from '@/lib/dynasty-projection/RosterFutureValueCalculator'
import { valueFuturePicks } from '@/lib/dynasty-projection/DraftPickValueModel'
import { getPickValue } from '@/lib/fantasycalc'
import { DYNASTY_SPORT_CONFIGS, getDynastySportConfig } from '@/lib/dynasty-core/dynastySportConfig'
import { buildDynastyValuationBreakdown, getAgeCurve, getCareerTrajectory } from '@/lib/dynasty-intelligence'
import type { DynastyLeagueContext, PlayerDynastyAsset } from '@/lib/dynasty-projection/types'
import { GET } from '@/app/api/leagues/[leagueId]/dynasty-projections/handler'
import { ctx, makeReq, setLeague, state } from './handlerHarness'

const ctxFor = (sport: string, extra: Partial<DynastyLeagueContext> = {}): DynastyLeagueContext => ({
  sport,
  season: 2027,
  isDynasty: true,
  isSuperFlex: false,
  isTightEndPremium: false,
  teamCount: 12,
  ...extra,
})

const player = (position: string, age: number, dynastyValue = 5000): PlayerDynastyAsset => ({
  playerId: `${position}-${age}`,
  name: position,
  position,
  age,
  dynastyValue,
})

const breakdown = (sport: string, position: string, age: number, sf: boolean) => {
  const ageCurve = getAgeCurve(sport, position, age)
  return buildDynastyValuationBreakdown({
    sport,
    position: ageCurve.position,
    age,
    currentValue: 5000,
    ageCurve,
    marketValueTrend: null,
    careerTrajectory: null,
    isSuperFlex: sf,
    isTightEndPremium: sf,
  })!
}

describe('SOCCER — per-position aging curves', () => {
  it('goalkeepers peak and decline later than every outfield group', () => {
    const gk = getPeakAgeRange('SOCCER', 'GK')
    for (const p of ['FWD', 'MID', 'DEF']) {
      const r = getPeakAgeRange('SOCCER', p)
      expect(gk).not.toEqual(r)
      expect(gk.peakStart).toBeGreaterThan(r.peakStart)
      expect(gk.peakEnd).toBeGreaterThan(r.peakEnd)
      expect(gk.hardCliff).toBeGreaterThan(r.hardCliff)
    }
  })

  it('outfield groups differ: forwards decline first, defenders last', () => {
    const fwd = getPeakAgeRange('SOCCER', 'FWD')
    const mid = getPeakAgeRange('SOCCER', 'MID')
    const def = getPeakAgeRange('SOCCER', 'DEF')
    expect(fwd.peakEnd).toBeLessThan(mid.peakEnd)
    expect(mid.peakEnd).toBeLessThan(def.peakEnd)
    expect(fwd.hardCliff).toBeLessThan(mid.hardCliff)
    expect(mid.hardCliff).toBeLessThan(def.hardCliff)
  })

  it('common soccer labels resolve to their group', () => {
    for (const [alias, group] of [['ST', 'FWD'], ['F', 'FWD'], ['FW', 'FWD'], ['M', 'MID'], ['MF', 'MID'], ['D', 'DEF'], ['DF', 'DEF'], ['G', 'GK'], ['GKP', 'GK']]) {
      expect(getPeakAgeRange('SOCCER', alias)).toEqual(getPeakAgeRange('SOCCER', group))
    }
  })

  it('AgingCurveService: a 33-year-old keeper holds value a 33-year-old striker has lost', () => {
    expect(ageMultiplier('SOCCER', 'GK', 33, 'next')).toBeGreaterThan(ageMultiplier('SOCCER', 'FWD', 33, 'next'))
    expect(ageMultiplier('SOCCER', 'GK', 30, 'next')).toBe(1)
    expect(ageMultiplier('SOCCER', 'FWD', 30, 'next')).toBeLessThan(1)
  })

  it('RosterFutureValueCalculator uses the soccer curve and accrues aging risk', () => {
    expect(hasNativeAgingCurve('SOCCER')).toBe(true)
    const gk = calculateRosterFutureValue([player('GK', 31)], ctxFor('SOCCER'))
    const fwd = calculateRosterFutureValue([player('FWD', 31)], ctxFor('SOCCER'))
    expect(gk.threeYearStrength).toBeGreaterThan(fwd.threeYearStrength)
    expect(fwd.agingRiskScore).toBeGreaterThan(0)
    expect(calculateRosterFutureValue([player('MID', 22)], ctxFor('SOCCER')).agingRiskScore).toBe(0)
  })

  it('DynastyProjectionService no longer runs keepers on the NFL QB curve or defenders on the TE curve', () => {
    const gk = getAgeCurve('SOCCER', 'GK', 34)
    expect(gk.cliffAge).toBe(getPeakAgeRange('SOCCER', 'GK').hardCliff)
    expect(getAgeCurve('SOCCER', 'GK', 33).currentMultiplier!).toBeGreaterThan(getAgeCurve('SOCCER', 'FWD', 33).currentMultiplier!)
    for (const p of ['GK', 'DEF', 'MID', 'FWD']) {
      const off = breakdown('SOCCER', p, 26, false)
      const on = breakdown('SOCCER', p, 26, true)
      expect(on.positionMultiplier).toBe(off.positionMultiplier) // no superflex / TE-premium leak
      expect(off.positionMultiplier).not.toBe(1.6)
    }
  })
})

describe('NCAAF / NCAAB — no pro-style age decline', () => {
  const COLLEGE_AGES = [17, 18, 19, 20, 21, 22, 23, 24, 25]

  it('is the declared model for exactly the two college sports', () => {
    expect(isCollegeDynastySport('NCAAF')).toBe(true)
    expect(isCollegeDynastySport('ncaab')).toBe(true)
    for (const s of ['NFL', 'NBA', 'MLB', 'NHL', 'SOCCER']) expect(isCollegeDynastySport(s)).toBe(false)
  })

  it('AgingCurveService applies no age effect at any horizon', () => {
    for (const [sport, positions] of [['NCAAF', ['QB', 'RB', 'WR', 'TE', 'K']], ['NCAAB', ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F']]] as const) {
      for (const p of positions) for (const a of COLLEGE_AGES) for (const h of ['next', 'three', 'five'] as const) {
        expect(ageMultiplier(sport, p, a, h)).toBe(1)
      }
    }
    const roster = COLLEGE_AGES.map((a) => ({ position: 'RB', age: a, dynastyValue: 4000 }))
    expect(rosterAgingRiskScore('NCAAF', roster)).toBe(0)
  })

  it('RosterFutureValueCalculator: a college roster does not decay with age, and accrues no aging risk', () => {
    // On the NFL curve a 23-year-old RB is at 27 by the five-year horizon (declining), and an
    // 18-year-old takes the pre-peak discount. Neither is a college effect.
    for (const sport of ['NCAAF', 'NCAAB']) {
      const roster = [player(sport === 'NCAAF' ? 'RB' : 'PG', 23), player(sport === 'NCAAF' ? 'WR' : 'C', 18)]
      const r = calculateRosterFutureValue(roster, ctxFor(sport))
      expect(r.nextYearStrength).toBe(10000)
      expect(r.threeYearStrength).toBe(10000)
      expect(r.fiveYearStrength).toBe(10000)
      expect(r.agingRiskScore).toBe(0)
    }
    const nfl = calculateRosterFutureValue([player('RB', 23)], ctxFor('NFL'))
    expect(nfl.fiveYearStrength).toBeLessThan(5000) // the behaviour college no longer inherits
  })

  it('DynastyProjectionService: flat age multiplier and no NFL-length window', () => {
    for (const [sport, p] of [['NCAAF', 'QB'], ['NCAAF', 'RB'], ['NCAAB', 'PG'], ['NCAAB', 'C']] as const) {
      for (const a of COLLEGE_AGES) expect(getAgeCurve(sport, p, a).currentMultiplier).toBe(1)
      const traj = getCareerTrajectory(sport, p, 20, 5000)
      expect(traj.points.every((pt) => pt.ageMultiplier === 1)).toBe(true)
      expect(traj.points.every((pt) => pt.projectedValue === 5000)).toBe(true)
      // NFL QB at 20 reads a 12-year career window; college age says nothing about remaining eligibility.
      expect(traj.expectedWindowYears).toBe(5)
    }
  })

  it('NCAAB guards no longer take the NFL superflex QB multiplier; NCAAF QBs keep it (a real CFB setting)', () => {
    const pgOff = breakdown('NCAAB', 'PG', 20, false)
    const pgOn = breakdown('NCAAB', 'PG', 20, true)
    expect(pgOn.positionMultiplier).toBe(pgOff.positionMultiplier)
    expect(pgOn.positionMultiplier).not.toBe(1.6)
    expect(breakdown('NCAAF', 'QB', 20, true).positionMultiplier).toBe(1.6)
    expect(breakdown('NCAAF', 'QB', 20, false).positionMultiplier).toBe(0.95)
  })
})

describe('pick values follow each sport\'s rookie-draft calendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => vi.useRealTimers())

  it('reads the months it is meant to from dynastySportConfig', () => {
    expect(getDynastySportConfig('soccer').offseason.rookieDraftMonth).toBe(7)
    expect(getDynastySportConfig('ncaaf').offseason.rookieDraftMonth).toBe(1)
    expect(getDynastySportConfig('ncaab').offseason.rookieDraftMonth).toBe(5)
  })

  it('pre-draft bump lands in each sport\'s own window, not NFL\'s May 1', () => {
    // Mid-December: the NCAAF January draft is inside 30 days; NFL / NCAAB / SOCCER are not.
    vi.setSystemTime(new Date('2026-12-15T12:00:00Z'))
    expect(getPickValue(2027, 1, true, undefined, undefined, 'NCAAF')).toBe(Math.round(6000 * 0.92 * 1.06))
    expect(getPickValue(2027, 1, true, undefined, undefined, 'NFL')).toBe(Math.round(6000 * 0.92))
    expect(getPickValue(2027, 1, true, undefined, undefined, 'NCAAB')).toBe(Math.round(6000 * 0.92))

    // Mid-April: NCAAB (May) is inside 30 days like NFL; SOCCER (July) is inside 90; NCAAF's has passed.
    vi.setSystemTime(new Date('2027-04-15T12:00:00Z'))
    expect(getPickValue(2027, 1, true, undefined, undefined, 'NCAAB')).toBe(Math.round(6000 * 1.06))
    expect(getPickValue(2027, 1, true, undefined, undefined, 'SOCCER')).toBe(Math.round(6000 * 1.03))
    expect(getPickValue(2027, 1, true, undefined, undefined, 'NCAAF')).toBe(6000)

    // Mid-June: SOCCER (July) is now inside 30 days; NFL's has passed.
    vi.setSystemTime(new Date('2027-06-15T12:00:00Z'))
    expect(getPickValue(2027, 1, true, undefined, undefined, 'SOCCER')).toBe(Math.round(6000 * 1.06))
    expect(getPickValue(2027, 1, true, undefined, undefined, 'NFL')).toBe(6000)
  })

  it('round curve stretches over each sport\'s own rookie-draft length', () => {
    vi.setSystemTime(new Date('2027-10-01T12:00:00Z'))
    expect(getDynastySportConfig('ncaab').rookieDraftRounds).toBe(3)
    // NCAAB's last (3rd) round is priced like a last round, not like an NFL 3rd.
    expect(getPickValue(2028, 3, true, undefined, undefined, 'NCAAB')).toBe(getPickValue(2028, 5, true))
    expect(getPickValue(2028, 3, true, undefined, undefined, 'NCAAB')).toBeLessThan(getPickValue(2028, 3, true))
    for (const s of ['NCAAF', 'SOCCER']) {
      expect(getPickValue(2028, 4, true, undefined, undefined, s)).toBe(getPickValue(2028, 5, true))
      expect(getPickValue(2028, 6, true, undefined, undefined, s)).toBeLessThan(getPickValue(2028, 5, true, undefined, undefined, s))
    }
  })

  it('valueFuturePicks passes the league sport through', () => {
    vi.setSystemTime(new Date('2027-04-15T12:00:00Z'))
    const picks = [{ season: 2027, round: 1, ownerTeamId: 't' }, { season: 2027, round: 3, ownerTeamId: 't' }]
    for (const s of ['NCAAF', 'NCAAB', 'SOCCER']) {
      expect(valueFuturePicks(picks, ctxFor(s)).totalDynastyValue).toBe(
        getPickValue(2027, 1, true, undefined, 12, s) + getPickValue(2027, 3, true, undefined, 12, s)
      )
    }
    expect(valueFuturePicks(picks, ctxFor('NCAAB')).totalDynastyValue).not.toBe(valueFuturePicks(picks, ctxFor('NFL')).totalDynastyValue)
  })
})

describe('dynastySportConfig calendar sanity', () => {
  it('NHL Entry Draft is in June (late June every year), not July', () => {
    expect(getDynastySportConfig('nhl').offseason.proDraftMonth).toBe(6)
  })

  it('pro-draft months match the real drafts', () => {
    const expected: Record<string, number> = {
      nfl: 4, // NFL Draft, late April
      nba: 6, // NBA Draft, late June
      mlb: 7, // MLB Draft, All-Star week in July
      nhl: 6, // NHL Entry Draft, late June
      ncaaf: 4, // the NFL Draft is where college football players leave
      ncaab: 6, // ...and the NBA Draft for college basketball
    }
    for (const [k, m] of Object.entries(expected)) expect(DYNASTY_SPORT_CONFIGS[k].offseason.proDraftMonth).toBe(m)
  })
})

describe('dynasty-projections handler — no position-label collisions for college and soccer', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-04-15T12:00:00Z'))
  })
  afterAll(() => vi.useRealTimers())

  const valueOf = (playerId: string) =>
    state.generatedInputs.flatMap((i: any) => i.players).find((p: any) => p.playerId === playerId)?.dynastyValue

  async function priceOne(sport: string, position: string, birthYear: number): Promise<number> {
    const id = `${sport}-${position}-${birthYear}`
    setLeague(sport, [{ externalId: 'A', players: [{ id, name: id, position, birthYear }] }])
    const res = await GET(makeReq('refresh=1'), ctx)
    expect(res.status).toBe(200)
    return valueOf(id)
  }

  it('NCAAF reuses the NFL position table (same labels), with no age effect', async () => {
    // 1999 -> 28 in 2027: inside the NFL QB peak, so the NFL value carries no age adjustment either.
    expect(await priceOne('NCAAF', 'QB', 2006)).toBe(await priceOne('NFL', 'QB', 1999))
    expect(await priceOne('NCAAF', 'RB', 2004)).toBe(await priceOne('NCAAF', 'RB', 2008))
  })

  it('NCAAB G / F / C are basketball values — not NHL goalie, NHL forward or MLB catcher', async () => {
    const ncaabG = await priceOne('NCAAB', 'G', 2006)
    expect(ncaabG).toBe(await priceOne('NBA', 'G', 1999))
    expect(ncaabG).not.toBe(await priceOne('NHL', 'G', 1999))
    expect(await priceOne('NCAAB', 'C', 2006)).toBeGreaterThan(await priceOne('MLB', 'C', 1999))
  })

  it('soccer D / G / F / ST are soccer values, not NFL DST / NHL D / NHL G', async () => {
    const soccerD = await priceOne('SOCCER', 'D', 2000)
    expect(soccerD).toBe(await priceOne('SOCCER', 'DEF', 2000))
    expect(soccerD).toBeGreaterThan(await priceOne('NFL', 'DEF', 2000))
    expect(await priceOne('SOCCER', 'G', 1999)).toBe(await priceOne('SOCCER', 'GK', 1999))
    expect(await priceOne('SOCCER', 'ST', 2000)).toBe(await priceOne('SOCCER', 'FWD', 2000))
    expect(await priceOne('SOCCER', 'MF', 2000)).toBe(await priceOne('SOCCER', 'MID', 2000))
  })
})
