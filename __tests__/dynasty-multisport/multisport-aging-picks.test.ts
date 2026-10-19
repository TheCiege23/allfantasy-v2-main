import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPeakAgeRange } from '@/lib/dynasty-engine/SportDynastyResolver'
import { ageMultiplier } from '@/lib/dynasty-engine/AgingCurveService'
import { calculateRosterFutureValue } from '@/lib/dynasty-projection/RosterFutureValueCalculator'
import { valueFuturePicks } from '@/lib/dynasty-projection/DraftPickValueModel'
import { getPickValue } from '@/lib/fantasycalc'
import { getDynastySportConfig } from '@/lib/dynasty-core/dynastySportConfig'
import {
  buildDynastyValuationBreakdown,
  getAgeCurve,
  getCareerTrajectory,
} from '@/lib/dynasty-intelligence'
import type { DynastyLeagueContext, PlayerDynastyAsset } from '@/lib/dynasty-projection/types'

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

describe('getPeakAgeRange — per-position curves for MLB / NHL / NBA', () => {
  it('keeps the public return shape (War Room calls this)', () => {
    for (const [s, p] of [['NFL', 'QB'], ['MLB', 'SP'], ['NHL', 'G'], ['NBA', 'C'], ['MLB', 'NOPE'], ['SOCCER', 'GK']]) {
      const r = getPeakAgeRange(s, p)
      expect(Object.keys(r).sort()).toEqual(['hardCliff', 'peakEnd', 'peakStart'])
      expect(r.peakStart).toBeLessThan(r.peakEnd)
      expect(r.peakEnd).toBeLessThan(r.hardCliff)
    }
  })

  it('MLB starting pitchers age differently from hitters, and catchers earlier than other hitters', () => {
    const sp = getPeakAgeRange('MLB', 'SP')
    const hitter = getPeakAgeRange('MLB', '1B')
    const catcher = getPeakAgeRange('MLB', 'C')
    expect(sp).not.toEqual(hitter)
    expect(sp.hardCliff).toBeLessThan(hitter.hardCliff)
    expect(catcher.hardCliff).toBeLessThan(hitter.hardCliff)
    expect(getPeakAgeRange('MLB', 'RP').hardCliff).toBeLessThanOrEqual(sp.hardCliff)
    // outfield sub-labels resolve to the hitter curve
    expect(getPeakAgeRange('MLB', 'CF')).toEqual(getPeakAgeRange('MLB', 'OF'))
  })

  it('NHL goalies age differently from skaters; defense sits between', () => {
    const g = getPeakAgeRange('NHL', 'G')
    const c = getPeakAgeRange('NHL', 'C')
    const d = getPeakAgeRange('NHL', 'D')
    expect(g).not.toEqual(c)
    expect(g.peakEnd).toBeGreaterThan(c.peakEnd)
    expect(g.hardCliff).toBeGreaterThan(c.hardCliff)
    expect(d.hardCliff).toBeGreaterThan(c.hardCliff)
    expect(getPeakAgeRange('NHL', 'LW')).toEqual(c)
  })

  it('same label, different sport, different curve ("C" and "G" no longer collide)', () => {
    expect(getPeakAgeRange('MLB', 'C')).not.toEqual(getPeakAgeRange('NHL', 'C'))
    expect(getPeakAgeRange('NHL', 'C')).not.toEqual(getPeakAgeRange('NBA', 'C'))
    expect(getPeakAgeRange('NHL', 'G')).not.toEqual(getPeakAgeRange('NBA', 'G'))
  })

  it('NBA stays sane: bigs no earlier than guards, generic slots resolve to a group', () => {
    for (const p of ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL']) {
      const r = getPeakAgeRange('NBA', p)
      expect(r.peakStart).toBeGreaterThanOrEqual(24)
      expect(r.hardCliff).toBeLessThanOrEqual(37)
    }
    expect(getPeakAgeRange('NBA', 'C').peakEnd).toBeGreaterThanOrEqual(getPeakAgeRange('NBA', 'PG').peakEnd)
    expect(getPeakAgeRange('NBA', 'F-C')).toEqual(getPeakAgeRange('NBA', 'C'))
  })

  it('AgingCurveService follows the per-position curve: a 34-year-old MLB SP is worth less than a 34-year-old 1B', () => {
    expect(ageMultiplier('MLB', 'SP', 34, 'next')).toBeLessThan(ageMultiplier('MLB', '1B', 34, 'next'))
    expect(ageMultiplier('NHL', 'G', 32, 'next')).toBeGreaterThan(ageMultiplier('NHL', 'C', 32, 'next'))
  })
})

