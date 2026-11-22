import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetRailOddsCache } from '@/components/core-app/useRailOdds'

/*
 * The /core league list's live layer (2026-10-30): what needs you (from the tab badges' own facts),
 * your win chance (from the Matchup board, fetched once the list opens), and a head-to-head that
 * opens the Matchup screen while the rest of the row opens the league.
 */

// One router object -- see core-rail-active-league.test.tsx for why a fresh one per call hangs.
const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'

const P = { projected: 120, afProjected: 120, pricedFrom: 9, starterCount: 9 }
const LEAGUES = [
  { id: 'e1', name: 'Office League', platform: 'espn', mark: 'O', sport: 'NFL' },
  { id: 'e2', name: 'Work League', platform: 'espn', mark: 'W', sport: 'NFL' },
]
const MATCHUPS = {
  e1: { week: 9, yourTeam: 'Mine', yourAvatarUrl: null, yourScore: 0, yourProjection: P, opponentTeam: 'Theirs', opponentAvatarUrl: null, opponentScore: 0, opponentProjection: P, scored: false },
  e2: { week: 9, yourTeam: 'Mine2', yourAvatarUrl: null, yourScore: 0, yourProjection: P, opponentTeam: 'Theirs2', opponentAvatarUrl: null, opponentScore: 0, opponentProjection: P, scored: false },
}

const fetchMock = vi.fn(async (url: string) => {
  if (String(url).includes('/api/core/rail-odds')) {
    return new Response(JSON.stringify({ odds: { e1: 0.71, e2: 1 }, liveNow: false }), { status: 200 })
  }
  return new Response('{}', { status: 404 })
})

beforeEach(() => {
  resetRailOddsCache()
  nav.router.push.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function open(extra: Record<string, unknown> = {}) {
  const view = render(
    <AfCoreShell
      active="home"
      leagues={LEAGUES as never}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      railMatchups={MATCHUPS as never}
      {...extra}
    >
      <div>screen</div>
    </AfCoreShell>,
  )
  const c = view.container
  if (c.querySelector('.af-shell')?.getAttribute('data-rail-open') !== 'true') fireEvent.click(c.querySelector('.af-rail-toggle')!)
  return c
}
const tile = (c: HTMLElement, id: string) => c.querySelector<HTMLAnchorElement>(`.af-rail-scroll a.af-rail-tile[href*="league=${id}"]`)!

describe('the /core league list, live layer', () => {
  it('flags the leagues the My team and Trades badges are counting, with a dot on the crest', () => {
    const c = open({ urgencyBadges: { myTeam: 1, trades: 1, lineupLeagueIds: ['e1'], offerLeagueIds: ['e1', 'e2'] } })
    expect([...tile(c, 'e1').querySelectorAll('.af-rail-row-flag')].map((f) => f.textContent)).toEqual(['Fix lineup', 'Trade offer'])
    expect(tile(c, 'e1').querySelector('.af-rail-dot')?.getAttribute('data-tone')).toBe('bad')
    expect(tile(c, 'e2').querySelector('.af-rail-dot')?.getAttribute('data-tone')).toBe('warn')
    expect(tile(c, 'e1').getAttribute('aria-label')).toContain('lineup needs fixing, trade offer waiting')
  })

  it('no flags and no dot when nothing needs you', () => {
    const c = open()
    expect(c.querySelector('.af-rail-scroll .af-rail-row-flag')).toBeNull()
    expect(c.querySelector('.af-rail-scroll .af-rail-dot')).toBeNull()
  })

  it('draws the odds bar from the Matchup board once the list opens; a finished game draws none', async () => {
    const c = open()
    await waitFor(() => expect(tile(c, 'e1').querySelector('.af-rail-row-odds-pct')?.textContent).toBe('71%'))
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('rail-odds'))).toHaveLength(1)
    expect(tile(c, 'e2').querySelector('.af-rail-row-odds')).toBeNull()
  })

  it('a tap on the head-to-head opens the Matchup screen; the row itself links to the league', async () => {
    const c = open()
    const row = tile(c, 'e1')
    expect(row.getAttribute('href')).toBe('/core?league=e1')
    await act(async () => {
      fireEvent.click(row.querySelector('.af-rail-row-team')!)
    })
    expect(nav.router.push).toHaveBeenCalledWith('/core/matchup?league=e1')
    nav.router.push.mockClear()
    await act(async () => {
      fireEvent.click(row.querySelector('.af-rail-row-name')!)
    })
    expect(nav.router.push).not.toHaveBeenCalledWith('/core/matchup?league=e1')
  })
})
