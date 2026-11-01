import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MyLeaguesV4 } from '@/components/core-app/screens/MyLeaguesV4'
import type { MyLeaguesData } from '@/lib/core-app/myLeagues'
import { LeagueTabs } from '@/components/core-app/LeagueTabs'
import { LeagueWorkspaceNavigation } from '@/components/league/LeagueWorkspaceNavigation'
import { leagueWorkspaceHref, leagueWorkspaceMode } from '@/lib/league/league-workspace-navigation'

vi.mock('next/navigation', () => ({ useRouter: () => ({ prefetch() {} }) }))
afterEach(cleanup)

describe('reopening a league from its dashboard', () => {
  it.each(['AllFantasy', 'Sleeper', 'Yahoo', 'ESPN'])(
    'keeps the full workspace reachable for %s even when imported dashboard views are unavailable', (platform) => {
      render(<LeagueTabs leagueId="league/one" leagueName="Sunday League" activeKey="home" platform={platform} hasScoredWeek={false} tradeSupported={false} draftSupported={false} />)
      expect(screen.getByRole('link', { name: /Open League/ })).toHaveAttribute('href', '/league/league%2Fone')
      expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/core?league=league%2Fone')
    },
  )
  it('does not require first-run flags to open a saved league', () => {
    const url = new URL(leagueWorkspaceHref('saved-league'), 'https://allfantasy.ai')
    expect(url.pathname).toBe('/league/saved-league')
    for (const flag of ['created', 'guide', 'showInvite', 'playIntro']) expect(url.searchParams.has(flag)).toBe(false)
  })
})

describe('league workspace hosting and return paths', () => {
  it('provides an all-league return that bypasses last-league landing and a scoped dashboard return', () => {
    render(<LeagueWorkspaceNavigation leagueId="native-one" leagueName="Sunday League" platform="allfantasy" />)
    expect(screen.getByRole('link', { name: /Back to Dashboard/ })).toHaveAttribute('href', '/core?view=all')
    expect(screen.getByRole('link', { name: 'League Home' })).toHaveAttribute('href', '/league/native-one')
    expect(screen.getByText('Hosted on AllFantasy · Beta')).toBeInTheDocument()
    expect(screen.queryByText(/Imported/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })
  it('names the host, explains local-only changes, and uses the provider id for the official league link', () => {
    render(<LeagueWorkspaceNavigation leagueId="af-internal-id" leagueName="Sunday League" platform="sleeper" sourceLeagueId="123456789" season={2026} />)
    expect(screen.getByText('Imported · Hosted on Sleeper')).toBeInTheDocument()
    expect(screen.getByText(/changes here stay in AllFantasy/)).toHaveTextContent('Complete official moves in Sleeper.')
    const source = screen.getByRole('link', { name: /Sleeper/ })
    expect(source).toHaveAttribute('href', 'https://sleeper.com/leagues/123456789/league')
    expect(source).toHaveAttribute('rel', 'noopener noreferrer')
    expect(source).toHaveAttribute('target', '_blank')
  })
  it('does not invent a league deep link when an imported source id is missing', () => {
    render(<LeagueWorkspaceNavigation leagueId="af-internal-id" leagueName="Sunday League" platform="sleeper" />)
    const source = screen.getByRole('link', { name: /Sleeper/ })
    expect(source.getAttribute('href')).not.toContain('af-internal-id')
  })
  it('keeps unknown platforms in local-only mode', () => {
    expect(leagueWorkspaceMode('new-provider').authority).toBe('SHADOW')
    expect(leagueWorkspaceMode('new-provider').description).toContain('stay in AllFantasy')
  })
  it('explains native and imported modes in Spanish', () => {
    expect(leagueWorkspaceMode('allfantasy', 'es').badge).toBe('Gestionada en AllFantasy · Beta')
    expect(leagueWorkspaceMode('sleeper', 'es').description).toContain('Completa los movimientos oficiales en Sleeper.')
  })
})


describe('the league list opens native homes directly', () => {
  it('uses one direct native home action', () => {
    const data: MyLeaguesData = {
      leagues: [{ id: 'native-one', name: 'Sunday League', platform: 'allfantasy', tier: 'quiet', isDynasty: false, isCommissioner: true, reason: null, href: '/core?league=native-one', actionLabel: 'Open league' }],
      history: [], platforms: ['allfantasy'], coverage: [], notice: null,
      counts: { live: 1, history: 0, all: 1, needs: 0, playing: 0, quiet: 1, commissioner: 1, drafting: 0, dynasty: 0 },
    }
    render(<MyLeaguesV4 {...data} importHref="/import" />)
    expect(screen.queryByRole('link', { name: 'League dashboard' })).toBeNull()
    expect(screen.getByRole('link', { name: /Open League/ })).toHaveAttribute('href', '/league/native-one')
  })
})
