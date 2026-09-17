import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'

/**
 * The Overview's commissioner card, as rendered.
 *
 * - An imported league has no at-risk band, so that tile is absent rather than a zero.
 * - The card says what "inactive" was judged from.
 * - A commissioner whose league can't be judged gets the reason AND the way into the hub (which
 *   carries the re-sync card); anyone else's unavailable card has no link.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams('league=lg-1'),
}))

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ canConfirm: false }), { status: 200 }))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const off = { available: false as const, reason: 'not in this fixture' }
const HREF = '/core/commissioner?league=lg-1'

function page(commissioner: unknown): LeagueHomeData {
  return {
    pairing: null,
    league: { id: 'lg-1', name: 'Kings', platform: 'sleeper', format: 'Redraft', sport: 'NFL', season: 2026, currentWeek: 2 },
    importCoverage: {
      capabilities: { rosters: true, scoring: true, matchups: true, standings: true, draft: true, trades: true, history: true },
      missing: [],
      partial: [],
      sentence: '',
      hasGaps: false,
    },
    yourTeam: off,
    stage: null,
    preSeason: false,
    weekPicker: { weeks: [1, 2], selected: 2, current: 2, isFuture: false },
    standings: off,
    timeline: off,
    matchup: off,
    draftHq: off,
    commissioner,
    buzz: off,
    scoreboard: off,
    powerBoard: off,
    rivalry: off,
    syncAge: { label: '3m ago', stale: false },
  } as unknown as LeagueHomeData
}

function card(commissioner: unknown): HTMLElement {
  const { getByText } = render(<LeagueHome data={page(commissioner)} otherLeagueIssueCount={0} identityInShell />)
  const panel = getByText('Commissioner Hub').closest('section')
  if (!panel) throw new Error('no commissioner panel')
  return panel as HTMLElement
}

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ')

describe('Overview commissioner card', () => {
  it('shows an imported league’s card without an at-risk tile, and says how it judged', () => {
    const el = card({
      available: true,
      data: {
        inactiveCount: 5,
        atRiskCount: null,
        totalManagers: 12,
        inactiveNames: ['Ada', 'Bea', 'Cy', 'Di'],
        basis: 'trades, waiver claims and roster moves in the last 14 days',
        href: HREF,
      },
    })
    expect(text(el)).not.toContain('At risk')
    expect(text(el)).toContain('Inactive: Ada, Bea, Cy, Di and 1 more')
    expect(text(el)).toContain('Judged by trades, waiver claims and roster moves in the last 14 days.')
    expect(el.querySelector(`a[href="${HREF}"]`)).not.toBeNull()
  })

  it('keeps the at-risk tile where it is measured', () => {
    const el = card({
      available: true,
      data: { inactiveCount: 0, atRiskCount: 2, totalManagers: 10, inactiveNames: [], basis: 'the last lineup or roster change', href: HREF },
    })
    expect(text(el)).toContain('At risk')
    expect(text(el)).toContain('Nobody is inactive.')
  })

  it('calls a league where nobody moved a quiet stretch instead of naming everyone', () => {
    const el = card({
      available: true,
      data: { inactiveCount: 3, atRiskCount: null, totalManagers: 3, inactiveNames: ['A', 'B', 'C'], basis: 'moves', href: HREF },
    })
    expect(text(el)).toContain('a quiet stretch')
    expect(text(el)).not.toContain('Inactive: A')
  })

  it('gives a commissioner the reason and the way into the hub when activity can’t be judged', () => {
    const el = card({ available: false, reason: 'AllFantasy last read this league 3 days ago.', href: HREF })
    expect(text(el)).toContain('AllFantasy last read this league 3 days ago.')
    expect(el.querySelector(`a[href="${HREF}"]`)).not.toBeNull()
    // No figures at all on a league nobody could judge.
    expect(text(el)).not.toContain('Inactive')
  })

  it('gives anyone else the reason and no link', () => {
    const el = card({ available: false, reason: 'the commissioner hub is visible to this league’s commissioner and co-commissioners' })
    expect(el.querySelector('a[href^="/core/commissioner"]')).toBeNull()
  })
})
