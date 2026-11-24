// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

/**
 * Import and Create in the league switcher (2026-11-24).
 *
 * On a computer they sit at the foot of the league rail. On a phone the rail is hidden, so once a user
 * had imported a league the only way to add another was More → scroll to the Play sheet. The switcher
 * is the phone's league list, so the two buttons live at its foot too.
 */

const nav = vi.hoisted(() => ({ pushed: [] as string[] }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => nav.pushed.push(href), replace: () => {}, prefetch: () => {}, refresh: () => {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: unknown }) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}))

import { ScopeSwitcher } from '@/components/core-app/ScopeSwitcher'

afterEach(() => {
  cleanup()
  nav.pushed.length = 0
})

function open() {
  render(
    <ScopeSwitcher
      leagues={[{ id: 'a', name: 'The Deep!', platform: 'sleeper', sport: 'NFL' }]}
      scopeValue={null}
      label="All leagues"
      selectedLeagueId={null}
      favoriteIds={[]}
      leagueScreen={false}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Viewing/ }))
}

describe('league switcher: add a league', () => {
  it('offers Import and Create at the foot of the league list', () => {
    open()
    const add = screen.getByTestId('scope-add-league')
    expect(within(add).getByRole('link', { name: /Import a league/ }).getAttribute('href')).toBe('/import')
    expect(within(add).getByRole('link', { name: /Create a league/ }).getAttribute('href')).toBe('/create-league')
  })

  it('tapping one goes there and closes the list', () => {
    open()
    fireEvent.click(screen.getByRole('link', { name: /Create a league/ }))
    expect(nav.pushed).toEqual(['/create-league'])
    expect(screen.queryByTestId('scope-add-league')).toBeNull()
  })

  it('is not drawn while the list is closed', () => {
    render(<ScopeSwitcher leagues={[]} scopeValue={null} label="All leagues" selectedLeagueId={null} favoriteIds={[]} leagueScreen={false} />)
    expect(screen.queryByTestId('scope-add-league')).toBeNull()
  })
})
