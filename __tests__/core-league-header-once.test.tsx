import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CoreLeagueContextBar from '@/components/core-app/CoreLeagueContextBar'
import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'

/**
 * The league, named once.
 *
 * 🛑 INSIDE THE /core SHELL THE LEAGUE HEADER BAR NAMES THE LEAGUE, and the Overview used to
 * name it again directly below — name, platform and sync age, twice each. The Overview keeps
 * its own header OUTSIDE the shell (/dashboard?league=), where nothing else names the league,
 * so the fix is a prop, and both sides of it are pinned here.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams('league=lg-1'),
}))

beforeEach(() => {
  /* The bar reads the league type on mount; the header under test does not depend on it. */
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ canConfirm: false }), { status: 200 }))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const off = { available: false as const, reason: 'not in this fixture' }

function overview(overrides: Partial<LeagueHomeData> = {}): LeagueHomeData {
  return {
    pairing: null,
    league: {
      id: 'lg-1',
      name: 'Kings of Buffalo',
      platform: 'sleeper',
      format: 'Dynasty · Half PPR',
      sport: 'NFL',
      season: 2026,
      currentWeek: 2,
    },
    importCoverage: {
      capabilities: { rosters: true, scoring: true, matchups: true, standings: true, draft: true, trades: false, history: true },
      missing: ['tradeHistory'],
      partial: [],
      sentence: 'Sleeper doesn’t publish trade history, so those aren’t available for this league.',
      hasGaps: true,
    },
    yourTeam: off,
    stage: null,
    preSeason: false,
    weekPicker: null,
    standings: off,
    timeline: off,
    matchup: off,
    draftHq: off,
    commissioner: off,
    buzz: off,
    scoreboard: off,
    powerBoard: off,
    rivalry: off,
    syncAge: { label: '3m ago', stale: false },
    ...overrides,
  } as LeagueHomeData
}

describe('the league Overview inside the shell', () => {
  it('keeps a page heading but does not show the name, platform or sync age a second time', () => {
    const { container } = render(<LeagueHome data={overview()} otherLeagueIssueCount={0} identityInShell />)

    const heading = screen.getByRole('heading', { level: 1, name: 'Kings of Buffalo' })
    expect(heading).toHaveClass('af-lh-name--hidden')
    expect(heading).not.toHaveClass('af-lh-name')

    expect(container.querySelector('.af-lh-platform')).toBeNull()
    expect(container.querySelector('.af-sync')).toBeNull()
    expect(container.querySelector('.af-readonly')).toBeNull()
    /* What the bar does NOT carry stays. */
    expect(container.querySelector('.af-lh-sub')).toHaveTextContent('Dynasty · Half PPR')
  })

  it('keeps its full header outside the shell, where nothing else names the league', () => {
    const { container } = render(<LeagueHome data={overview()} otherLeagueIssueCount={0} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Kings of Buffalo' })).toHaveClass('af-lh-name')
    expect(container.querySelector('.af-lh-platform')).toHaveTextContent('sleeper')
    expect(container.querySelector('.af-sync')).toHaveTextContent('3m ago')
    expect(container.querySelector('.af-readonly')).not.toBeNull()
  })

  it('shows the coverage panel in place of the one-sentence banner when one is given', () => {
    const { container } = render(
      <LeagueHome
        data={overview()}
        otherLeagueIssueCount={0}
        identityInShell
        coverageSlot={<section data-testid="coverage-panel">panel</section>}
      />,
    )

    expect(screen.getByTestId('coverage-panel')).toBeInTheDocument()
    expect(container.querySelector('.af-lh-coverage')).toBeNull()
  })

  it('keeps the banner when no panel is given', () => {
    const { container } = render(<LeagueHome data={overview()} otherLeagueIssueCount={0} />)
    expect(container.querySelector('.af-lh-coverage')).toHaveTextContent('Sleeper doesn’t publish trade history')
  })
})

describe('the league header bar', () => {
  const bar = (coverageHref: string | null) => (
    <CoreLeagueContextBar
      leagueId="lg-1"
      leagueName="Kings of Buffalo"
      platform="sleeper"
      logoLetter="K"
      coverageHref={coverageHref}
      syncLabel="3m ago"
      syncStale={false}
      gameDayActive={false}
      surface="standings"
      decisionSlot={null}
      recommendationSlot={null}
    />
  )

  it('names the league visibly, once', () => {
    render(bar(null))
    expect(screen.getAllByText('Kings of Buffalo')).toHaveLength(1)
  })

  it('links the source chip to what is on file, from any tab', () => {
    render(bar('/core?league=lg-1#league-data-coverage'))
    expect(screen.getByRole('link', { name: /SLEEPER import/ })).toHaveAttribute(
      'href',
      '/core?league=lg-1#league-data-coverage',
    )
  })

  it('leaves the chip as plain text when there is no import to describe', () => {
    render(bar(null))
    expect(screen.queryByRole('link', { name: /import/ })).toBeNull()
    expect(screen.getByText('SLEEPER import')).toBeInTheDocument()
  })
})
