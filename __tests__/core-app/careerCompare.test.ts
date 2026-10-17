import { describe, expect, it } from 'vitest'
import {
  buildCareerCompare,
  compareHref,
  compareOptions,
  compareRows,
  defaultSpecs,
  filterForSpec,
} from '@/lib/core-app/careerCompare'
import { buildCareerData, NO_CAREER_FILTER, type CareerRow, type CareerSource } from '@/lib/core-app/careerModel'
import { row } from './careerFixtures'

const espn = 'espn' as CareerRow['platform']
const source = (rows: CareerRow[]): CareerSource => ({
  identity: { handle: 'guap', avatarUrl: null, xpTotal: null },
  rows,
  platforms: [...new Set(rows.map((r) => r.platform))],
  rosterless: 0,
})

const rows = [
  row({ season: 2023, leagueName: 'Dragons', wins: 10, losses: 4, isChampion: true, madePlayoffs: true }),
  row({ season: 2024, leagueName: 'Dragons', wins: 6, losses: 8 }),
  row({ season: 2024, leagueName: 'Office', platform: espn, wins: 12, losses: 2, madePlayoffs: true }),
  row({ season: 2025, leagueName: 'Office', platform: espn, wins: 9, losses: 5, isChampion: true, madePlayoffs: true }),
]

describe('specs and filters', () => {
  it('maps each spec kind to one filter field', () => {
    expect(filterForSpec('platform:ESPN')).toEqual({ ...NO_CAREER_FILTER, platform: 'espn' })
    expect(filterForSpec('league:office')).toEqual({ ...NO_CAREER_FILTER, league: 'office' })
    expect(filterForSpec('season:2024')).toEqual({ ...NO_CAREER_FILTER, fromSeason: 2024, toSeason: 2024 })
    expect(filterForSpec('sport:nfl')).toEqual({ ...NO_CAREER_FILTER, sport: 'NFL' })
    expect(filterForSpec('all')).toEqual(NO_CAREER_FILTER)
  })

  it('offers only what this account has, and never a `league=` parameter', () => {
    const specs = compareOptions(buildCareerData(source(rows))).map((o) => o.spec)
    expect(specs).toEqual(
      expect.arrayContaining(['all', 'platform:sleeper', 'platform:espn', 'league:dragons', 'league:office', 'season:2025', 'season:2023']),
    )
    expect(specs.some((s) => s.startsWith('sport:'))).toBe(false) // one sport → no sport sides
    expect(compareHref('platform:espn', 'season:2024')).toBe('/core/career?view=compare&ca=platform%3Aespn&cb=season%3A2024')
    expect(compareHref('a', 'b')).not.toMatch(/[?&]league=/)
  })

  it('defaults to the two biggest platforms, else the two newest seasons', () => {
    expect(defaultSpecs(buildCareerData(source(rows)))).toEqual(['platform:sleeper', 'platform:espn'])
    const one = rows.filter((r) => r.platform === 'sleeper')
    expect(defaultSpecs(buildCareerData(source(one)))).toEqual(['season:2024', 'season:2023'])
  })
})

describe('buildCareerCompare', () => {
  it('builds each side from the same rows the overview uses for that filter', () => {
    const c = buildCareerCompare(source(rows), 'platform:sleeper', 'platform:espn')
    expect(c.a.label).toBe('Sleeper')
    expect(c.b.label).toBe('ESPN')
    expect(c.a.data.wins).toBe(buildCareerData(source(rows), filterForSpec('platform:sleeper')).wins)
    const byKey = Object.fromEntries(c.rows.map((r) => [r.key, r]))
    expect(byKey.record).toMatchObject({ a: '16-12', b: '21-7', better: null })
    expect(byKey.winRate.better).toBe('b')
    expect(byKey.titles).toMatchObject({ a: '1', b: '1', better: null })
  })

  it('falls back to the default side for a spec the account does not have', () => {
    const c = buildCareerCompare(source(rows), 'platform:yahoo', 'league:<script>')
    expect([c.a.spec, c.b.spec]).toEqual(['platform:sleeper', 'platform:espn'])
  })

  it('never ranks points per game across two sports', () => {
    const nba = row({ season: 2024, leagueName: 'Hoops', sport: 'NBA', wins: 10, losses: 4, pointsFor: 30000 })
    const a = buildCareerData(source([rows[0]]))
    const b = buildCareerData(source([nba]))
    expect(compareRows(a, b).find((r) => r.key === 'ppg')!.better).toBeNull()
  })
})
