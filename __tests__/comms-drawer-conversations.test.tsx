import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/*
 * The League, DM and Huddle tabs end to end through the drawer, against the wire
 * shapes the routes actually return: avatars that were sent and never drawn, GIFs
 * in either shape, typing in both directions, search over the existing route, and
 * the thread's own members behind `@`.
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'
import ThreadPanel from '@/components/core-app/comms/ThreadPanel'

const LEAGUES = [{ id: 'l0', name: 'Sunday Squad', platform: 'sleeper', platformLeagueId: null }]
const T = (min: number) => new Date(Date.UTC(2026, 8, 25, 14, min)).toISOString()

let fetchMock: ReturnType<typeof vi.fn>
const calls = (pred: (url: string, init?: RequestInit) => boolean) =>
  fetchMock.mock.calls.filter(([u, init]) => pred(String(u), init as RequestInit | undefined))

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.startsWith('/api/app/leagues/l0/chat')) {
      return json({
        viewerUserId: 'me',
        presence: [],
        messages: [
          { id: 'a', text: 'who wants my RB1', createdAt: T(0), authorId: 'sam', authorName: 'Sam', authorAvatarUrl: 'https://cdn.test/sam.png' },
          { id: 'b', text: 'https://media2.giphy.com/media/x/giphy.gif', createdAt: T(1), authorId: 'jo', authorName: 'Jo', messageType: 'gif' },
          { id: 'c', text: 'me, obviously', createdAt: T(2), authorId: 'me', authorName: 'Me' },
        ],
      })
    }
    if (u.includes('/pinned')) return json({ pinned: [] })
    if (u.includes('league%3Al0/typing') && (!init || init.method !== 'POST')) {
      return json({ typing: [{ userId: 'jo', name: 'Jo' }] })
    }
    if (u.includes('league%3Al0/search')) {
      return json({ messages: [{ id: 'old1', body: 'RB1 for two firsts', senderName: 'Sam', createdAt: T(-600) }] })
    }
    if (u === '/api/shared/chat/threads') {
      return json({ threads: [{ id: 't1', threadType: 'dm', title: 'Jordan', lastMessageAt: T(3), unreadCount: 0, memberCount: 2 }] })
    }
    if (u.startsWith('/api/shared/chat/threads/t1/messages')) {
      return json({
        messages: [
          { id: 'd1', senderUserId: 'jordan', senderName: 'Jordan Love', senderUsername: 'jlove', senderAvatarUrl: 'https://cdn.test/j.png', body: 'u up', createdAt: T(0), messageType: 'text' },
          { id: 'd2', senderUserId: 'me', senderName: 'Me', body: '🎬 GIF', createdAt: T(1), metadata: { gif: { url: 'https://static.klipy.com/a.gif', previewUrl: 'https://static.klipy.com/a.gif', title: 'lol' } } },
        ],
      })
    }
    if (u.startsWith('/api/shared/chat/threads/t1/read-receipts')) {
      return json({ receipts: [{ userId: 'jordan', displayName: 'Jordan Love', username: 'jlove', lastReadAt: T(2) }] })
    }
    if (u.startsWith('/api/shared/chat/threads/t1/typing')) return json({ typing: [] })
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function openLeague() {
  render(
    <CommsDrawer
      open
      onClose={vi.fn()}
      mode="overlay"
      leagues={LEAGUES as never}
      pageLeagueId="l0"
      chimmyTokenCost={9}
      initialTab="league"
      userId="me"
    />,
  )
}

describe('League tab', () => {
  it('draws the avatar the API always sent, and puts your message on your side', async () => {
    openLeague()
    await screen.findByText('who wants my RB1')
    const rows = document.querySelectorAll('.af-cm-row')
    expect(rows[0]!.querySelector('.af-cm-avatar img')!.getAttribute('src')).toBe('https://cdn.test/sam.png')
    expect(rows[2]!.getAttribute('data-mine')).toBe('true')
  })

  it('renders a GIF posted from the full league panel as the GIF, not as a link', async () => {
    openLeague()
    await screen.findByText('who wants my RB1')
    expect(screen.getByAltText('GIF').getAttribute('src')).toBe('https://media2.giphy.com/media/x/giphy.gif')
    expect(screen.queryByText('https://media2.giphy.com/media/x/giphy.gif')).toBeNull()
  })

  it('shows who is typing in the league', async () => {
    openLeague()
    expect(await screen.findByText('Jo is typing…')).toBeTruthy()
  })

  it('SENDS typing for the league room as you type', async () => {
    openLeague()
    await screen.findByText('who wants my RB1')
    fireEvent.change(screen.getByTestId('league-chat-textarea'), { target: { value: 'hol' } })
    await waitFor(() =>
      expect(calls((u, i) => u.includes('league%3Al0/typing') && i?.method === 'POST')).toHaveLength(1),
    )
  })

  it('searches the chat through the existing route and shows older hits in full', async () => {
    openLeague()
    await screen.findByText('who wants my RB1')
    fireEvent.click(screen.getByRole('button', { name: /Search chat/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search this chat' }), { target: { value: 'RB1' } })
    expect(await screen.findByText('RB1 for two firsts')).toBeTruthy()
    expect(calls((u) => u.includes('league%3Al0/search?q=RB1')).length).toBeGreaterThan(0)
  })

  it('keeps pin in league chat', async () => {
    openLeague()
    await screen.findByText('who wants my RB1')
    fireEvent.keyDown(screen.getAllByRole('article')[0]!, { key: 'Enter' })
    expect(screen.getByRole('button', { name: /Pin for the league/ })).toBeTruthy()
  })
})

describe('DMs', () => {
  async function openDm() {
    render(<ThreadPanel kind="dm" privacy="private" />)
    fireEvent.click(await screen.findByRole('button', { name: /Jordan/ }))
    await screen.findByText('u up')
  }

  it('shows the sender’s avatar and renders the shared composer’s GIF without its "🎬 GIF" label', async () => {
    await openDm()
    expect(document.querySelector('.af-cm-avatar img')!.getAttribute('src')).toBe('https://cdn.test/j.png')
    expect(screen.getByAltText('lol')).toBeTruthy()
    expect(screen.queryByText('🎬 GIF')).toBeNull()
  })

  it('offers the thread’s members after @ — a DM has no league to search', async () => {
    await openDm()
    const box = screen.getByTestId('league-chat-textarea') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '@j', selectionStart: 2 } })
    fireEvent.keyUp(box, { key: 'j', target: { selectionStart: 2 } })
    expect(await screen.findByRole('button', { name: /@jlove/ })).toBeTruthy()
  })

  it('reacts to a DM message from its action sheet', async () => {
    fetchMock.mockImplementationOnce(async () =>
      json({ threads: [{ id: 't1', threadType: 'dm', title: 'Jordan', lastMessageAt: T(3), unreadCount: 0, memberCount: 2 }] }),
    )
    await openDm()
    // Long-press / Enter opens the sheet; a quick reaction posts to the thread's route.
    fireEvent.keyDown(screen.getAllByRole('article')[0]!, { key: 'Enter' })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'React 🔥' }))
    await waitFor(() =>
      expect(calls((u, i) => u.endsWith('/messages/d1/reactions') && i?.method === 'POST')).toHaveLength(1),
    )
  })
})
