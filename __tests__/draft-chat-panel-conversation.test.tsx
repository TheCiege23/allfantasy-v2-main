import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/*
 * Draft room chat, driven the way a drafter uses it, with fetch answered BY URL.
 *
 * What was broken, each pinned below:
 *   - GIF was a window.prompt that typed `[GIF] <url>`; no search, no host check, no credit;
 *   - a GIF or photo sent from LEAGUE chat arrived as the words "🎬 GIF" / "📎 Media";
 *   - emoji was a row of eight, reactions a row of six;
 *   - taking a reaction back could POST instead of DELETE;
 *   - no photos, replies, copy, edit or delete; @mentions notified nobody;
 *   - the draft room could not reach the league's own chat.
 */

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

import { DraftChatPanel, type DraftChatMessage } from '@/components/app/draft-room/DraftChatPanel'

const T = (min: number) => new Date(Date.UTC(2026, 8, 25, 20, min)).toISOString()

function wire(over: Partial<DraftChatMessage> & { id: string }): DraftChatMessage {
  return {
    from: 'Sam',
    text: 'hello',
    at: T(0),
    messageType: 'text',
    messageCategory: 'USER_MESSAGE',
    sourceContext: 'draft_room',
    syncToLeagueChat: false,
    senderUserId: 'sam',
    reactions: [],
    metadata: null,
    ...over,
  }
}

const MESSAGES: DraftChatMessage[] = [
  wire({ id: 'm1', text: 'RB run incoming', reactions: [{ emoji: '🔥', count: 1, userIds: ['me'] }], metadata: { reactions: [{ emoji: '🔥', count: 1, userIds: ['me'] }] } }),
  wire({ id: 'm2', from: 'Me', senderUserId: 'me', text: 'taking the best QB', at: T(1) }),
  wire({
    id: 'p1',
    from: 'Draft room',
    text: 'Bijan Robinson (RB) → Team Kyle · Pick 1.01 (#1)',
    at: T(2),
    messageType: 'draft_pick',
    messageCategory: 'SYSTEM_PICK_NOTIFICATION',
    isDraftPickEvent: true,
    draftPickMeta: {
      playerName: 'Bijan Robinson',
      position: 'RB',
      rosterDisplayName: 'Team Kyle',
      pickedAt: T(2),
      overall: 1,
      pickLabel: '1.01',
      round: 1,
      roundSlot: 1,
      playerId: 'x',
      nflTeam: 'ATL',
      headshotUrl: null,
      teamLogoUrl: null,
    },
  }),
  /* The old composer's `[GIF] <url>` row: the URL is the body and `mediaUrl`. */
  wire({ id: 'g1', text: 'https://media2.giphy.com/media/x/giphy.gif', at: T(3), messageType: 'gif', mediaUrl: 'https://media2.giphy.com/media/x/giphy.gif' }),
  /* Sent from league chat by the shared composer: GIF in metadata, "🎬 GIF" as the body. */
  wire({
    id: 'g2',
    from: 'Jo',
    senderUserId: 'jo',
    text: '🎬 GIF',
    at: T(4),
    metadata: { gif: { url: 'https://static.klipy.com/a.gif', previewUrl: 'https://static.klipy.com/a.gif', title: 'lol' } },
  }),
  wire({ id: 'i1', from: 'Jo', senderUserId: 'jo', text: '📎 Media', at: T(5), metadata: { attachments: [{ type: 'image', url: '/api/chat/upload?path=board.png' }] } }),
  /* The draft room's older poll shape: options as strings, votes by index. */
  wire({
    id: 'o1',
    text: 'Next pick?',
    at: T(6),
    messageType: 'poll',
    messageCategory: 'POLL_MESSAGE',
    metadata: { question: 'Next pick?', options: ['RB', 'WR'], votes: { '1': ['sam'] } },
  }),
  wire({
    id: 'o2',
    text: '📊 Trade up?',
    at: T(7),
    metadata: { poll: { question: 'Trade up?', options: [{ id: 'y', text: 'Yes', votes: [] }, { id: 'n', text: 'No', votes: [] }] } },
  }),
  /* The old `[IMAGE] <url>` row: type image, URL in mediaUrl. */
  wire({ id: 'i2', text: 'board', at: T(7), messageType: 'image', mediaUrl: 'https://cdn.test/old-board.png' }),
  wire({
    id: 'ai-copilot-onclock-1-Bijan',
    from: 'Draft copilot',
    text: 'On the clock: Bijan Robinson (RB, ATL). Best value on the board.',
    at: T(8),
    messageType: 'copilot_on_clock',
    messageCategory: 'AI_MESSAGE',
    isAiSuggestion: true,
    senderUserId: null,
  }),
]

