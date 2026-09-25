import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/*
 * The league PAGE's chat tab (LeagueShell → LeagueChatSurface → LeagueChatPanel).
 *
 * 🛑 IT RENDERED AVATARS AND NO TEXT. Every row went through LeagueMessageRow, a test stub
 * whose body was the comment "rest of message rendering omitted". These drive the real panel
 * against the wire shapes the routes return, with fetch answered BY URL, never by call order.
 */

const h = vi.hoisted(() => ({ params: new URLSearchParams() }))

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/league/L1',
  useSearchParams: () => h.params,
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))
/* The Chimmy tab's shell is its own suite's business; here it only has to mount. */
vi.mock('@/components/chimmy', () => ({ ChimmyChatShell: () => <div data-testid="chimmy-shell" /> }))
vi.mock('@/components/commish/BroadcastModal', () => ({ default: () => null }))

import LeagueChatPanel from '@/components/chat/LeagueChatPanel'

const T = (min: number) => new Date(Date.UTC(2026, 8, 25, 14, min)).toISOString()

const LEAGUE_MESSAGES = [
  { id: 'a', text: 'who wants my RB1', createdAt: T(0), authorId: 'sam', authorName: 'Sam', authorAvatarUrl: 'https://cdn.test/sam.png' },
  { id: 'b', text: 'https://media2.giphy.com/media/x/giphy.gif', createdAt: T(1), authorId: 'jo', authorName: 'Jo', messageType: 'gif' },
  { id: 'c', text: 'me, obviously', createdAt: T(2), authorId: 'me', authorName: 'Me', parentMessageId: 'a' },
  {
    id: 'd',
    text: '🎬 GIF',
    createdAt: T(3),
    authorId: 'jo',
    authorName: 'Jo',
    metadata: { gif: { url: 'https://static.klipy.com/a.gif', previewUrl: 'https://static.klipy.com/a.gif', title: 'lol' } },
  },
  {
    id: 'e',
    text: '📎 Media',
    createdAt: T(4),
    authorId: 'sam',
    authorName: 'Sam',
    metadata: { attachments: [{ type: 'image', url: '/api/chat/upload?path=roster.png' }] },
  },
  {
    id: 'f',
    text: '📊 Who wins the week?',
    createdAt: T(5),
    authorId: 'sam',
    authorName: 'Sam',
    metadata: {
      poll: {
        question: 'Who wins the week?',
        options: [
          { id: 'o1', text: 'Us', votes: [] },
          { id: 'o2', text: 'Them', votes: ['sam'] },
        ],
      },
    },
  },
  { id: 'g', text: 'mock at 9?', createdAt: T(6), authorId: 'kim', authorName: 'Kim', source: 'draft' },
  { id: 'h', text: 'https://evil.example/x.gif', createdAt: T(7), authorId: 'jo', authorName: 'Jo', messageType: 'gif' },
]

let fetchMock: ReturnType<typeof vi.fn>
let chatBody: Record<string, unknown>
const calls = (pred: (url: string, init?: RequestInit) => boolean) =>
  fetchMock.mock.calls.filter(([u, init]) => pred(String(u), init as RequestInit | undefined))
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

