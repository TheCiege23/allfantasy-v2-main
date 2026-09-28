import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/*
 * E3 (hands-on chat test, 2026-09-25): the drawer's Discord tab showed
 * "Could not load Discord status (Discord status returned 500)." — a status code in customer copy.
 * It is a plain sentence now, with a Try again, and no status code or internal name anywhere.
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

const LEAGUES = [{ id: 'l0', name: 'Sunday Squad', platform: 'sleeper', platformLeagueId: null }]

let discordReply: () => { ok: boolean; status: number; json: () => Promise<unknown> }
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/discord/league')) return discordReply()
    return { ok: true, status: 200, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const discordReads = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/discord/league'))

function openDiscord() {
  render(
    <CommsDrawer
      open
      onClose={vi.fn()}
      mode="overlay"
      leagues={LEAGUES as never}
      pageLeagueId="l0"
      chimmyTokenCost={9}
      initialTab="discord"
      userId="me"
    />,
  )
}

describe('Discord tab — a failed status read', () => {
  it('says so in a plain sentence, with no status code, and Try again reads it again', async () => {
    discordReply = () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
    openDiscord()

    expect(await screen.findByText("Couldn't load this league's Discord. Try again.")).toBeTruthy()
    const panel = document.querySelector('.af-cm')!.textContent ?? ''
    expect(panel).not.toMatch(/\b500\b/)
    expect(panel).not.toMatch(/Discord status returned/)

    discordReply = () => ({
      ok: true,
      status: 200,
      json: async () => ({ botConfigured: true, isCommissioner: false, channel: null, missingPermissions: [] }),
    })
    const before = discordReads().length
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText(/No Discord yet for Sunday Squad/)).toBeTruthy()
    expect(discordReads().length).toBe(before + 1)
  })

  it('a thrown fetch (offline) reads the same way', async () => {
    discordReply = () => { throw new TypeError('Failed to fetch') }
    openDiscord()
    expect(await screen.findByText("Couldn't load this league's Discord. Try again.")).toBeTruthy()
    expect(document.querySelector('.af-cm')!.textContent ?? '').not.toMatch(/Failed to fetch/)
  })
})