let fetchMock: ReturnType<typeof vi.fn>
const calls = (pred: (url: string, init?: RequestInit) => boolean) =>
  fetchMock.mock.calls.filter(([u, init]) => pred(String(u), init as RequestInit | undefined))
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response
const bodyOf = (init: unknown) => JSON.parse(String((init as RequestInit).body))

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.startsWith('/api/chat/gifs')) {
      return json({
        gifs: [{ id: 'gif1', giphyId: 'gif1', url: 'https://media.giphy.com/media/w/giphy.gif', previewUrl: 'https://media.giphy.com/media/w/200.gif', title: 'win' }],
        provider: 'giphy',
        searchProvider: 'giphy',
      })
    }
    if (u.startsWith('/api/chat/emojis')) {
      return json({ emojis: [{ id: 'fire', char: '🔥', name: 'fire', category: 'symbols', keywords: [] }], categories: [], fantasy: ['fire'] })
    }
    if (u.startsWith('/api/leagues/L1/members/autocomplete')) {
      return json([{ username: 'jo', displayName: 'Jo', avatarUrl: null }])
    }
    if (u.startsWith('/api/app/leagues/L1/chat')) {
      return json({
        viewerUserId: 'me',
        presence: [],
        includeDraft: false,
        draft: { live: true, status: 'in_progress', href: '/league/L1/draft' },
        messages: [{ id: 'lc1', text: 'league side trash talk', createdAt: T(0), authorId: 'kim', authorName: 'Kim' }],
      })
    }
    if (u.includes('/pinned')) return json({ pinned: [] })
    if (u.includes('/typing')) return json({ typing: [] })
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

function renderPanel(over: Partial<React.ComponentProps<typeof DraftChatPanel>> = {}) {
  const onSend = vi.fn(async () => ({ id: 'new1' }))
  const onRefreshChat = vi.fn()
  const utils = render(
    <DraftChatPanel
      messages={MESSAGES}
      onSend={onSend}
      onRefreshChat={onRefreshChat}
      currentUserId="me"
      leagueId="L1"
      leagueName="Sunday Squad"
      onAiSuggestionClick={vi.fn()}
      {...over}
    />,
  )
  return { ...utils, onSend: (over.onSend as typeof onSend | undefined) ?? onSend, onRefreshChat }
}

function typeAndSend(text: string) {
  fireEvent.change(screen.getByTestId('draft-chat-input'), { target: { value: text, selectionStart: text.length } })
  fireEvent.click(screen.getByTestId('draft-chat-send'))
}

describe('the draft room shows the conversation', () => {
  it('draws text, your side and theirs, and the pick as a card', () => {
    renderPanel()
    expect(screen.getByText('RB run incoming')).toBeTruthy()
    expect(row('m2').getAttribute('data-mine')).toBe('true')
    expect(row('m1').getAttribute('data-mine')).toBe('false')
    const pick = within(row('p1')).getByTestId('draft-chat-pick-event')
    expect(within(pick).getByTestId('draft-chat-pick-drafter').textContent).toContain('Team Kyle')
    /* A pick is not somebody talking: no bubble, nothing to react to. */
    expect(within(row('p1')).queryByRole('article')).toBeNull()
  })

  it('renders a GIF from league chat as the GIF — not the words "🎬 GIF" — and the old [GIF] rows too, credited', () => {
    renderPanel()
    expect(within(row('g2')).getByAltText('lol').getAttribute('src')).toBe('https://static.klipy.com/a.gif')
    expect(within(row('g2')).getByText('via KLIPY')).toBeTruthy()
    expect(screen.queryByText('🎬 GIF')).toBeNull()
    expect(within(row('g1')).getByAltText('GIF').getAttribute('src')).toBe('https://media2.giphy.com/media/x/giphy.gif')
    expect(within(row('g1')).getByText('via GIPHY')).toBeTruthy()
  })

  it('shows a photo sent from league chat, and opens it full size', () => {
    renderPanel()
    fireEvent.click(within(row('i1')).getByRole('button', { name: 'Open image full size' }))
    expect(screen.getByRole('dialog', { name: 'Image' }).querySelector('img')!.getAttribute('src')).toBe('/api/chat/upload?path=board.png')
    expect(screen.queryByText('📎 Media')).toBeNull()
  })

  it('shows the old [IMAGE] rows as the photo', () => {
    renderPanel()
    expect(within(row('i2')).getByRole('button', { name: 'Open image full size' }).querySelector('img')!.getAttribute('src')).toBe(
      'https://cdn.test/old-board.png',
    )
  })

  it('draws the older draft poll and votes on it by index', async () => {
    const { onRefreshChat } = renderPanel()
    fireEvent.click(within(row('o1')).getByRole('button', { name: /^RB, 0 votes/ }))
    await waitFor(() => expect(calls((u) => u === '/api/leagues/L1/draft/chat/poll-vote')).toHaveLength(1))
    expect(bodyOf(calls((u) => u === '/api/leagues/L1/draft/chat/poll-vote')[0]![1])).toEqual({ messageId: 'o1', optionIndex: 0 })
    await waitFor(() => expect(onRefreshChat).toHaveBeenCalled())
  })

  it('votes on a composer poll through the league room', async () => {
    renderPanel()
    fireEvent.click(within(row('o2')).getByRole('button', { name: /^Yes, 0 votes/ }))
    await waitFor(() => expect(calls((u) => u.endsWith('league%3AL1/messages/o2/vote'))).toHaveLength(1))
    expect(bodyOf(calls((u) => u.endsWith('league%3AL1/messages/o2/vote'))[0]![1])).toEqual({ optionId: 'y' })
  })

  it("labels the copilot's note as yours alone and offers the helper", () => {
    renderPanel()
    const card = within(row('ai-copilot-onclock-1-Bijan')).getByTestId('draft-chat-copilot')
    expect(within(card).getByText('Only you see this')).toBeTruthy()
    expect(within(card).getByTestId('draft-chat-open-ai-helper')).toBeTruthy()
  })
})

