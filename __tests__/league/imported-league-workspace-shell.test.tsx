/**
 * Imported leagues open in the same league workspace as a native one (user call, 2026-11-09): the
 * rail, sidebar and header card, instead of the legacy three-panel shell with its own tab bar.
 * Hosting copy still follows the platform — an imported league never claims to be "Native on
 * AllFantasy" — and its landing (Decide) is the sidebar's League home.
 */
import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { buildNativeLeagueNavigation } from '@/lib/league/nativeLeagueNavigation'

/** The tab ids LeagueShell builds for a general imported league: Decide first, no native_home. */
const IMPORTED_TABS = [
  { id: 'decide', label: 'Decide' },
  { id: 'draft_intel', label: 'Live Intel' },
  { id: 'roster', label: 'My Team' },
  { id: 'matchups', label: 'Matchups' },
  { id: 'players', label: 'Players' },
  { id: 'standings', label: 'Standings' },
  { id: 'league_chat', label: 'League Chat' },
  { id: 'settings', label: 'Settings' },
  { id: 'legacy', label: 'Legacy' },
]

const sleeperLeague = {
  id: 'lg-imported', name: 'Guillotine League 26', platform: 'sleeper', sport: 'NFL', season: 2026, teamCount: 18,
  format: 'Guillotine', scoring: 'PPR Superflex TEP', currentWeek: 9, lifecycleState: 'in_season', leagueVariant: 'guillotine',
} as never

function workspace(props: Partial<React.ComponentProps<typeof NativeLeagueWorkspace>> = {}) {
  return render(
    <NativeLeagueWorkspace native={false} workspaceShell league={sleeperLeague} leagues={[sleeperLeague]} tabs={IMPORTED_TABS}
      activeTab="decide" isCommissioner onSelectTab={() => {}} onOpenSettings={() => {}} leftPanel={null} rightPanel={null}
      sourceLink={{ href: 'https://sleeper.com/leagues/123/league', platformLabel: 'Sleeper' }} {...props}>
      <div>decide view</div>
    </NativeLeagueWorkspace>,
  )
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  HTMLDialogElement.prototype.showModal ??= function () {}
  HTMLDialogElement.prototype.close ??= function () {}
})
afterEach(() => vi.unstubAllGlobals())

describe('an imported league in the league workspace', () => {
  it('draws the workspace, not the legacy shell', () => {
    const { container } = workspace()
    expect(container.querySelector('[data-testid="native-league-workspace"]')).toBeTruthy()
    expect(container.querySelector('.nl-sidebar')).toBeTruthy()
  })

  it('names the host platform instead of claiming AllFantasy hosting', () => {
    workspace()
    expect(screen.getByTestId('imported-league-heading-chip')).toHaveTextContent('Imported from Sleeper')
    expect(screen.getByTestId('imported-league-hosting-chip')).toHaveTextContent('Imported · Hosted on Sleeper')
    expect(screen.queryByText('Native on AllFantasy')).toBeNull()
    expect(screen.queryByText('Hosted on AF · Beta')).toBeNull()
  })

  it('links to the league on its own platform from the header', () => {
    workspace()
    const link = screen.getByTestId('imported-league-open-source')
    expect(link).toHaveAttribute('href', 'https://sleeper.com/leagues/123/league')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('Open in Sleeper')
  })

  it('draws no source link when there is none to give', () => {
    workspace({ sourceLink: null })
    expect(screen.queryByTestId('imported-league-open-source')).toBeNull()
  })

  it('puts Decide in the League home slot, on the sidebar and the phone bar', () => {
    const { container } = workspace()
    const sidebar = container.querySelector('.nl-sidebar') as HTMLElement
    const home = within(sidebar).getByRole('button', { name: 'League home' })
    expect(home).toHaveAttribute('aria-current', 'page')
    expect(within(sidebar).queryByRole('button', { name: 'Decision OS' })).toBeNull()
    const bottom = [...container.querySelector('.nl-bottom-nav')!.children].map((el) => el.textContent)
    expect(bottom).toEqual(['League', 'Matchup', 'Team', 'Players', 'Chat'])
  })

  it('keeps the legacy shell when the workspace is not asked for', () => {
    const { container } = workspace({ workspaceShell: false })
    expect(container.querySelector('[data-testid="native-league-workspace"]')).toBeNull()
  })

  it('leaves a native league exactly as it was', () => {
    const native = { ...(sleeperLeague as object), platform: 'allfantasy', leagueVariant: 'redraft' } as never
    workspace({ native: true, workspaceShell: undefined, league: native, leagues: [native], tabs: [{ id: 'native_home', label: 'League home' }, ...IMPORTED_TABS], activeTab: 'native_home' })
    expect(screen.queryByTestId('imported-league-heading-chip')).toBeNull()
    expect(screen.queryByTestId('imported-league-open-source')).toBeNull()
    expect(screen.getByText('Hosted on AF · Beta')).toBeInTheDocument()
  })
})

describe('League home for leagues without a native home', () => {
  const ids = (tabs: Array<{ id: string }>) => {
    const groups = buildNativeLeagueNavigation(tabs.map((t) => ({ id: t.id, label: t.id })), false)
    return Object.fromEntries(groups.map((g) => [g.id, g.items.map((i) => `${i.id}:${i.label}`)]))
  }

  it('an imported league lands on Decide, named League home, and Decide is not offered twice', () => {
    const nav = ids(IMPORTED_TABS)
    expect(nav.league[0]).toBe('decide:League home')
    expect(nav.week ?? []).not.toContain('decide:Decision OS')
    expect(Object.values(nav).flat().filter((entry) => entry.startsWith('decide:'))).toHaveLength(1)
  })

  it('a league with a native home keeps Decide as Decision OS', () => {
    const nav = ids([{ id: 'native_home' }, ...IMPORTED_TABS])
    expect(nav.league[0]).toBe('native_home:League home')
    expect(nav.week).toContain('decide:Decision OS')
  })

  it('an NFL redraft core league keeps its own home and Decision OS', () => {
    const nav = ids([{ id: 'home' }, ...IMPORTED_TABS])
    expect(nav.league[0]).toBe('home:League home')
    expect(nav.week).toContain('decide:Decision OS')
  })
})
