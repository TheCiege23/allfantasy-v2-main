import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The phone's More sheet, simplified (2026-11-24). It listed every screen — 27 rows, ~1,420px in a
 * ~590px sheet — including the five tabs on the bar right under it, and had no Import or Create.
 * Now: nothing the bar shows is repeated, Import and Create lead the sheet, and the rows sit two to a
 * row (CSS, measured on a phone: 1,420px -> 860px with a league open).
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

import AfCoreShell from '@/components/core-app/AfCoreShell'

afterEach(cleanup)

const LEAGUES = [{ id: 'l1', name: 'Sunday Night Redraft', platform: 'sleeper', mark: 'S' }]
const path = (h: string) => h

function openMore(props: Record<string, unknown> = {}) {
  const { container, getByRole } = render(
    <AfCoreShell active="home" leagues={LEAGUES as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} {...props}>
      <div>screen</div>
    </AfCoreShell>,
  )
  const bar = Array.from(container.querySelectorAll('.af-tabbar a')).map((a) => path(a.getAttribute('href') ?? ''))
  fireEvent.click(getByRole('button', { name: 'More' }))
  const sheet = document.querySelector('#af-mobile-more') as HTMLElement
  const more = Array.from(sheet.querySelectorAll('a')).map((a) => path(a.getAttribute('href') ?? ''))
  return { bar, more, sheet }
}

describe.each([
  ['inside a league', { selectedLeagueId: 'l1' }],
  ['with no league open', {}],
])('the More sheet %s', (_label, props) => {
  it('does not repeat a screen the bar under it already shows', () => {
    const { bar, more } = openMore(props)
    expect(bar.length).toBe(5)
    for (const href of bar) expect(more, href).not.toContain(href)
  })

  it('leads with Import a league and Create a league', () => {
    const { sheet } = openMore(props)
    const first = sheet.querySelector('.af-mobile-more-list > .af-mobile-more-group')!
    expect(first.getAttribute('data-testid')).toBe('af-more-add')
    const links = Array.from(first.querySelectorAll('a')).map((a) => [a.textContent?.trim(), a.getAttribute('href')])
    expect(links).toEqual([
      ['⇣Import a league', '/import'],
      ['＋Create a league', '/create-league'],
    ])
  })

  it('still carries the screens that are not on the bar, and support', () => {
    const { more, sheet } = openMore(props)
    expect(more.some((h) => h.startsWith('/core/rankings'))).toBe(true)
    expect(more.some((h) => /settings/.test(h))).toBe(true)
    expect(sheet.textContent).toContain('Contact support')
    // No heading is left standing over an empty group.
    for (const group of sheet.querySelectorAll('.af-mobile-more-group')) {
      expect(group.querySelectorAll('a, button').length, group.textContent ?? '').toBeGreaterThan(0)
    }
  })
})