beforeEach(() => {
  h.params = new URLSearchParams()
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  chatBody = {
    viewerUserId: 'me',
    presence: [],
    includeDraft: true,
    draft: { live: true, status: 'in_progress', href: '/league/L1/draft' },
    messages: LEAGUE_MESSAGES,
  }
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    if (u.startsWith('/api/config/features')) return json({ features: {} })
    if (u.startsWith('/api/app/leagues/L1/chat')) {
      if (method === 'POST') return json({ message: { id: 'new1' } })
      return json(chatBody)
    }
    if (u.includes('league%3AL1/pinned')) return json({ pinned: [] })
    if (u.includes('league%3AL1/typing')) return json({ typing: [] })
    if (u.includes('league%3AL1/search')) {
      return json({ messages: [{ id: 'old1', body: 'RB1 for two firsts', senderName: 'Sam', createdAt: T(-600) }] })
    }
    if (u.includes('league%3AL1/messages?') && u.includes('source=tribe_t1')) {
      return json({
        messages: [
          { id: 't1m', senderUserId: 'kim', senderName: 'Kim', body: 'vote Jo out', createdAt: T(0), channelSource: 'tribe_t1' },
          { id: 't2m', senderUserId: 'me', senderName: 'Me', body: 'agreed', createdAt: T(1), channelSource: 'tribe_t1' },
        ],
      })
    }
    if (u.startsWith('/api/shared/chat/threads/t1/messages')) {
      return json({ messages: [{ id: 'd1', senderUserId: 'jordan', senderName: 'Jordan', body: 'you want Chase?', createdAt: T(0) }] })
    }
    if (u === '/api/shared/chat/threads') {
      return json({ threads: [{ id: 't1', threadType: 'dm', title: 'Jordan', lastMessageAt: T(3), unreadCount: 0, memberCount: 2 }] })
    }
    return json({ status: 'ok' })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function row(id: string): HTMLElement {
  const el = document.querySelector(`[data-message-id="${id}"]`)
  if (!el) throw new Error(`no row ${id}`)
  return el as HTMLElement
}

async function openPanel() {
  render(<LeagueChatPanel leagueId="L1" leagueName="Sunday Squad" isCommissioner />)
  /* Twice on screen: the message, and the quote on the reply to it. */
  await screen.findAllByText('who wants my RB1')
}

function openActions(id: string) {
  fireEvent.keyDown(within(row(id)).getByRole('article'), { key: 'Enter' })
  return screen.getByRole('dialog')
}

describe('the league page chat shows the conversation', () => {
  it('renders every message’s text — the stub rendered none', async () => {
    await openPanel()
    expect(screen.getByText('me, obviously')).toBeTruthy()
    expect(screen.getByText('mock at 9?')).toBeTruthy()
  })

  it('puts yours on your side and theirs on the left with their avatar', async () => {
    await openPanel()
    expect(row('c').getAttribute('data-mine')).toBe('true')
    expect(row('a').getAttribute('data-mine')).toBe('false')
    expect(row('a').querySelector('.af-cm-avatar img')!.getAttribute('src')).toBe('https://cdn.test/sam.png')
  })

  it('renders GIFs in both wire shapes, credited, and nothing from an unknown host', async () => {
    await openPanel()
    expect(within(row('b')).getByAltText('GIF').getAttribute('src')).toBe('https://media2.giphy.com/media/x/giphy.gif')
    expect(within(row('b')).getByText('via GIPHY')).toBeTruthy()
    expect(within(row('d')).getByAltText('lol').getAttribute('src')).toBe('https://static.klipy.com/a.gif')
    expect(within(row('d')).getByText('via KLIPY')).toBeTruthy()
    expect(screen.queryByText('🎬 GIF')).toBeNull()
    expect(row('h').querySelector('img')).toBeNull()
    expect(within(row('h')).getByText('https://evil.example/x.gif')).toBeTruthy()
  })

  it('opens a photo full size', async () => {
    await openPanel()
    fireEvent.click(within(row('e')).getByRole('button', { name: 'Open image full size' }))
    const viewer = screen.getByRole('dialog', { name: 'Image' })
    expect(viewer.querySelector('img')!.getAttribute('src')).toBe('/api/chat/upload?path=roster.png')
  })

  it('votes in a poll through the league room', async () => {
    await openPanel()
    fireEvent.click(within(row('f')).getByRole('button', { name: /^Us, 0 votes/ }))
    await waitFor(() => expect(calls((u, i) => u.endsWith('/messages/f/vote') && i?.method === 'POST')).toHaveLength(1))
    const [, init] = calls((u) => u.endsWith('/messages/f/vote'))[0]!
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ optionId: 'o1' })
  })

  it('quotes what a reply answers', async () => {
    await openPanel()
    const quote = row('c').querySelector('.af-cm-quote')!
    expect(quote.textContent).toContain('Sam')
    expect(quote.textContent).toContain('who wants my RB1')
  })
})

