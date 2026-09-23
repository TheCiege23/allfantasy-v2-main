import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * League-first phase 2: the chat bar names ONE league, so the drawer it opens must be scoped to
 * that league even after the user picked another one by hand — and a repeat of the same request
 * must still apply (`initialTab` alone only followed a CHANGE of tab).
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

const LEAGUES = [
  { id: 'l0', name: 'Sunday Squad', platform: 'sleeper' },
  { id: 'dj', name: 'Draft Junkies', platform: 'sleeper' },
]

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type Req = { seq: number; tab: 'league' | 'chimmy' | null; leagueId: string | null } | null
const drawer = (openRequest: Req) => (
  <CommsDrawer
    open
    onClose={vi.fn()}
    mode="overlay"
    leagues={LEAGUES as never}
    pageLeagueId="l0"
    chimmyTokenCost={9}
    initialTab="chimmy"
    userId="u1"
    openRequest={openRequest}
  />
)
const scopeValue = () => (screen.getByLabelText('League scope') as HTMLSelectElement).value

describe('CommsDrawer openRequest', () => {
  it('rescopes to the requested league over a hand-picked one, and a repeat still applies', () => {
    const { rerender } = render(drawer(null))
    expect(scopeValue()).toBe('l0')
    rerender(drawer({ seq: 1, tab: 'chimmy', leagueId: 'dj' }))
    expect(scopeValue()).toBe('dj')
    fireEvent.change(screen.getByLabelText('League scope'), { target: { value: 'l0' } })
    expect(scopeValue()).toBe('l0')
    rerender(drawer({ seq: 2, tab: 'chimmy', leagueId: 'dj' }))
    expect(scopeValue()).toBe('dj')
  })
  it('ignores a league the user does not have', () => {
    const { rerender } = render(drawer(null))
    rerender(drawer({ seq: 1, tab: 'chimmy', leagueId: 'not-mine' }))
    expect(scopeValue()).toBe('l0')
  })
})
