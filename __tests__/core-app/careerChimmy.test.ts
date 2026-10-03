import { describe, expect, it } from 'vitest'
import { computeCareerAwards } from '@/lib/core-app/careerAwards'
import {
  careerChimmyPrompts,
  leagueCareerChimmyPrompts,
  renderCareerGroundingPrompt,
} from '@/lib/core-app/careerChimmy'
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

const playoffHeavy = [
  row({ season: 2019, madePlayoffs: true, leagueName: 'A' }),
  row({ season: 2020, madePlayoffs: true, leagueName: 'A' }),
  row({ season: 2021, madePlayoffs: true, leagueName: 'B', platform: 'espn' as CareerRow['platform'] }),
  row({ season: 2022, madePlayoffs: true, leagueName: 'B', platform: 'espn' as CareerRow['platform'] }),
  row({ season: 2026, status: 'in_season', counted: false, leagueName: 'Live', wins: 2, losses: 2 }),
]

describe('careerChimmyPrompts', () => {
  it('offers import and first-season help to an empty account', () => {
    const data = buildCareerData(source([]))
    expect(careerChimmyPrompts(data).map((p) => p.key)).toEqual(['import', 'first-season'])
  })

  it('writes prompts from the user\'s own numbers, capped at four', () => {
    const prompts = careerChimmyPrompts(buildCareerData(source(playoffHeavy)))
    expect(prompts).toHaveLength(4)
    expect(prompts.map((p) => p.key)).toEqual(['best-shot', 'convert', 'best-season', 'platforms'])
    expect(prompts.find((p) => p.key === 'convert')!.ask).toContain("made the playoffs 4 times but won 0 titles")
  })

  it('drops count-quoting prompts under a filter', () => {
    const data = buildCareerData(source(playoffHeavy), { ...NO_CAREER_FILTER, platform: 'sleeper' })
    const keys = careerChimmyPrompts(data).map((p) => p.key)
    expect(keys).not.toContain('convert')
    expect(keys).not.toContain('platforms')
  })
})

describe('leagueCareerChimmyPrompts', () => {
  it('asks about the toughest rival and the trade grade when they exist', () => {
    const data: LeagueCareerData = {
      league: { id: 'L1', name: 'Home League', platform: 'sleeper' },
      seasons: [
        { season: 2024, wins: 9, losses: 5, pointsFor: 0, pointsAgainst: 0, games: 14 },
        { season: 2025, wins: 5, losses: 9, pointsFor: 0, pointsAgainst: 0, games: 14 },
      ],
      totals: { wins: 14, losses: 14, pointsFor: 0, games: 28, winPct: 0.5 },
      firstSeason: 2024,
      lastSeason: 2025,
      toughestRival: { name: 'Mike', wins: 1, losses: 4, meetings: 5, averageMargin: -12 },
      tradeGrade: { available: true, data: { letter: 'C', sample: '6 trades', value: 0 } as never },
      waiverGrade: { available: false, reason: 'n/a' },
      tradeStory: { available: false, reason: 'n/a' },
    }
    const prompts = leagueCareerChimmyPrompts(data)
    expect(prompts.map((p) => p.key)).toEqual(['win-here', 'rival', 'trade-grade', 'best-season'])
    expect(prompts[1].ask).toBe('Mike has beaten me 4 times in 5 meetings in Home League. How do I beat them next time?')
    expect(prompts[3].label).toBe('Repeat my 2024')
  })
})

describe('renderCareerGroundingPrompt', () => {
  it('prints the screen\'s figures and keeps live leagues out of the totals', () => {
    const rows = [
      row({ season: 2023, isChampion: true, madePlayoffs: true }),
      row({ season: 2024, leagueName: 'Other', platform: 'espn' as CareerRow['platform'] }),
      row({ season: 2026, status: 'in_season', counted: false, leagueName: 'Live', wins: 2, losses: 2 }),
    ]
    const data = buildCareerData(source(rows))
    const text = renderCareerGroundingPrompt(data, computeCareerAwards({ rows, trades: [] }))
    expect(text).toContain('## CAREER RECORD')
    expect(text).toContain(`- Record: ${data.wins}-${data.losses}`)
    expect(text).toContain('- Championships: 1 — 2023 Dynasty Dragons (sleeper')
    expect(text).toContain('Ring Collector Bronze')
    expect(text).toContain('- Live this season, NOT in any total above: Live (sleeper, 2-2)')
    expect(text).toMatch(/Rule: quote these figures exactly/)
  })

  it('refuses to invent a record for an empty account', () => {
    const text = renderCareerGroundingPrompt(buildCareerData(source([])), [])
    expect(text).toContain('No finished seasons are on file')
    expect(text).toContain('do not invent a career record')
  })
})