describe('RosterFutureValueCalculator routes MLB / NBA / NHL through the sport-aware curve', () => {
  it('an NHL goalie no longer falls to the NFL 25/29/32 default', () => {
    // NFL default curve would put a 31-year-old at the 2/3 point of its decline; the NHL goalie curve keeps him at peak.
    const r = calculateRosterFutureValue([player('G', 31)], ctxFor('NHL'))
    expect(r.nextYearStrength).toBe(5000 * ageMultiplier('NHL', 'G', 31, 'next'))
    expect(r.nextYearStrength).toBe(5000)
  })

  it('MLB SP and 1B of the same age project differently', () => {
    const sp = calculateRosterFutureValue([player('SP', 32)], ctxFor('MLB'))
    const b1 = calculateRosterFutureValue([player('1B', 32)], ctxFor('MLB'))
    expect(sp.threeYearStrength).toBeLessThan(b1.threeYearStrength)
  })

  it('non-NFL rosters accrue aging risk (it was always 0 because only QB/RB/WR/TE matched)', () => {
    const r = calculateRosterFutureValue([player('C', 33), player('D', 34)], ctxFor('NHL'))
    expect(r.agingRiskScore).toBeGreaterThan(0)
    const young = calculateRosterFutureValue([player('C', 22)], ctxFor('NHL'))
    expect(young.agingRiskScore).toBe(0)
  })

  it('superflex does not boost an NBA PG', () => {
    const a = calculateRosterFutureValue([player('PG', 26)], ctxFor('NBA'))
    const b = calculateRosterFutureValue([player('PG', 26)], ctxFor('NBA', { isSuperFlex: true }))
    expect(a).toEqual(b)
  })
})

describe('DynastyProjectionService uses per-sport curves, not NFL archetypes', () => {
  it('an MLB SP does not run the NFL QB curve (cliff 38)', () => {
    const sp = getAgeCurve('MLB', 'SP', 35)
    const nflQb = getAgeCurve('NFL', 'QB', 35)
    expect(sp.cliffAge).toBe(getPeakAgeRange('MLB', 'SP').hardCliff)
    expect(sp.currentMultiplier!).toBeLessThan(nflQb.currentMultiplier!)
    expect(sp.lifecycleStage).toBe('Cliff Risk')
  })

  it('NHL wingers and MLB catchers are not on the NFL WR / TE curves', () => {
    const lw = getAgeCurve('NHL', 'LW', 30)
    const nflWr = getAgeCurve('NFL', 'WR', 30)
    expect(lw.currentMultiplier).not.toBe(nflWr.currentMultiplier)
    const mlbC = getCareerTrajectory('MLB', 'C', 30, 5000)
    const nflTe = getCareerTrajectory('NFL', 'TE', 30, 5000)
    expect(mlbC.points.map((p) => p.ageMultiplier)).not.toEqual(nflTe.points.map((p) => p.ageMultiplier))
  })

  it('NHL goalie and NHL center produce different curves', () => {
    const g = getAgeCurve('NHL', 'G', 32)
    const c = getAgeCurve('NHL', 'C', 32)
    expect(g.currentMultiplier!).toBeGreaterThan(c.currentMultiplier!)
  })

  it('superflex / TE-premium multipliers no longer leak into NBA / MLB / NHL', () => {
    const build = (sport: string, position: string, sf: boolean) => {
      const ageCurve = getAgeCurve(sport, position, 26)
      return buildDynastyValuationBreakdown({
        sport,
        position: ageCurve.position,
        age: 26,
        currentValue: 5000,
        ageCurve,
        marketValueTrend: null,
        careerTrajectory: null,
        isSuperFlex: sf,
        isTightEndPremium: sf,
      })!
    }
    for (const [s, p] of [['NBA', 'PG'], ['MLB', 'SP'], ['NHL', 'G'], ['MLB', 'C'], ['NHL', 'D']]) {
      const off = build(s, p, false)
      const on = build(s, p, true)
      expect(on.positionMultiplier).toBe(off.positionMultiplier)
      expect(off.positionMultiplier).not.toBe(1.6)
    }
  })
})

