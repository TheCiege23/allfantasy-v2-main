/**
 * The blue C beside every league the viewer commissions — and ONLY those — in the
 * three league lists people see most: the league rail, the "All leagues"
 * switcher and Home → My Leagues. Each list is fed the same `isCommissioner`
 * flag as the More menu's "Commissioner N" count.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/*
 * ONE router object, as Next's real useRouter is stable. A fresh object per call made the
 * shell's router-dependent effects re-run on every render — an infinite loop under test only.
 */
const nav = vi.hoisted(() => ({ router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} } }))
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

import { ScopeSwitcher } from '@/components/core-app/ScopeSwitcher'
import { Dash3ALeagues } from '@/components/core-app/screens/Dashboard3A'

afterEach(cleanup)

const LEAGUES = [
  { id: 'lg-mine', name: 'Iron Horse', isCommissioner: true },
  { id: 'lg-theirs', name: 'Sunday Crew', isCommissioner: false },
]

/** Which league names carry a badge, read from the rows themselves. */
function badgedNames(rowSelector: string, nameSelector: string, root: ParentNode = document) {
  return Array.from(root.querySelectorAll(rowSelector))
    .filter((row) => row.querySelector('[data-testid="commissioner-badge"]'))
    .map((row) => row.querySelector(nameSelector)?.textContent)
}

describe('commissioner badge', () => {
  // The rail case lives in league-picker-distinct-names.test.tsx, beside the shell fixture it needs.

  it('the "All leagues" switcher marks only the league you commission, and names stay clean', () => {
    render(
      <ScopeSwitcher
        leagues={LEAGUES.map((l) => ({ ...l, platform: 'sleeper', sport: 'NFL' }))}
        scopeValue={null}
        label="All leagues"
        selectedLeagueId={null}
        favoriteIds={[]}
        leagueScreen={false}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Viewing/ }))
    expect(badgedNames('.af-scope-row', '.af-scope-league-name')).toEqual(['Iron Horse'])
    // The C is drawn by CSS: it must not leak into the name text anything reads back.
    expect(Array.from(document.querySelectorAll('.af-scope-league-name')).map((n) => n.textContent)).toEqual([
      'Iron Horse',
      'Sunday Crew',
    ])
    expect(screen.getAllByRole('img', { name: "You're the commissioner" })).toHaveLength(1)
  })

  it('Home → My Leagues marks only the league you commission', () => {
    const { container } = render(
      <Dash3ALeagues leagues={LEAGUES.map((l) => ({ ...l, platform: 'sleeper' })) as never} totalLeagues={2} freshness={null} />,
    )
    expect(badgedNames('.af3a-league', 'b', container)).toEqual(['Iron Horse'])
  })
})
