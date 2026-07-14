import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('NFL redraft PlayersTab normalized player foundation', () => {
  const src = read('app/league/[leagueId]/tabs/PlayersTab.tsx')

  it('gates the normalized path behind the NFL redraft core dashboard helper', () => {
    expect(src).toMatch(/isNflRedraftCoreDashboardFromUserLeague/)
    expect(src).toMatch(/normalizedPlayerSurfaceEnabled/)
  })

  it('loads the active redraft season, then fetches normalized redraft players', () => {
    expect(src).toMatch(/\/api\/redraft\/season\?leagueId=/)
    expect(src).toMatch(/\/api\/redraft\/players\?\$\{params\.toString\(\)\}/)
  })

  it('renders DB-backed headshots, logos, and normalized stat parsing in player rows', () => {
    expect(src).toMatch(/headshotUrl=\{p\.headshotUrl \?\? p\.imageUrl \?\? null\}/)
    expect(src).toMatch(/logoUrl=\{p\.teamLogoUrl \?\? null\}/)
    expect(src).toMatch(/parseRollingInsightsStatsJson\(p\.normalizedStats \?\? null\)/)
  })

  it('shows a visible warning only when normalized player data is missing', () => {
    expect(src).toMatch(/data-testid="players-tab-normalized-warning"/)
    expect(src).toMatch(/normalizedError/)
  })
})

describe('NFL redraft TeamTab normalized roster foundation', () => {
  const src = read('app/league/[leagueId]/tabs/TeamTab.tsx')

  it('merges unifiedRoster into the display player map before rendering roster rows', () => {
    expect(src).toMatch(/buildDisplayPlayerMap/)
    expect(src).toMatch(/payload && payload\.source !== 'sleeper' \? payload\.unifiedRoster \?\? \[\] : \[\]/)
  })

  it('renders roster avatars and logos from normalized fields when available', () => {
    expect(src).toMatch(/headshotUrl=\{resolved\.headshotUrl \?\? resolved\.imageUrl \?\? null\}/)
    expect(src).toMatch(/logoUrl=\{resolved\.teamLogoUrl \?\? null\}/)
  })

  it('shows a roster warning when roster ids exist but unified display data is still missing', () => {
    expect(src).toMatch(/data-testid="team-tab-normalized-warning"/)
    expect(src).toMatch(/missingNormalizedRosterData/)
  })
})
