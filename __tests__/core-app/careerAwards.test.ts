import { describe, expect, it } from 'vitest'
import { AWARD_SPECS, computeCareerAwards, findAward } from '@/lib/core-app/careerAwards'
import { row } from './careerFixtures'

describe('computeCareerAwards', () => {
  it('awards nothing to an account with nothing finished', () => {
    expect(computeCareerAwards({ rows: [row({ counted: false })], trades: [] })).toEqual([])
  })

  it('dates a tier to the season the threshold was crossed', () => {
    const rows = [
      row({ season: 2019, isChampion: true }),
      row({ season: 2020 }),
      row({ season: 2021, isChampion: true, leagueName: 'B' }),
      row({ season: 2022, isChampion: true, leagueName: 'C' }),
    ]
    const ring = findAward(computeCareerAwards({ rows, trades: [] }), 'ring-collector')!
    expect(ring.tier).toBe('silver')
    expect(ring.metric).toBe(3)
    expect(ring.earnedSeason).toBe(2022)
    expect(ring.next).toEqual({ tier: 'gold', threshold: 5, remaining: 2 })
    expect(ring.evidence).toBe('3 titles across 3 leagues')
  })

  it('counts only trades made in dynasty leagues for Dynasty Deal Maker', () => {
    const rows = [
      row({ leagueName: 'Dyn', leagueType: 'dynasty' }),
      row({ leagueName: 'Red', leagueType: 'redraft' }),
    ]
    const awards = computeCareerAwards({
      rows,
      trades: [
        { season: 2023, leagueKey: 'dyn', count: 12, maxAssets: 3 },
        { season: 2023, leagueKey: 'red', count: 40, maxAssets: 3 },
        { season: 2023, leagueKey: null, count: 99, maxAssets: 3 },
      ],
    })
    expect(findAward(awards, 'dynasty-deal-maker')).toMatchObject({ metric: 12, tier: 'bronze' })
    expect(findAward(awards, 'deal-maker')).toMatchObject({ metric: 151, tier: 'gold' })
  })

  it('does not award back-to-back for titles a season apart', () => {
    const awards = computeCareerAwards({
      rows: [row({ season: 2019, isChampion: true }), row({ season: 2021, isChampion: true })],
      trades: [],
    })
    expect(findAward(awards, 'back-to-back')).toBeNull()
    expect(findAward(awards, 'dynasty-builder')).toMatchObject({ metric: 2, tier: 'bronze' })
  })

  it('every spec has four rising thresholds', () => {
    for (const spec of AWARD_SPECS) {
      const t = spec.thresholds
      expect(t[0]).toBeLessThan(t[1])
      expect(t[1]).toBeLessThan(t[2])
      expect(t[2]).toBeLessThan(t[3])
    }
  })

  it('findAward returns null for an award the manager has not earned', () => {
    expect(findAward([], 'ring-collector')).toBeNull()
    expect(findAward([], null)).toBeNull()
  })
})
