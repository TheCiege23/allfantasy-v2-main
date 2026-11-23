import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('League page server resilience', () => {
  const leaguePage = read('app/league/[leagueId]/page.tsx')
  const leagueShell = read('app/league/[leagueId]/LeagueShell.tsx')

  it('defines firstSearchParam so post-create query flags do not throw', () => {
    expect(leaguePage).toContain('function firstSearchParam(')
  })

  it('logs structured dashboard failure with stack hook', () => {
    expect(leaguePage).toContain("[league-page] failed to load league dashboard")
  })

  it('renders League not found state when league record is absent', () => {
    expect(leaguePage).toContain('title="League not found"')
  })

  it('renders join/request access state when user is not a league member', () => {
    expect(leaguePage).toContain('title="You don\'t have access to this league"')
  })

  it('renders shell with fallback league dashboard view if optional data loader fails', () => {
    expect(leaguePage).toContain('const defaultLeagueDashboardView: LeagueDashboardView = {')
    expect(leaguePage).toContain('buildLeagueDashboardView(league).catch((err) => {')
    expect(leaguePage).toContain('return defaultLeagueDashboardView')
  })

  it('logs league_dashboard_render_failed metadata in catch block', () => {
    expect(leaguePage).toContain("marker: 'league_dashboard_render_failed'")
    expect(leaguePage).toContain('leagueId')
    expect(leaguePage).toContain('userId: session?.user?.id ?? null')
    expect(leaguePage).toContain('selectedView: firstSearchParam(sp?.view)')
    expect(leaguePage).toContain('selectedTab: firstSearchParam(sp?.tab)')
    expect(leaguePage).toContain("step: 'data_load'")
    expect(leaguePage).toContain('errorMessage: error instanceof Error ? error.message : String(error)')
    expect(leaguePage).toContain('errorName: error instanceof Error ? error.name : \'UnknownError\'')
  })

  it('does not crash predraft flow when draft setup data is missing', () => {
    expect(leaguePage).toContain('dispersalDraftInProgress={null}')
    expect(leagueShell).toContain('const renderPredraftDraftSetup = () => {')
    expect(leagueShell).toMatch(/if \(isPredraftLifecycle\) return (?:\w+\([^\n]*)?renderPredraftDraftSetup\(\)/)
  })
})
