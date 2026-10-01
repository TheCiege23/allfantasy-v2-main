import { describe, expect, it } from 'vitest'
import { computeCareerAwards } from '@/lib/core-app/careerAwards'
import {
  buildLegacyStakes,
  computeLeagueMilestones,
  computeLegacyStakes,
  computeMilestones,
  nextMark,
  ordinal,
} from '@/lib/core-app/careerMilestones'
import { buildCareerData, NO_CAREER_FILTER, type CareerRow, type CareerSource } from '@/lib/core-app/careerModel'
import type { LeagueCareerData } from '@/lib/core-app/leagueCareer'
import { row } from './careerFixtures'

function source(rows: CareerRow[]): CareerSource {
  return {
    identity: { handle: 'guap', avatarUrl: null, xpTotal: null },
    rows,
    platforms: [...new Set(rows.map((r) => r.platform))],
    rosterless: 0,
  }
}

const live = (over: Partial<CareerRow> = {}) =>
  row({ season: 2026, status: 'in_season', counted: false, wins: 3, losses: 1, ...over })

function career(rows: CareerRow[]) {
  const data = buildCareerData(source(rows))
  const awards = computeCareerAwards({ rows: rows.filter((r) => r.counted), trades: [] })
  return { data, awards }
}

describe('helpers', () => {
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st',
    ])
  })

  it('finds the next round number and the step it sits in', () => {
    expect(nextMark(0)).toEqual({ mark: 25, floor: 0 })
    expect(nextMark(98)).toEqual({ mark: 100, floor: 75 })
    expect(nextMark(100)).toEqual({ mark: 150, floor: 100 })
    expect(nextMark(1010)).toEqual({ mark: 1250, floor: 1000 })
  })
})

describe('computeLegacyStakes', () => {
  it('says nothing when no league is live', () => {
    const { data } = career([row({ season: 2024 })])
    expect(computeLegacyStakes(data)).toEqual([])
  })

  it('frames a first title for a season-1 account with nothing finished', () => {
    const { data } = career([live({ leagueName: 'AF Founders', platform: 'allfantasy' as CareerRow['platform'] })])
    expect(data.accountIsEmpty).toBe(true)
    const [stake] = computeLegacyStakes(data)
    expect(stake.tone).toBe('first')
    expect(stake.title).toBe('Win AF Founders')
    expect(stake.detail).toContain('first career title and earns Ring Collector')
    expect(stake.detail).toContain('3-1 so far')
  })

  it('names the ring number and the Ring Collector tier it would unlock', () => {
    const { data } = career([
      row({ season: 2022, isChampion: true, leagueName: 'A' }),
      row({ season: 2023, isChampion: true, leagueName: 'B' }),
      live({ leagueName: 'C' }),
    ])
    const [stake] = computeLegacyStakes(data)
    expect(stake.detail).toBe(
      'Ring #3 of your career and your first in this league and takes Ring Collector to Silver. You are 3-1 so far.',
    )
  })

  it('marks a defending champion as a repeat', () => {
    const { data } = career([row({ season: 2025, isChampion: true, leagueName: 'Dynasty Dragons' }), live()])
    const [stake] = computeLegacyStakes(data)
    expect(stake.tone).toBe('streak')
    expect(stake.title).toBe('Defend Dynasty Dragons')
    expect(stake.detail).toMatch(/^You won it in 2025\. A repeat is ring #2/)
  })

  it('only counts the newest live season, and never an old unclassified row', () => {
    const { data } = career([row({ season: 2024 }), live({ season: 2021, leagueName: 'Stale' }), live({ leagueName: 'Now' })])
    expect(computeLegacyStakes(data).map((s) => s.leagueName)).toEqual(['Now'])
  })

  it('never changes a career total', () => {
    const rows = [row({ season: 2024, isChampion: true }), live()]
    const { data } = career(rows)
    computeLegacyStakes(data)
    expect(data.championships).toBe(1)
    expect(data.wins).toBe(8)
  })
})

describe('computeMilestones', () => {
  it('surfaces an award one step from its next tier', () => {
    const { data, awards } = career([
      row({ season: 2021, isChampion: true, leagueName: 'A' }),
      row({ season: 2022, isChampion: true, leagueName: 'B' }),
    ])
    const ring = computeMilestones(data, awards).find((m) => m.key === 'award:ring-collector')
    expect(ring).toMatchObject({ title: 'Ring Collector Silver', remaining: 1, progressPct: 67 })
    expect(ring!.detail).toBe('2 titles across 2 leagues. 1 title to go.')
  })

  it('surfaces career wins near a round number and ignores them far from one', () => {
    const near = career(Array.from({ length: 6 }, (_, i) => row({ season: 2015 + i, wins: 8, losses: 6 })))
    expect(near.data.wins).toBe(48)
    expect(computeMilestones(near.data, near.awards).find((m) => m.kind === 'wins')).toMatchObject({
      title: '50 career wins',
      remaining: 2,
    })

    const far = career([row({ wins: 30, losses: 6 })])
    expect(computeMilestones(far.data, far.awards).some((m) => m.kind === 'wins')).toBe(false)
  })

  it('returns no stakes or milestones on a filtered board', () => {
    const rows = [row({ season: 2024, isChampion: true }), live()]
    const data = buildCareerData(source(rows), { ...NO_CAREER_FILTER, platform: 'sleeper' })
    expect(buildLegacyStakes(data, [])).toEqual({ stakes: [], milestones: [], season: null })
  })
})

describe('computeLeagueMilestones', () => {
  const league = (wins: number, seasons: number): LeagueCareerData => ({
    league: { id: 'L1', name: 'Home League', platform: 'sleeper' },
    seasons: Array.from({ length: seasons }, (_, i) => ({
      season: 2020 + i,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      games: 1,
    })),
    totals: { wins, losses: 10, pointsFor: 0, games: wins + 10, winPct: null },
    firstSeason: 2020,
    lastSeason: 2020 + seasons - 1,
    toughestRival: null,
    tradeGrade: { available: false, reason: 'n/a' },
    waiverGrade: { available: false, reason: 'n/a' },
    tradeStory: { available: false, reason: 'n/a' },
  })

  it('counts wins already played toward a league round number', () => {
    expect(computeLeagueMilestones(league(48, 3)).find((m) => m.kind === 'league-wins')).toMatchObject({
      title: '50 wins in Home League',
      remaining: 2,
    })
  })

  it('marks an anniversary season only at 5, 10, 15 and 20', () => {
    expect(computeLeagueMilestones(league(30, 4)).some((m) => m.title === '5th season in Home League')).toBe(true)
    expect(computeLeagueMilestones(league(30, 5)).some((m) => m.kind === 'league-seasons')).toBe(false)
  })
})
