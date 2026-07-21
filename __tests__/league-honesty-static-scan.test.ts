import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Honesty Pack 1A regression guards: source-level scans proving the five fabrication
// surfaces cannot silently return. Same pattern as the existing
// nfl-redraft-player-stat-card-no-stub test.

const read = (path: string) => readFileSync(path, 'utf8')

describe('placeholder projections are gone', () => {
  it('the fabrication module no longer exists', () => {
    expect(existsSync('components/weather/placeholderBaseline.ts')).toBe(false)
  })

  it.each([
    'app/league/[leagueId]/tabs/TeamTab.tsx',
    'app/league/[leagueId]/tabs/PlayersTab.tsx',
    'app/waiver-ai/page.tsx',
  ])('%s does not reference placeholderBaselineProjection', (path) => {
    expect(read(path)).not.toContain('placeholderBaselineProjection')
  })
})

describe('mock IDP standings do not render', () => {
  it('known mock team names and scores are absent', () => {
    const src = read('app/league/[leagueId]/tabs/StandingsTab.tsx')
    expect(src).not.toContain('Team A')
    expect(src).not.toContain('1240.2')
    expect(src).not.toMatch(/const MOCK/)
    expect(src).toContain('idp-standings-unavailable')
  })
})

describe('static checklist no longer claims completion', () => {
  it('completion-claim strings and the all-green check icon are gone from the checklist block', () => {
    const src = read('components/league-home/NflRedraftLeagueHomeDashboard.tsx')
    expect(src).not.toContain('Standings up to date')
    expect(src).not.toContain('Waivers reviewed')
    expect(src).not.toContain('Basic issue checklist')
    // The suggested list renders neutral dots, not CheckCircle2 rows mapped over static strings.
    expect(src).toContain('Suggested checklist')
  })
})

describe('plural-shell label honesty', () => {
  it('does not claim "Live from" APIs over placeholder sections', () => {
    const src = read('app/leagues/[leagueId]/page.tsx')
    expect(src).not.toContain('Live from bracket league and standings APIs')
    expect(src).toContain('Combined league data')
  })
})

describe('League Pulse is gated', () => {
  it('LeagueTab renders the pulse only behind hasLeaguePulseData', () => {
    const src = read('app/league/[leagueId]/tabs/LeagueTab.tsx')
    expect(src).toContain('hasLeaguePulseData')
    expect(src).toMatch(/leaguePulse \? \(/)
  })
})
