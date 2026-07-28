// @vitest-environment jsdom
/**
 * OutstandingIssuesCard — the LIVE dashboard alert list (rendered by NocturneDashboard). Proves each row
 * is an internal AllFantasy launcher (opens the wired modal for its NORMALIZED kind — not its label) plus,
 * for imported + resolvable leagues, a secure external source action, with the read-only disclosure shown
 * once. Native / link-less rows get the internal launcher only. Display text can't change routing, a
 * homepage fallback stays honest, and links never cross leagues.
 */
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { OutstandingIssuesCard } from '@/components/dashboard/OutstandingIssuesCard'
import { IMPORTED_LEAGUE_READONLY_NOTE } from '@/lib/league-links/readOnlyNote'
import type { OutstandingIssueRow } from '@/lib/dashboard/outstanding-issues'
import type { SourceLink } from '@/lib/league-links/sourceLinkResolver'

function sleeperLink(id: string): SourceLink {
  return {
    href: `https://sleeper.com/leagues/${id}/league`,
    destinationType: 'league', provider: 'sleeper', providerLabel: 'Sleeper',
    label: 'Sleeper', isFallback: false, opensExternally: true,
  }
}
function mflFallbackLink(): SourceLink {
  return {
    href: 'https://www.myfantasyleague.com/', destinationType: 'homepage', provider: 'mfl',
    providerLabel: 'MyFantasyLeague', label: 'Go to MyFantasyLeague', isFallback: true, opensExternally: true,
  }
}
function row(over: Partial<OutstandingIssueRow>): OutstandingIssueRow {
  return {
    key: 'k1', kind: 'lineup', leagueId: 'L1', label: 'Empty FLEX slot', league: 'HailShiva',
    severity: 'critical', sev: 0, urg: 0, count: 1, imported: true,
    external: { link: sleeperLink('L1'), label: 'Set Lineup in HailShiva' }, ...over,
  }
}

afterEach(cleanup)

describe('OutstandingIssuesCard — secure alert action loop', () => {
  it('empty list → renders nothing', () => {
    const { container } = render(<OutstandingIssuesCard issues={[]} scopeLabel="all leagues" onOpen={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('imported lineup alert → internal launcher + secure external + one disclosure', () => {
    const onOpen = vi.fn()
    render(<OutstandingIssuesCard issues={[row({})]} scopeLabel="all leagues" onOpen={onOpen} />)

    const ext = screen.getByRole('link', { name: /set lineup in hailshiva/i })
    expect(ext.getAttribute('href')).toBe('https://sleeper.com/leagues/L1/league')
    expect(ext.getAttribute('target')).toBe('_blank')
    expect(ext.getAttribute('rel')).toBe('noopener noreferrer')

    fireEvent.click(screen.getByRole('button', { name: /empty flex slot/i }))
    expect(onOpen).toHaveBeenCalledWith('lineup')

    expect(screen.getAllByText(IMPORTED_LEAGUE_READONLY_NOTE)).toHaveLength(1)
  })

  it('trade alert row opens the trade modal (routing from kind, not label)', () => {
    const onOpen = vi.fn()
    render(
      <OutstandingIssuesCard
        issues={[row({ key: 't1', kind: 'trade', label: '2 trade offers waiting on your response', external: { link: sleeperLink('L2'), label: 'Review Trade in Gridiron' } })]}
        scopeLabel="all leagues"
        onOpen={onOpen}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /2 trade offers waiting/i }))
    expect(onOpen).toHaveBeenCalledWith('trade')
  })

  it('native alert → internal launcher only, no external link, no disclosure', () => {
    const onOpen = vi.fn()
    render(<OutstandingIssuesCard issues={[row({ imported: false, external: null })]} scopeLabel="all leagues" onOpen={onOpen} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(IMPORTED_LEAGUE_READONLY_NOTE)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /empty flex slot/i }))
    expect(onOpen).toHaveBeenCalledWith('lineup')
  })

  it('homepage-fallback provider → honest "Go to {provider}" even if the row label claims a page', () => {
    render(
      <OutstandingIssuesCard
        issues={[row({ external: { link: mflFallbackLink(), label: 'Set Lineup in Keeper Chaos' } })]}
        scopeLabel="all leagues"
        onOpen={() => {}}
      />,
    )
    expect(screen.getByRole('link', { name: /go to myfantasyleague/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /set lineup in keeper chaos/i })).toBeNull()
  })

  it('cross-league isolation — each row keeps its own source href', () => {
    render(
      <OutstandingIssuesCard
        issues={[
          row({ key: 'a', league: 'HailShiva', external: { link: sleeperLink('L1'), label: 'Set Lineup in HailShiva' } }),
          row({ key: 'b', league: 'Gridiron', label: 'Empty QB slot', external: { link: sleeperLink('L2'), label: 'Set Lineup in Gridiron' } }),
        ]}
        scopeLabel="all leagues"
        onOpen={() => {}}
      />,
    )
    expect(screen.getByRole('link', { name: /set lineup in hailshiva/i }).getAttribute('href')).toBe('https://sleeper.com/leagues/L1/league')
    expect(screen.getByRole('link', { name: /set lineup in gridiron/i }).getAttribute('href')).toBe('https://sleeper.com/leagues/L2/league')
  })
})
