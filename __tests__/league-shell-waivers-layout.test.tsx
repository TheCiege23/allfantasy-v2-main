import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('League shell layout and waivers integration', () => {
  const leagueShell = read('app/league/[leagueId]/LeagueShell.tsx')
  const leaguePage = read('app/league/[leagueId]/page.tsx')
  const leagueShellClient = read('app/league/[leagueId]/LeagueShellClient.tsx')
  const appShell = read('app/components/AppShell.tsx')
  const leagueTabs = read('app/league/[leagueId]/LeagueTabs.tsx')
  const dashboardShell = read('app/dashboard/DashboardShell.tsx')
  const waiverWire = read('components/waiver-wire/WaiverWirePage.tsx')
  const waiverAiPanel = read('components/waivers/AIWaiverRecommendationsPanel.tsx')
  const commissionerPanel = read('components/waivers/CommissionerWaiverInsightsPanel.tsx')
  const sportAwareWaiverWire = read('components/waiver-wire/SportAwareWaiverWire.tsx')
  const playersTab = read('app/league/[leagueId]/tabs/PlayersTab.tsx')

  it('uses the balanced three-panel desktop preset with dynamic collapsible columns', () => {
    expect(appShell).toContain("layoutMode?: 'legacy-rail-clamp' | 'balanced-three-panel'")
    // Columns are dynamic based on collapse state; the open shell is chat/workspace/leagues = 40/35/25.
    expect(appShell).toContain('minmax(280px,40fr)')
    expect(appShell).toContain('minmax(0,35fr)')
    expect(appShell).toContain('minmax(240px,25fr)')
    expect(appShell).toContain("data-af-layout-mode={balancedDesktopLayout ? 'balanced-three-panel' : 'legacy-rail-clamp'}")
    expect(dashboardShell).toContain('layoutMode="balanced-three-panel"')
    expect(leagueShell).toContain('layoutMode="balanced-three-panel"')
  })

  it('keeps league chat as the default left chat tab for league pages', () => {
    expect(leagueShell).toContain("normalizeOpenChatQueryParam(openChatQuery) ?? 'league'")
  })

  it('sets predraft default center tab to Draft/Draft Setup (draft or home)', () => {
    expect(leagueShell).toContain("const isPredraftLifecycle = useMemo(() =>")
    expect(leagueShell).toContain('Draft setup')
    expect(leagueShell).toContain("if (isPredraftLifecycle) return renderPredraftDraftSetup()")
  })

  it('matches the dashboard command-center visual treatment on league pages', () => {
    expect(leagueShell).toContain('data-testid="league-command-center-surface"')
    expect(leagueShell).toContain('data-testid="league-command-center-header"')
    expect(leagueShell).toContain('data-testid="league-command-center-tabs"')
    expect(leagueShell).toContain('data-testid="league-command-center-card"')
    expect(leagueShell).toContain('bg-gradient-to-br from-cyan-500/[0.07] via-[#050814] to-violet-500/[0.04]')
  })

  it('keeps distinct canonical Players and Waivers destinations for football redraft', () => {
    expect(leagueTabs).toContain("{ id: 'waivers', label: 'Waivers' }")
    expect(leagueShell).toContain("{ id: 'players', label: 'Players' }")
    expect(leagueShell).toContain("if (tab.id === 'players') return { ...tab, label: 'Players' }")
  })

  it('maps nfl redraft waivers deep links into the combined Players / Waivers tab', () => {
    expect(leagueShell).toContain("waivers: 'players'")
  })

  it('renders WaiverWirePage in the center workspace when waivers tab is selected', () => {
    expect(leagueShell).toContain("case 'waivers':")
    expect(leagueShell).toContain("return <SportAwareWaiverWire leagueId={leagueId} />")
    expect(sportAwareWaiverWire).toContain('return <WaiverWirePage leagueId={leagueId} />')
  })

  it('mounts the league shell via client-boundary wrapper', () => {
    // page.tsx should import the client wrapper, not call nextDynamic directly
    expect(leaguePage).toContain("import { LeagueShellClient } from './LeagueShellClient'")
    expect(leaguePage).not.toContain("nextDynamic")
    // LeagueShell is already a client component; the wrapper is the explicit
    // serialized-props boundary and does not need a second dynamic layer.
    expect(leagueShellClient).toContain("'use client'")
    expect(leagueShellClient).toContain("import { LeagueShell, type LeagueShellProps } from './LeagueShell'")
    expect(leagueShellClient).toContain('return <LeagueShell {...props} />')
  })

  it('logs league_dashboard_render_failed marker with full metadata in catch block', () => {
    expect(leaguePage).toContain("marker: 'league_dashboard_render_failed'")
    expect(leaguePage).toContain('leagueId')
    expect(leaguePage).toContain('userId: session?.user?.id ?? null')
    expect(leaguePage).toContain('selectedView: firstSearchParam(sp?.view)')
    expect(leaguePage).toContain('selectedTab: firstSearchParam(sp?.tab)')
    expect(leaguePage).toContain("step: 'data_load'")
    expect(leaguePage).toContain('errorName: error instanceof Error ? error.name')
    // log function is NOT gated to dev-only; it always logs
    expect(leaguePage).not.toContain("if (process.env.NODE_ENV === 'production') return")
  })

  it('renders League not found state when league record is absent', () => {
    expect(leaguePage).toContain('"League not found"')
  })

  it('renders join/access state when user is not a league member', () => {
    expect(leaguePage).toContain("\"You don't have access to this league\"")
    expect(leaguePage).not.toContain("redirect('/dashboard')")
  })

  it('isolates loadStandingsPresentation division queries with .catch() fallbacks', () => {
    const dashView = read('lib/league/league-dashboard-view.ts')
    expect(dashView).toContain("listDivisionsByLeague(leagueId, { sport: String(league.sport) }).catch(() => [])")
    expect(dashView).toContain("prisma.leagueTeam.count(")
    expect(dashView).toContain("}).catch(() => 0)")
  })

  it('renders shell with safe fallback data when optional dashboard data loaders fail', () => {
    expect(leaguePage).toContain('const defaultLeagueDashboardView: LeagueDashboardView = {')
    expect(leaguePage).toContain('buildLeagueDashboardView(league).catch((err) => {')
    expect(leaguePage).toContain('return defaultLeagueDashboardView')
    // Optional draft/setup data is explicitly nullable so missing setup does not crash shell render.
    expect(leaguePage).toContain('dispersalDraftInProgress={null}')
  })

  it('keeps predraft leagues on Draft Setup fallback instead of crashing when setup data is missing', () => {
    expect(leagueShell).toContain('const isPredraftLifecycle = useMemo(() =>')
    expect(leagueShell).toContain('const renderPredraftDraftSetup = () => {')
    expect(leagueShell).toContain('if (isPredraftLifecycle) return renderPredraftDraftSetup()')
  })

  it('renders AF Pro waiver AI locked/recommendations panel within waiver page', () => {
    expect(waiverWire).toContain('<AIWaiverRecommendationsPanel leagueId={leagueId} />')
    expect(waiverAiPanel).toContain('AF_PRO_REQUIRED')
    expect(waiverAiPanel).toContain('AI waiver recommendations are an AF Pro feature.')
  })

  it('renders commissioner waiver insights panel with lock state within waiver page', () => {
    expect(waiverWire).toContain('<CommissionerWaiverInsightsPanel leagueId={leagueId} />')
    expect(commissionerPanel).toContain('AF_COMMISSIONER_REQUIRED')
    expect(commissionerPanel).toContain('League-wide AI waiver tools require AF Commissioner.')
  })

  it('promotes the complete waiver experience inside the league Players tab', () => {
    expect(playersTab).toContain("'Available Players'")
    expect(playersTab).toContain("'Waivers'")
    expect(playersTab).toContain("'Free Agents'")
    expect(playersTab).toContain("'My Claims'")
    expect(playersTab).toContain('data-testid="players-tab-waiver-subnav"')
    expect(playersTab).toContain('<WaiverWirePage')
    expect(playersTab).toContain("initialTab={activeSubtab === 'claims' ? 'pending' : 'available'}")
    expect(playersTab).toContain("lockedTab={activeSubtab === 'claims'}")
  })
})
