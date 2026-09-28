import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'

/*
 * The client half of four server changes, through the drawer as a person uses it:
 *   - the chat bubble's number refreshes between page loads (useChatBadge → /api/chat/unread);
 *   - reading league chat moves its read marker, but only while the page is visible;
 *   - opening Chimmy clears its weekly checks from the bubble;
 *   - Discord links land on THIS league's setup screen;
 *   - Chimmy's confirm cards and a DM's trade offer/status render as cards, not plain text.
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'
import { CommsDock } from '@/components/core-app/comms/CommsDock'
import { RichMessage } from '@/components/core-app/comms/RichMessage'
import { CHAT_BADGE_POLL_MS, readChatBadge, useChatBadge } from '@/components/core-app/comms/useChatBadge'

const LEAGUES = [{ id: 'l0', name: 'Sunday Squad', platform: 'native', platformLeagueId: null }]

let fetchMock: ReturnType<typeof vi.fn>
let visibility: DocumentVisibilityState = 'visible'
const calls = (pred: (url: string, init?: RequestInit) => boolean) =>
  fetchMock.mock.calls.filter(([u, init]) => pred(String(u), init as RequestInit | undefined))

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

let discordStatus: Record<string, unknown> = { botConfigured: true, isCommissioner: true, missingPermissions: null, inviteUrl: null, channel: null }
let chimmyAnswer: Record<string, unknown> = { response: 'Done.', meta: {} }
let badgeBody: unknown = { total: 3, mentions: 1, dm: 1, league: 2, chimmy: 0 }
let badgeStatus = 200

beforeEach(() => {
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  discordStatus = { botConfigured: true, isCommissioner: true, missingPermissions: null, inviteUrl: null, channel: null }
  chimmyAnswer = { response: 'Done.', meta: {} }
  badgeBody = { total: 3, mentions: 1, dm: 1, league: 2, chimmy: 0 }
  badgeStatus = 200
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.startsWith('/api/app/leagues/l0/chat')) return json({ viewerUserId: 'me', presence: [], messages: [] })
    if (u.startsWith('/api/discord/league')) return json(discordStatus)
    if (u === '/api/chat/chimmy') return json(chimmyAnswer)
    if (u === '/api/chat/unread') return json(badgeBody, badgeStatus)
    if (u.includes('/pinned')) return json({ pinned: [] })
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function drawer(initialTab: 'league' | 'chimmy' | 'discord') {
  return render(
    <CommsDrawer
      open
      onClose={vi.fn()}
      mode="overlay"
      leagues={LEAGUES as never}
      pageLeagueId="l0"
      chimmyTokenCost={9}
      initialTab={initialTab}
      userId="me"
    />,
  )
}

describe('league chat read marker', () => {
  it('reading the league tab asks the route to mark it read', async () => {
    drawer('league')
    await waitFor(() => expect(calls((u) => u.startsWith('/api/app/leagues/l0/chat')).length).toBeGreaterThan(0))
    expect(calls((u) => u.startsWith('/api/app/leagues/l0/chat'))[0][0]).toContain('markRead=1')
  })

  it('a load while the page is hidden never marks anything read', async () => {
    visibility = 'hidden'
    drawer('league')
    await waitFor(() => expect(calls((u) => u.startsWith('/api/app/leagues/l0/chat')).length).toBeGreaterThan(0))
    for (const [u] of calls((u) => u.startsWith('/api/app/leagues/l0/chat'))) expect(String(u)).not.toContain('markRead')
  })
})

describe("Chimmy's weekly checks", () => {
  const clears = () =>
    calls((u, init) => u === '/api/chat/unread' && init?.method === 'POST' && String(init.body).includes('"chimmy"'))

  it('opening the Chimmy tab clears them from the bubble; the league tab does not', async () => {
    drawer('chimmy')
    await waitFor(() => expect(clears()).toHaveLength(1))

    fetchMock.mockClear()
    drawer('league')
    await waitFor(() => expect(calls((u) => u.startsWith('/api/app/leagues/l0/chat')).length).toBeGreaterThan(0))
    expect(clears()).toHaveLength(0)
  })

  it("an answer's confirm cards render under it, and a card with a bad shape is dropped", async () => {
    chimmyAnswer = {
      response: 'Here is the swap.',
      meta: {
        actionCards: [
          {
            actionId: 'act-1',
            kind: 'lineup',
            token: 'x'.repeat(40),
            title: 'Start Kyren Williams over Tony Pollard',
            league: { id: 'l0', name: 'Sunday Squad', sport: 'NFL' },
            week: 4,
            season: 2026,
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            warnings: [],
            lineup: { moveIn: [{ name: 'Kyren Williams', position: 'RB', team: 'LAR', slot: 'RB' }], moveOut: [{ name: 'Tony Pollard' }] },
          },
          { actionId: 'bad', kind: 'trade' },
        ],
      },
    }
    drawer('chimmy')
    const input = screen.getByLabelText('Message')
    fireEvent.change(input, { target: { value: 'start Kyren over Pollard' } })
    fireEvent.submit(input.closest('form')!)
    expect(await screen.findByText('Start Kyren Williams over Tony Pollard')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /confirm/i })).toHaveLength(1)
  })
})

describe('Discord links land on this league', () => {
  it('"Set up Discord" and "Manage Discord" carry the league', async () => {
    drawer('discord')
    const setup = (await screen.findByRole('link', { name: /Set up Discord/ })) as HTMLAnchorElement
    expect(setup.getAttribute('href')).toBe('/core/discord?league=l0')
    expect(screen.queryByText(/Open Discord to create a server/)).toBeNull()
  })

  it('once a channel exists, the commissioner manages it on the same screen', async () => {
    discordStatus = {
      ...discordStatus,
      channel: { channelName: 'league-chat', guildName: 'Sunday Squad', channelUrl: 'https://discord.com/channels/1/2' },
    }
    drawer('discord')
    const manage = (await screen.findByRole('link', { name: /Manage Discord/ })) as HTMLAnchorElement
    expect(manage.getAttribute('href')).toBe('/core/discord?league=l0')
  })
})

describe('trade offers in a DM render as cards', () => {
  const offer = {
    v: 1,
    source: 'native',
    tradeId: 't-1',
    leagueId: 'l0',
    leagueName: 'Sunday Squad',
    proposer: { manager: 'Sam', gives: [{ label: 'Ja’Marr Chase', detail: 'WR · CIN' }] },
    receiver: { manager: 'Jo', gives: [{ label: 'Justin Jefferson', detail: 'WR · MIN' }] },
    note: null,
    status: 'pending',
    href: '/league/l0?view=trades',
    directionKnown: true,
    createdAt: '2026-09-25T12:00:00.000Z',
  }

  it('the offer draws its card; the answer draws its status line', () => {
    const { container, unmount } = render(<RichMessage metadata={{ tradeOffer: offer }} viewerUserId="me" />)
    expect(container.querySelector('[data-trade-variant="offer"]')).not.toBeNull()
    unmount()

    const status = render(
      <RichMessage metadata={{ tradeOfferStatus: { source: 'native', tradeId: 't-1', status: 'accepted', href: null } }} />,
    )
    expect(status.container.querySelector('[data-trade-variant="status"]')?.getAttribute('data-trade-status')).toBe('accepted')
  })

  it('an ordinary text message still renders nothing extra', () => {
    const { container } = render(<RichMessage metadata={{ foo: 1 }} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('the chat bubble number between page loads', () => {
  it('reads the route shape and refuses anything else', () => {
    expect(readChatBadge({ total: 4, mentions: 2 })).toEqual({ unread: 4, mentions: 2 })
    expect(readChatBadge({ total: -1, mentions: 0 })).toBeNull()
    expect(readChatBadge({ total: '4', mentions: 0 })).toBeNull()
    expect(readChatBadge(null)).toBeNull()
  })

  it('polls every minute while visible and the drawer is closed, and re-reads when the drawer closes', async () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ open }) => useChatBadge(0, 0, open), { initialProps: { open: false } })
    expect(result.current).toEqual({ unread: 0, mentions: 0 })

    await act(async () => {
      vi.advanceTimersByTime(CHAT_BADGE_POLL_MS)
    })
    expect(result.current).toEqual({ unread: 3, mentions: 1 })

    // Open: no polling while the drawer is up.
    rerender({ open: true })
    fetchMock.mockClear()
    await act(async () => {
      vi.advanceTimersByTime(CHAT_BADGE_POLL_MS * 3)
    })
    expect(calls((u) => u === '/api/chat/unread')).toHaveLength(0)

    // Close: read right away.
    badgeBody = { total: 0, mentions: 0 }
    rerender({ open: false })
    await act(async () => {
      await Promise.resolve()
    })
    expect(calls((u) => u === '/api/chat/unread')).toHaveLength(1)
    expect(result.current).toEqual({ unread: 0, mentions: 0 })
  })

  it('a hidden tab does not poll; a failed read keeps the last number; a 401 stops polling', async () => {
    vi.useFakeTimers()
    visibility = 'hidden'
    const { result } = renderHook(() => useChatBadge(5, 0, false))
    await act(async () => {
      vi.advanceTimersByTime(CHAT_BADGE_POLL_MS * 2)
    })
    expect(calls((u) => u === '/api/chat/unread')).toHaveLength(0)

    visibility = 'visible'
    badgeStatus = 500
    await act(async () => {
      vi.advanceTimersByTime(CHAT_BADGE_POLL_MS)
    })
    expect(result.current).toEqual({ unread: 5, mentions: 0 })

    badgeStatus = 401
    await act(async () => {
      vi.advanceTimersByTime(CHAT_BADGE_POLL_MS)
    })
    const after401 = calls((u) => u === '/api/chat/unread').length
    await act(async () => {
      vi.advanceTimersByTime(CHAT_BADGE_POLL_MS * 3)
    })
    expect(calls((u) => u === '/api/chat/unread')).toHaveLength(after401)
    expect(result.current).toEqual({ unread: 5, mentions: 0 })
  })

  it('a fresh server count from navigation replaces the polled one', () => {
    const { result, rerender } = renderHook(({ n }) => useChatBadge(n, 0, false), { initialProps: { n: 2 } })
    expect(result.current.unread).toBe(2)
    rerender({ n: 7 })
    expect(result.current.unread).toBe(7)
  })
})

describe('the bubble draws the live number', () => {
  it('starts from the page count and moves when a poll brings a new one', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
    )
    vi.useFakeTimers()
    render(<CommsDock leagues={LEAGUES as never} pageLeagueId={null} chimmyTokenCost={9} unread={1} mentions={0} />)
    expect(screen.getByRole('button', { name: 'Open communications (1 unread)' })).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(CHAT_BADGE_POLL_MS)
    })
    expect(screen.getByRole('button', { name: 'Open communications (1 mention, 3 unread)' })).toBeTruthy()
    expect(document.querySelector('.af-cm-launchdot')?.textContent).toBe('@3')

    badgeBody = { total: 4, mentions: 0 }
    await act(async () => {
      vi.advanceTimersByTime(CHAT_BADGE_POLL_MS)
    })
    expect(screen.getByRole('button', { name: 'Open communications (4 unread)' })).toBeTruthy()
    expect(document.querySelector('.af-cm-launchdot')?.textContent).toBe('4')
  })
})
