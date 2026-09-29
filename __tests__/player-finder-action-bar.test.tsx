/**
 * The phone's sticky action bar: one action rule shared with the league card, and the bar hiding while
 * the card's own buttons are on screen.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { leagueViewActions } from '@/lib/core-app/leagueViewActions'
import type { PlayerLeagueView } from '@/lib/core-app/playerLeagueView'
import { LeagueOwnershipCard } from '@/components/core-app/player-finder/LeagueOwnershipCard'
import { StickyActionBar } from '@/components/core-app/player-finder/StickyActionBar'

const view = (ownership: PlayerLeagueView['ownership'], platform = 'sleeper'): PlayerLeagueView =>
  ({
    leagueId: 'L1',
    leagueName: 'KBFL Dynasty',
    platform,
    platformLeagueId: '1180000000000000000',
    season: 2026,
    format: 'dynasty',
    ownership,
    afPoints: { available: false, reason: 'n/a' },
    positionRank: { available: false, reason: 'n/a' },
    yourTeam: { teamName: 'Cafe', externalId: '3' },
    rosterCount: 12,
  }) as unknown as PlayerLeagueView

const YOURS = view({ kind: 'yours', slot: 'BENCH', exactSlot: null, teamName: 'Cafe' })
const OTHER = view({ kind: 'other', slot: 'STARTER', owner: { teamName: 'Gridiron Gang', ownerName: 'tasha', externalId: '7', avatarUrl: null, record: '3-0', isCommissioner: false } as never })
const FREE = view({ kind: 'free-agent' })
const UNKNOWN = view({ kind: 'unknown', reason: 'rosters not imported' })

describe('leagueViewActions', () => {
  it('yours: your lineup; theirs: trade here, with their platform as the second option; free: claim', () => {
    expect(leagueViewActions(YOURS, 'Dalton Kincaid')).toMatchObject({ status: 'Yours · bench', secondary: null, primary: { internal: false } })
    const other = leagueViewActions(OTHER, 'Dalton Kincaid')
    expect(other).toMatchObject({ status: "Gridiron Gang's", primary: { label: 'Trade for Kincaid →', href: '/core/trades?league=L1', internal: true } })
    expect(other.secondary?.external).toBe(true)
    expect(leagueViewActions(FREE, 'Dalton Kincaid').primary?.label).toMatch(/^Claim Kincaid — /)
    expect(leagueViewActions(UNKNOWN, 'Dalton Kincaid')).toEqual({ primary: null, secondary: null, status: 'Not readable here' })
  })
})

describe('LeagueOwnershipCard (after the refactor)', () => {
  it('still shows each state\'s buttons, and marks its action row for the bar to watch', () => {
    for (const [v, text] of [[YOURS, leagueViewActions(YOURS, 'Dalton Kincaid').primary!.label], [OTHER, 'Trade for Kincaid →'], [FREE, leagueViewActions(FREE, 'Dalton Kincaid').primary!.label]] as const) {
      const { container, unmount } = render(<LeagueOwnershipCard view={v} playerName="Dalton Kincaid" />)
      expect(screen.getByRole('link', { name: text })).toBeTruthy()
      expect(container.querySelector('#af-pf-lv-actions')).not.toBeNull()
      unmount()
    }
    const { container } = render(<LeagueOwnershipCard view={OTHER} playerName="Dalton Kincaid" />)
    expect(container.querySelectorAll('#af-pf-lv-actions a')).toHaveLength(2) // trade here + their platform
  })
})

describe('StickyActionBar', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the same primary action as the card, with the league and where he stands', () => {
    render(<StickyActionBar view={OTHER} playerName="Dalton Kincaid" />)
    const link = screen.getByRole('link', { name: 'Trade for Kincaid →' })
    expect(link.getAttribute('href')).toBe('/core/trades?league=L1')
    expect(screen.getByText('KBFL Dynasty')).toBeTruthy()
    expect(screen.getByText("Gridiron Gang's")).toBeTruthy()
  })

  it('hides while the card\'s buttons are on screen, and returns when they scroll away', () => {
    let fire: (hit: boolean) => void = () => {}
    class IO {
      constructor(cb: (e: Array<{ isIntersecting: boolean }>) => void) {
        fire = (hit) => cb([{ isIntersecting: hit }])
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', IO)
    const { container } = render(
      <>
        <LeagueOwnershipCard view={YOURS} playerName="Dalton Kincaid" />
        <StickyActionBar view={YOURS} playerName="Dalton Kincaid" />
      </>,
    )
    const bar = () => container.querySelector('.af-pf-stickybar')!
    expect(bar().getAttribute('data-hidden')).toBe('false')
    act(() => fire(true))
    expect(bar().getAttribute('data-hidden')).toBe('true')
    expect(bar().getAttribute('aria-hidden')).toBe('true')
    act(() => fire(false))
    expect(bar().getAttribute('data-hidden')).toBe('false')
  })

  it('without IntersectionObserver it simply stays: a duplicate beats a lost action', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { container } = render(<StickyActionBar view={FREE} playerName="Dalton Kincaid" />)
    expect(container.querySelector('.af-pf-stickybar')?.getAttribute('data-hidden')).toBe('false')
  })

  it('nothing to show: no league in view, or no action for it', () => {
    const { container, rerender } = render(<StickyActionBar view={null} playerName="X" />)
    expect(container.innerHTML).toBe('')
    rerender(<StickyActionBar view={UNKNOWN} playerName="X" />)
    expect(container.innerHTML).toBe('')
  })
})
