import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Tribe emoji in names" on screen: the swap/shuffle reveal (and its copy following League.language)
 * and the tribe chat header. Display only.
 */

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/league/L1',
  useSearchParams: () => nav.params,
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/chimmy', () => ({ ChimmyChatShell: () => <div data-testid="chimmy-shell" /> }))
vi.mock('@/components/commish/BroadcastModal', () => ({ default: () => null }))

import { TribeShuffle } from '@/components/survivor/late/TribeShuffle'
import LeagueChatPanel from '@/components/chat/LeagueChatPanel'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function shuffleView(over: Record<string, unknown> = {}) {
  return {
    language: null,
    swapWeek: 4,
    mergeWeek: 9,
    names: { r1: 'Ana', r2: 'Ben' },
    tribes: [
      { id: 'vela', name: 'Vela 🦂', emoji: '🦂', crestUrl: null, primary: '#3f9fc4', secondary: '#111111' },
      { id: 'koa', name: 'Koa', emoji: null, crestUrl: null, primary: '#c43f3f', secondary: '#111111' },
    ],
    swap: { week: 4, sealed: false, revealAt: null, before: [{ tribeId: 'vela', rosterIds: ['r1'] }, { tribeId: 'koa', rosterIds: ['r2'] }], after: [{ tribeId: 'vela', rosterIds: ['r1'] }, { tribeId: 'koa', rosterIds: ['r2'] }], movedCount: 0 },
    merge: null,
    viewer: { isCommissioner: false, rosterId: 'r1' },
    sealed: false,
    ...over,
  }
}

describe('the swap / shuffle reveal', () => {
  it('shows each castaway with the emoji of the tribe column they stand in', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ view: shuffleView() }) })
    render(<TribeShuffle leagueId="L1" />)
    expect(await screen.findByText('Ana 🦂')).toBeInTheDocument()
    expect(screen.getByText('Ben')).toBeInTheDocument()
    expect(screen.queryByText('Ben 🦂')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tribe swap and merge')
  })

  it("follows the league's language: a Spanish league reads Spanish", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ view: shuffleView({ language: 'es' }) }) })
    render(<TribeShuffle leagueId="L1" />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Cambio de tribus y fusión' })).toBeInTheDocument()
    expect(screen.getByText('Cómo funciona el cambio')).toBeInTheDocument()
    expect(screen.getByText('Ningún mánager cambió de tribu')).toBeInTheDocument()
    expect(screen.getByText('Se queda en Vela 🦂')).toBeInTheDocument()
  })
})

describe('the tribe chat header', () => {
  function chatFetch(tribeEmojiInNames: boolean) {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/survivor/summary')) {
        return new Response(JSON.stringify({ tribeEmojiInNames, tribes: [{ id: 'vela', name: 'Vela', markUrl: '/mark.svg', tribeEmoji: '🦂' }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ messages: [] }), { status: 200 })
    })
  }

  it('shows the tribe emoji beside the tribe name when the setting is on', async () => {
    nav.params = new URLSearchParams('source=tribe_vela')
    chatFetch(true)
    render(<LeagueChatPanel leagueId="L1" leagueName="Isles" />)
    expect(await screen.findByText('Vela 🦂 tribe chat · Messages · Chimmy')).toBeInTheDocument()
  })

  it('setting off: the plain tribe name', async () => {
    nav.params = new URLSearchParams('source=tribe_vela')
    chatFetch(false)
    render(<LeagueChatPanel leagueId="L1" leagueName="Isles" />)
    expect(await screen.findByText('Vela tribe chat · Messages · Chimmy')).toBeInTheDocument()
  })
})