describe('the league page chat does everything the drawer does', () => {
  it('replies with the quote attached to the send', async () => {
    await openPanel()
    fireEvent.click(within(openActions('a')).getByRole('button', { name: /Reply/ }))
    expect(screen.getByText('Replying to Sam')).toBeTruthy()
    fireEvent.change(screen.getByTestId('league-chat-textarea'), { target: { value: 'yep' } })
    fireEvent.click(screen.getByTestId('league-chat-send'))
    await waitFor(() => expect(calls((u, i) => u === '/api/app/leagues/L1/chat' && i?.method === 'POST')).toHaveLength(1))
    const [, init] = calls((u, i) => u === '/api/app/leagues/L1/chat' && i?.method === 'POST')[0]!
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ message: 'yep', parentMessageId: 'a' })
  })

  it('copies your own message', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await openPanel()
    fireEvent.click(within(openActions('c')).getByRole('button', { name: /Copy your message/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('me, obviously'))
  })

  it('edits and deletes your own message through the league room', async () => {
    await openPanel()
    fireEvent.click(within(openActions('c')).getByRole('button', { name: /Edit/ }))
    fireEvent.change(screen.getByLabelText('Edit your message'), { target: { value: 'me, definitely' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls((u, i) => u.endsWith('league%3AL1/messages/c') && i?.method === 'PATCH')).toHaveLength(1))

    const sheet = openActions('c')
    fireEvent.click(within(sheet).getByRole('button', { name: /Delete/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls((u, i) => u.endsWith('league%3AL1/messages/c') && i?.method === 'DELETE')).toHaveLength(1))
  })

  it('pins for the league and reacts', async () => {
    await openPanel()
    fireEvent.click(within(openActions('a')).getByRole('button', { name: /Pin for the league/ }))
    await waitFor(() => expect(calls((u, i) => u.endsWith('league%3AL1/pin') && i?.method === 'POST')).toHaveLength(1))
    fireEvent.click(within(openActions('a')).getByRole('button', { name: 'React 🔥' }))
    await waitFor(() => expect(calls((u, i) => u.endsWith('/messages/a/reactions') && i?.method === 'POST')).toHaveLength(1))
  })

  it('searches the chat', async () => {
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: /Search chat/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search this chat' }), { target: { value: 'RB1' } })
    expect(await screen.findByText('RB1 for two firsts')).toBeTruthy()
  })

  it('names the tab Chimmy, never bare "AI"', async () => {
    await openPanel()
    expect(screen.getByRole('button', { name: /Chimmy/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /AI Chat/ })).toBeNull()
  })

  it('opens DMs and Huddles on the Messages tab', async () => {
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: /Messages/ }))
    expect(await screen.findByRole('button', { name: /Jordan/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Huddles' })).toBeTruthy()
  })
})

describe('asking Chimmy about a DM', () => {
  it('hands the conversation to the Chimmy tab', async () => {
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: /Messages/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Jordan/ }))
    await screen.findByText('you want Chase?')
    fireEvent.click(screen.getByTestId('league-chat-dm-ai-chat-button'))
    expect(await screen.findByTestId('chimmy-shell')).toBeTruthy()
  })
})

describe('league chat and the draft room point at each other', () => {
  it('offers the draft room while a draft is live', async () => {
    await openPanel()
    const link = screen.getByTestId('league-chat-open-draft-room')
    expect(link.getAttribute('href')).toBe('/league/L1/draft')
  })

  it('tags a message posted in the draft room', async () => {
    await openPanel()
    expect(within(row('g')).getByText('Draft room')).toBeTruthy()
    expect(within(row('a')).queryByText('Draft room')).toBeNull()
  })

  it('shows no draft banner when no draft is live', async () => {
    chatBody = { ...chatBody, draft: { live: false, status: 'completed', href: '/league/L1/draft' }, includeDraft: false }
    await openPanel()
    expect(screen.queryByTestId('league-chat-open-draft-room')).toBeNull()
  })

  it('lets the reader hide the draft room — sent explicitly, so the server stops folding it in', async () => {
    await openPanel()
    expect(calls((u) => u.startsWith('/api/app/leagues/L1/chat?'))[0]![0]).not.toContain('includeDraft')
    fireEvent.click(screen.getByRole('button', { name: 'Hide draft room' }))
    await waitFor(() =>
      expect(calls((u) => u.startsWith('/api/app/leagues/L1/chat?') && u.includes('includeDraft=0')).length).toBeGreaterThan(0),
    )
  })
})

describe('a Survivor tribe channel stays a tribe channel', () => {
  it('reads and posts through the shared room with its source', async () => {
    h.params = new URLSearchParams('source=tribe_t1')
    render(<LeagueChatPanel leagueId="L1" leagueName="Island" />)
    await screen.findByText('vote Jo out')
    expect(row('t2m').getAttribute('data-mine')).toBe('true')
    expect(calls((u) => u.startsWith('/api/app/leagues/L1/chat'))).toHaveLength(0)
    fireEvent.change(screen.getByTestId('league-chat-textarea'), { target: { value: 'tonight' } })
    fireEvent.click(screen.getByTestId('league-chat-send'))
    await waitFor(() =>
      expect(calls((u, i) => u === '/api/shared/chat/threads/league%3AL1/messages' && i?.method === 'POST')).toHaveLength(1),
    )
    const [, init] = calls((u, i) => u === '/api/shared/chat/threads/league%3AL1/messages' && i?.method === 'POST')[0]!
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ body: 'tonight', source: 'tribe_t1' })
  })
})
