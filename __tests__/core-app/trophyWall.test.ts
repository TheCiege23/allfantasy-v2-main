import { describe, expect, it } from 'vitest'
import { computeCareerAwards } from '@/lib/core-app/careerAwards'
import { buildCareerData, NO_CAREER_FILTER, type CareerRow, type CareerSource } from '@/lib/core-app/careerModel'
import { buildTrophyWall, parseHallLayout } from '@/lib/core-app/trophyWall'
import { row } from './careerFixtures'

const source = (rows: CareerRow[]): CareerSource => ({
  identity: { handle: 'guap', avatarUrl: null, xpTotal: null },
  rows,
  platforms: [...new Set(rows.map((r) => r.platform))],
  rosterless: 0,
})

const rows = [
  row({ season: 2021, isChampion: true, leagueName: 'Dragons', wins: 12, losses: 2 }),
  row({ season: 2022, isChampion: true, leagueName: 'Dragons', wins: 11, losses: 3 }),
  row({ season: 2023, isChampion: true, leagueName: 'Dragons', wins: 10, losses: 4 }),
  row({ season: 2023, isChampion: true, leagueName: 'Office', wins: 9, losses: 5 }),
  row({ season: 2026, counted: false, status: 'in_season', leagueName: 'Office', wins: 3, losses: 1 }),
]

describe('buildTrophyWall', () => {
  const data = buildCareerData(source(rows))
  const awards = computeCareerAwards({ rows, trades: [] })
  const wall = buildTrophyWall(data, awards)

  it('has one plaque per recorded title, newest first, and marks the newest season', () => {
    expect(wall.plaques.map((p) => `${p.season} ${p.leagueName}`)).toEqual([
      '2023 Dragons',
      '2023 Office',
      '2022 Dragons',
      '2021 Dragons',
    ])
    expect(wall.plaques.filter((p) => p.latest).map((p) => p.leagueName)).toEqual(['Dragons', 'Office'])
  })

  it('counts consecutive titles in the same league as a streak, and nothing else', () => {
    const streak = Object.fromEntries(wall.plaques.map((p) => [`${p.season} ${p.leagueName}`, p.streak]))
    expect(streak).toEqual({ '2023 Dragons': 3, '2023 Office': 1, '2022 Dragons': 2, '2021 Dragons': 1 })
  })

  it('opens one conditional plaque for the live league, numbered from the rings on file', () => {
    expect(wall.openSlot).toEqual({ title: 'Win Office', ringNumber: 5, record: '3-1', platform: 'sleeper' })
  })

  it('shelves awards best tier first, and counts what the wall shows', () => {
    expect(wall.medals.at(0)?.tier).not.toBe('bronze')
    const tiers = wall.medals.map((m) => m.tier)
    const rank = { platinum: 4, gold: 3, silver: 2, bronze: 1 } as const
    expect(tiers.map((t) => rank[t])).toEqual([...tiers.map((t) => rank[t])].sort((a, b) => b - a))
    expect(wall.counts).toMatchObject({ titles: 4, awards: awards.length })
  })

  it('has no open plaque on a filtered board', () => {
    const filtered = buildCareerData(source(rows), { ...NO_CAREER_FILTER, league: 'office' })
    expect(buildTrophyWall(filtered, []).openSlot).toBeNull()
  })
})

describe('parseHallLayout', () => {
  it('accepts wall and list, and lets the device decide otherwise', () => {
    expect(parseHallLayout('wall')).toBe('wall')
    expect(parseHallLayout('list')).toBe('list')
    expect(parseHallLayout('grid')).toBeNull()
    expect(parseHallLayout(undefined)).toBeNull()
  })
})