describe('reactions', () => {
  it('taking your reaction back DELETEs it', async () => {
    renderPanel()
    fireEvent.click(within(row('m1')).getByRole('button', { name: /🔥/ }))
    await waitFor(() => expect(calls((u) => u.endsWith('/messages/m1/reactions'))).toHaveLength(1))
    expect(calls((u) => u.endsWith('/messages/m1/reactions'))[0]![1]!.method).toBe('DELETE')
  })

  it('a new reaction POSTs, from the full action sheet', async () => {
    renderPanel()
    fireEvent.keyDown(within(row('m2')).getByRole('article'), { key: 'Enter' })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'React 😂' }))
    await waitFor(() => expect(calls((u) => u.endsWith('/messages/m2/reactions'))).toHaveLength(1))
    expect(calls((u) => u.endsWith('/messages/m2/reactions'))[0]![1]!.method).toBe('POST')
  })
})

describe('the composer', () => {
  it('sends words, and announces an @mention to the league room', async () => {
    const { onSend } = renderPanel()
    typeAndSend('@jo you are on the clock')
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ text: '@jo you are on the clock' }))
    await waitFor(() => expect(calls((u) => u === '/api/shared/chat/mentions')).toHaveLength(1))
    expect(bodyOf(calls((u) => u === '/api/shared/chat/mentions')[0]![1])).toMatchObject({
      threadId: 'league:L1',
      messageId: 'new1',
      mentionedUsernames: ['jo'],
    })
  })

  it('offers the league’s members after @', async () => {
    renderPanel()
    const box = screen.getByTestId('draft-chat-input') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '@j', selectionStart: 2 } })
    fireEvent.keyUp(box, { key: 'j', target: { selectionStart: 2 } })
    expect(await screen.findByRole('button', { name: /@jo/ })).toBeTruthy()
    expect(calls((u) => u.startsWith('/api/leagues/L1/members/autocomplete')).length).toBeGreaterThan(0)
  })

  it('searches GIFs through our server and sends the pick in league chat’s shape', async () => {
    const { onSend } = renderPanel()
    fireEvent.click(screen.getByTestId('draft-chat-media-gif'))
    await waitFor(() => expect(document.querySelector('.af-chat-picker img')).toBeTruthy())
    expect(calls((u) => u.startsWith('/api/chat/gifs')).length).toBeGreaterThan(0)
    fireEvent.click(document.querySelector('.af-chat-picker img')!.closest('button')!)
    fireEvent.click(screen.getByTestId('draft-chat-send'))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    const payload = (onSend.mock.calls[0] as unknown[])[0] as { metadata: { gif: { url: string } } }
    expect(payload.metadata.gif.url).toBe('https://media.giphy.com/media/w/giphy.gif')
  })

  it('opens the full emoji picker and puts the emoji in the box', async () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('draft-chat-composer-emoji-toggle'))
    fireEvent.click(await screen.findByRole('button', { name: 'fire' }))
    expect((screen.getByTestId('draft-chat-input') as HTMLTextAreaElement).value).toBe('🔥')
  })

  it('replies with the message it answers', async () => {
    const { onSend } = renderPanel()
    fireEvent.keyDown(within(row('m1')).getByRole('article'), { key: 'Enter' })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Reply/ }))
    expect(screen.getByText('Replying to Sam')).toBeTruthy()
    typeAndSend('bold')
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ text: 'bold', parentMessageId: 'm1' }))
  })

  it('puts the message back when the send fails', async () => {
    const onSend = vi.fn(async () => {
      throw new Error('offline')
    })
    renderPanel({ onSend })
    typeAndSend('keep me')
    await waitFor(() => expect(onSend).toHaveBeenCalled())
    await waitFor(() => expect((screen.getByTestId('draft-chat-input') as HTMLTextAreaElement).value).toBe('keep me'))
  })

  it('uploads a dropped photo against the league', async () => {
    renderPanel()
    const file = new File(['x'], 'board.png', { type: 'image/png' })
    const convo = document.querySelector('.af-cm-convo')!
    fireEvent.drop(convo, { dataTransfer: { types: ['Files'], files: [file] } })
    await waitFor(() => expect(calls((u) => u === '/api/chat/upload')).toHaveLength(1))
    const fd = calls((u) => u === '/api/chat/upload')[0]![1]!.body as FormData
    expect(fd.get('leagueId')).toBe('L1')
  })
})

