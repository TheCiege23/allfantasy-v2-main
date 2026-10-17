import { describe, expect, it } from 'vitest'
import { buildCareerData, NO_CAREER_FILTER, type CareerRow, type CareerSource } from '@/lib/core-app/careerModel'
import { railCareerLine, railCareerLines, railLeagueKey } from '@/lib/core-app/railCareer'
import { row } from './careerFixtures'

function source(rows: CareerRow[]): CareerSource {
  return { identity: { handle: 'guap', avatarUrl: null, xpTotal: 0 }, rows, platforms: [...new Set(rows.map((r) => r.platform))], rosterless: 0 }
}

// Default fixture league is the same across seasons; a second league is named explicitly.
const rows = [
  row({ season: 2021, wins: 10, losses: 3, isChampion: true }),
  row({ season: 2022, wins: 4, losses: 10 }),
  row({ season: 2023, wins: 9, losses: 5, isChampion: true }),
  // Live: never part of a record.
  row({ season: 2026, status: 'in_season', counted: false, wins: 3, losses: 0 }),
  row({ season: 2022, leagueName: 'Espn Pals', platform: 'espn', source: 'import', wins: 9, losses: 5, ties: 1 }),
]

describe('CareerLeague.record', () => {
  it('sums FINISHED seasons only — the live season never moves it', () => {
    const d = buildCareerData(source(rows))
    const main = d.leagues.find((l) => l.key !== 'espn pals')!
    expect(main.record).toEqual({ wins: 23, losses: 18, ties: 0 })
    expect(main.championships).toBe(2)
    expect(d.leagues.find((l) => l.key === 'espn pals')!.record).toEqual({ wins: 9, losses: 5, ties: 1 })
  })

  it('is null for a league with only a live season', () => {
    const d = buildCareerData(source([row({ season: 2026, leagueName: 'Brand New', status: 'in_season', counted: false, wins: 2, losses: 1 })]))
    expect(d.leagues[0].record).toBeNull()
  })
})

describe('railCareerLine', () => {
  it('reads record then titles, and says nothing when there is nothing finished', () => {
    expect(railCareerLine({ record: { wins: 23, losses: 11, ties: 0 }, championships: 2 })).toBe('23-11 · 2 titles')
    expect(railCareerLine({ record: { wins: 9, losses: 5, ties: 1 }, championships: 0 })).toBe('9-5-1')
    expect(railCareerLine({ record: null, championships: 1 })).toBe('1 title')
    expect(railCareerLine({ record: null, championships: 0 })).toBeNull()
    expect(railCareerLine({ championships: 0 })).toBeNull() // a league built before `record` existed
  })
})

describe('railCareerLines', () => {
  it('keys each line on the Career identity — the trimmed, lower-cased name', () => {
    const lines = railCareerLines(buildCareerData(source(rows)))!
    expect(lines['espn pals']).toBe('9-5-1')
    expect(railLeagueKey('  Espn Pals ')).toBe('espn pals')
  })

  it('publishes nothing under a filter — the rail must not silently become "since 2023"', () => {
    const filtered = buildCareerData(source(rows), { ...NO_CAREER_FILTER, fromSeason: 2023 })
    expect(railCareerLines(filtered)).toBeNull()
  })
})
