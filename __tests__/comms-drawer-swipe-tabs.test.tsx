import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

/**
 * Swipe between the drawer's tabs on a phone (2026-11-05), the way Discord and Sleeper move between
 * channels — and the cases where a swipe must NOT change tab, because it was a scroll or typing.
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u1' } }, status: 'authenticated' }) }))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function open() {
  render(
    <CommsDrawer
      open
      onClose={vi.fn()}
      mode="overlay"
      leagues={[{ id: 'l0', name: 'Sunday Squad', platform: 'sleeper' }] as never}
      pageLeagueId="l0"
      chimmyTokenCost={9}
      initialTab="chimmy"
      userId="u1"
    />,
  )
}
const selected = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')!.textContent
function swipe(el: Element, dx: number, dy = 0) {
  fireEvent.touchStart(el, { touches: [{ clientX: 200, clientY: 300 }] })
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] })
}
const body = () => document.querySelector('.af-cm-panel')!

describe('swiping between drawer tabs', () => {
  it('a left swipe on the body moves to the next tab, a right swipe back', () => {
    open()
    expect(selected()).toBe('Chimmy')
    swipe(body(), -120)
    expect(selected()).toBe('Huddle')
    swipe(document.querySelector('.af-cm-panel')!, 120)
    expect(selected()).toBe('Chimmy')
  })

  it('stops at the ends rather than wrapping', () => {
    open()
    swipe(body(), 120) // Chimmy → League
    swipe(document.querySelector('.af-cm-panel')!, 120) // already first
    expect(selected()).toBe('League')
  })

  it('ignores a short flick, a mostly vertical drag, the header, and the text box', () => {
    open()
    swipe(body(), -40)
    swipe(body(), -120, 80)
    swipe(document.querySelector('.af-cm-head')!, -120)
    swipe(screen.getByLabelText('Message'), -120)
    expect(selected()).toBe('Chimmy')
  })
})

describe('the expanded desktop view', () => {
  it('lists every league with its unread count, and picking one scopes the chat to it', () => {
    render(
      <CommsDrawer
        open
        onClose={vi.fn()}
        mode="overlay"
        leagues={[
          { id: 'l0', name: 'Sunday Squad', platform: 'sleeper' },
          { id: 'l1', name: 'Work League', platform: 'espn' },
        ] as never}
        pageLeagueId="l0"
        chimmyTokenCost={9}
        initialTab="league"
        userId="u1"
        tabCounts={{ league: 2, byLeague: { l1: 2 } }}
      />,
    )
    expect(screen.queryByRole('navigation', { name: 'Your leagues' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand chat' }))

    const list = screen.getByRole('navigation', { name: 'Your leagues' })
    expect(within(list).getByRole('button', { name: 'Sunday Squad' }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(within(list).getByRole('button', { name: 'Work League, 2 unread' }))
    expect(within(list).getByRole('button', { name: 'Work League, 2 unread' }).getAttribute('aria-current')).toBe('true')
    expect(document.querySelector('.af-cm-scopechip')!.textContent).toBe('Work League')
    expect(screen.getByRole('button', { name: 'Shrink chat' }).getAttribute('aria-pressed')).toBe('true')
  })
})