describe('your own messages', () => {
  it('edits and deletes through the league room, then refreshes', async () => {
    const { onRefreshChat } = renderPanel()
    fireEvent.keyDown(within(row('m2')).getByRole('article'), { key: 'Enter' })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Edit/ }))
    fireEvent.change(screen.getByLabelText('Edit your message'), { target: { value: 'taking the best RB' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls((u, i) => u.endsWith('league%3AL1/messages/m2') && i?.method === 'PATCH')).toHaveLength(1))
    await waitFor(() => expect(onRefreshChat).toHaveBeenCalled())

    fireEvent.keyDown(within(row('m2')).getByRole('article'), { key: 'Enter' })
    const sheet = screen.getByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: /Delete/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls((u, i) => u.endsWith('league%3AL1/messages/m2') && i?.method === 'DELETE')).toHaveLength(1))
  })

  it('copies your own message', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel()
    fireEvent.keyDown(within(row('m2')).getByRole('article'), { key: 'Enter' })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Copy your message/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('taking the best QB'))
  })
})

describe('linked to the league chat', () => {
  it('with sync off, opens the league’s own chat from the draft room', async () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('draft-chat-view-league'))
    expect(await screen.findByText('league side trash talk')).toBeTruthy()
    const get = calls((u) => u.startsWith('/api/app/leagues/L1/chat?'))[0]![0] as string
    /* Inside the draft room the league view leaves the draft room's own messages out — they are one tap away. */
    expect(get).toContain('includeDraft=0')
    /* ...and does not advertise the room you are already in. */
    expect(screen.queryByTestId('league-chat-open-draft-room')).toBeNull()
  })

  it('with sync on, says it is one conversation and offers no switch', () => {
    renderPanel({ leagueChatSync: true })
    expect(screen.getByTestId('draft-chat-sync-badge').textContent).toContain('Linked to league chat')
    expect(screen.queryByTestId('draft-chat-view-league')).toBeNull()
  })
})

describe('fits the draft room dock', () => {
  it('pops out of the short dock into a tall panel, and docks back', () => {
    renderPanel()
    const panel = screen.getByTestId('draft-chat-panel')
    const pop = screen.getByTestId('draft-chat-popout')
    expect(panel.getAttribute('data-popped')).toBe('false')
    expect(pop.getAttribute('aria-label')).toBe('Pop out the chat')
    fireEvent.click(pop)
    expect(panel.getAttribute('data-popped')).toBe('true')
    expect(panel.className).toContain('md:fixed')
    expect(pop.getAttribute('aria-pressed')).toBe('true')
    expect(pop.getAttribute('aria-label')).toBe('Dock the chat')
    fireEvent.click(pop)
    expect(panel.getAttribute('data-popped')).toBe('false')
    expect(panel.className).not.toContain('md:fixed')
  })

  it("keeps the box clear of the War Room's corner button while docked, not when popped out", () => {
    renderPanel()
    const box = () => screen.getByTestId('draft-chat-input').closest('.af-dc-composer') as HTMLElement
    expect(box().getAttribute('data-fab-corner')).toBe('true')
    fireEvent.click(screen.getByTestId('draft-chat-popout'))
    expect(box().hasAttribute('data-fab-corner')).toBe(false)
  })

  it('opens the emoji picker over the page when the dock is too short to hold it', async () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('draft-chat-composer-emoji-toggle'))
    const floating = await screen.findByTestId('chat-composer-floating-picker')
    expect(screen.getByTestId('draft-chat-panel').contains(floating)).toBe(false)
    fireEvent.click(await within(floating).findByRole('button', { name: 'fire' }))
    expect((screen.getByTestId('draft-chat-input') as HTMLTextAreaElement).value).toContain('🔥')
  })

  it('explains what the room is linked to, in one line', () => {
    renderPanel()
    expect(screen.getByTestId('draft-chat-subtitle').textContent).toMatch(/League chat shows it too/)
    renderPanel({ leagueChatSync: true })
    expect(screen.getAllByTestId('draft-chat-subtitle')[1]!.textContent).toMatch(/lands in league chat/)
  })
})