describe('pick valuation is sport-aware', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => vi.useRealTimers())

  it('NFL with an explicit sport equals the legacy no-sport call', () => {
    vi.setSystemTime(new Date('2027-04-15T12:00:00Z'))
    for (const year of [2027, 2028, 2030]) for (const round of [1, 3, 5, 7]) for (const slot of [undefined, 1, 12]) {
      expect(getPickValue(year, round, true, slot, slot ? 12 : undefined, 'NFL')).toBe(
        getPickValue(year, round, true, slot, slot ? 12 : undefined)
      )
    }
  })

  it('the pre-draft bump follows each sport\'s rookie-draft month from dynastySportConfig', () => {
    expect(getDynastySportConfig('nfl').offseason.rookieDraftMonth).toBe(5)
    // Mid-April: 16 days before the NFL rookie draft (May), weeks before NBA's (July),
    // and MLB's January draft has already happened this year.
    vi.setSystemTime(new Date('2027-04-15T12:00:00Z'))
    const nfl = getPickValue(2027, 1, true, undefined, undefined, 'NFL')
    const nba = getPickValue(2027, 1, true, undefined, undefined, 'NBA')
    const mlb = getPickValue(2027, 1, true, undefined, undefined, 'MLB')
    expect(nfl).toBe(Math.round(6000 * 1.06))
    expect(nba).toBe(Math.round(6000 * 1.03))
    expect(mlb).toBe(6000)

    // Mid-December: MLB's January draft is now the one inside 30 days; NFL's is not.
    vi.setSystemTime(new Date('2026-12-15T12:00:00Z'))
    expect(getPickValue(2027, 1, true, undefined, undefined, 'MLB')).toBe(Math.round(6000 * 0.92 * 1.06))
    expect(getPickValue(2027, 1, true, undefined, undefined, 'NFL')).toBe(Math.round(6000 * 0.92))
  })

  it('round curve stretches over the sport\'s rookie-draft length instead of NFL\'s 5-round table', () => {
    vi.setSystemTime(new Date('2027-10-01T12:00:00Z'))
    expect(getDynastySportConfig('nba').rookieDraftRounds).toBe(4)
    // NBA's last (4th) round is priced like a last round, not like an NFL 4th.
    expect(getPickValue(2028, 4, true, undefined, undefined, 'NBA')).toBe(getPickValue(2028, 5, true))
    // Rounds past the configured length keep decaying (NFL: flat 600 forever).
    const r6 = getPickValue(2028, 6, true, undefined, undefined, 'MLB')
    const r8 = getPickValue(2028, 8, true, undefined, undefined, 'MLB')
    expect(r6).toBeLessThan(getPickValue(2028, 5, true, undefined, undefined, 'MLB'))
    expect(r8).toBeLessThan(r6)
    expect(getPickValue(2028, 8, true)).toBe(getPickValue(2028, 6, true))
  })

  it('valueFuturePicks passes the league sport through', () => {
    vi.setSystemTime(new Date('2027-04-15T12:00:00Z'))
    const picks = [{ season: 2027, round: 1, ownerTeamId: 't' }, { season: 2027, round: 4, ownerTeamId: 't' }]
    const nfl = valueFuturePicks(picks, ctxFor('NFL'))
    const nba = valueFuturePicks(picks, ctxFor('NBA'))
    expect(nba.totalDynastyValue).not.toBe(nfl.totalDynastyValue)
    expect(nba.totalDynastyValue).toBe(
      getPickValue(2027, 1, true, undefined, 12, 'NBA') + getPickValue(2027, 4, true, undefined, 12, 'NBA')
    )
  })
})
