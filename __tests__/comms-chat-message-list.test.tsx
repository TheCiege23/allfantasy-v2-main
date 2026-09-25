import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ChatMessageList, copyableText, type ChatListMessage } from '@/components/core-app/comms/ChatMessageList'
import { readReactions } from '@/lib/chat-core/messageReactions'

/*
 * League, DM and Huddle messages as a conversation: your side / their side,
 * avatars, one name per run, per-message actions from long-press, right-click or
 * the keyboard, copy with feedback, who reacted, and "N new" when you have
 * scrolled up.
 */

const T = (min: number) => new Date(Date.UTC(2026, 8, 25, 14, min)).toISOString()

function msg(over: Partial<ChatListMessage> & { id: string }): ChatListMessage {
  return {
    authorId: 'sam',
    authorName: 'Sam Darnold',
    avatarUrl: null,
    body: 'hello',
    createdAt: T(0),
    parentMessageId: null,
    metadata: null,
    messageType: 'text',
    ...over,
  }
}

function renderList(messages: ChatListMessage[], over: Partial<React.ComponentProps<typeof ChatMessageList>> = {}) {
  const props: React.ComponentProps<typeof ChatMessageList> = {
    messages,
    viewerId: 'me',
    label: 'League chat',
    reactionsFor: (m) => readReactions(m.metadata, 'me'),
    onToggleReaction: vi.fn(),
    onReply: vi.fn(),
    renderRich: () => null,
    nameForUserId: (id) => ({ sam: 'Sam Darnold', jo: 'Jo' } as Record<string, string>)[id] ?? null,
    ...over,
  }
  const utils = render(<ChatMessageList {...props} />)
  return { ...utils, props }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('sides, avatars and runs', () => {
  it('puts yours on the right and theirs on the left with an avatar', () => {
    const { container } = renderList([
      msg({ id: 'a', avatarUrl: 'https://cdn.test/sam.png' }),
      msg({ id: 'b', authorId: 'me', authorName: 'Me', createdAt: T(1) }),
    ])
    const rows = container.querySelectorAll('.af-cm-row')
    expect(rows[0]!.getAttribute('data-mine')).toBe('false')
    expect(rows[1]!.getAttribute('data-mine')).toBe('true')
    expect(rows[0]!.querySelector('.af-cm-avatar img')!.getAttribute('src')).toBe('https://cdn.test/sam.png')
    // Your own messages carry no avatar and no name.
    expect(rows[1]!.querySelector('.af-cm-avatar')).toBeNull()
    expect(within(rows[1] as HTMLElement).queryByText('Me')).toBeNull()
  })

  it('falls back to initials when there is no usable avatar', () => {
    const { container } = renderList([msg({ id: 'a', avatarUrl: 'javascript:alert(1)' })])
    expect(container.querySelector('.af-cm-avatar img')).toBeNull()
    expect(container.querySelector('.af-cm-avatar-initials')!.textContent).toBe('SD')
  })

  it('names the sender once per run, not once per message', () => {
    renderList([
      msg({ id: 'a', body: 'one' }),
      msg({ id: 'b', body: 'two', createdAt: T(1) }),
      msg({ id: 'c', body: 'three', createdAt: T(2) }),
    ])
    expect(screen.getAllByText('Sam Darnold')).toHaveLength(1)
  })

  it('puts a day separator above the conversation', () => {
    renderList([msg({ id: 'a' })])
    expect(screen.getByRole('separator')).toBeTruthy()
  })

  it('shows a deleted message as a tombstone, with none of its GIF or reactions', () => {
    const renderRich = vi.fn(() => <span>RICH</span>)
    renderList(
      [
        msg({
          id: 'a',
          body: '[message deleted]',
          metadata: { deletedAt: T(3), gifUrl: 'https://static.klipy.com/a.gif', reactions: [{ emoji: '🔥', userIds: ['u1'] }] },
        }),
      ],
      { renderRich },
    )
    expect(screen.getByText('Message deleted')).toBeTruthy()
    expect(screen.queryByText('[message deleted]')).toBeNull()
    expect(screen.queryByText('RICH')).toBeNull()
    expect(screen.queryByRole('button', { name: /🔥/ })).toBeNull()
  })
})

describe('message actions', () => {
  it('opens from the keyboard — Enter on a focused message', () => {
    renderList([msg({ id: 'a' })])
    const bubble = screen.getByRole('article')
    fireEvent.keyDown(bubble, { key: 'Enter' })
    expect(screen.getByRole('dialog', { name: /Sam Darnold's message/ })).toBeTruthy()
  })

  it('opens on right-click (and Android’s long-press, which fires contextmenu)', () => {
    renderList([msg({ id: 'a' })])
    fireEvent.contextMenu(screen.getByRole('article'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('opens on a touch long-press, and the tap that ends it does not also toggle the time', () => {
    vi.useFakeTimers()
    renderList([msg({ id: 'a' })])
    const bubble = screen.getByRole('article')
    fireEvent.pointerDown(bubble, { pointerType: 'touch', clientX: 10, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('does not open when the finger moves — that was a scroll', () => {
    vi.useFakeTimers()
    renderList([msg({ id: 'a' })])
    const bubble = screen.getByRole('article')
    fireEvent.pointerDown(bubble, { pointerType: 'touch', clientX: 10, clientY: 10 })
    fireEvent.pointerMove(bubble, { pointerType: 'touch', clientX: 10, clientY: 60 })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reacts with a quick emoji from the sheet', () => {
    const { props } = renderList([msg({ id: 'a' })])
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'React 😂' }))
    expect(props.onToggleReaction).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), '😂')
  })

  it('replies from the sheet', () => {
    const { props } = renderList([msg({ id: 'a' })])
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /Reply/ }))
    expect(props.onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('copies someone else’s message and says "Copied"', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderList([msg({ id: 'a', body: 'trade you Bijan' })])
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy text/ }))
    })
    expect(writeText).toHaveBeenCalledWith('trade you Bijan')
    expect(screen.getByRole('status').textContent).toBe('Copied')
  })

  it('copies your OWN message too — the button says so', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderList([msg({ id: 'a', authorId: 'me', authorName: 'Me', body: 'my hot take' })])
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy your message' }))
    })
    expect(writeText).toHaveBeenCalledWith('my hot take')
  })

  it('offers pin only where the panel supports it, and edit / delete only on your own', () => {
    const onPin = vi.fn()
    renderList(
      [msg({ id: 'a' }), msg({ id: 'b', authorId: 'me', authorName: 'Me', createdAt: T(1) })],
      { onPin, onEdit: vi.fn(async () => {}), onDelete: vi.fn(async () => {}) },
    )
    const [theirs, mine] = screen.getAllByRole('article')
    fireEvent.keyDown(theirs!, { key: 'Enter' })
    expect(screen.getByRole('button', { name: /Pin for the league/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.keyDown(mine!, { key: 'Enter' })
    expect(screen.getByRole('button', { name: /Edit/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Delete/ })).toBeTruthy()
  })

  it('asks before deleting, then deletes', async () => {
    const onDelete = vi.fn(async () => {})
    renderList([msg({ id: 'b', authorId: 'me', authorName: 'Me' })], { onDelete })
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByText('Delete for everyone?')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
  })

  it('edits in place and saves the new text', async () => {
    const onEdit = vi.fn(async () => {})
    renderList([msg({ id: 'b', authorId: 'me', authorName: 'Me', body: 'teh typo' })], { onEdit })
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    const box = screen.getByRole('textbox', { name: 'Edit your message' })
    fireEvent.change(box, { target: { value: 'the typo' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }), 'the typo')
  })
})

describe('who reacted', () => {
  const reacted = msg({
    id: 'a',
    metadata: { reactions: [{ emoji: '🔥', count: 3, userIds: ['me', 'jo', 'stranger'] }] },
  })

  it('names them on the chip, without leaking an id', () => {
    renderList([reacted])
    const chip = screen.getByRole('button', { name: '🔥 3, including you' })
    expect(chip.getAttribute('title')).toBe('You, Jo and 1 other')
  })

  it('lists them in the sheet', () => {
    renderList([reacted])
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' })
    expect(screen.getByText(/You, Jo and 1 other/)).toBeTruthy()
    expect(screen.queryByText(/stranger/)).toBeNull()
  })

  it('still toggles on a plain tap', () => {
    const { props } = renderList([reacted])
    fireEvent.click(screen.getByRole('button', { name: '🔥 3, including you' }))
    expect(props.onToggleReaction).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), '🔥')
  })
})

describe('jump to latest', () => {
  it('counts new messages while you are scrolled up, instead of yanking you down', () => {
    const first = [msg({ id: 'a' }), msg({ id: 'b', createdAt: T(1) })]
    const { rerender, props } = renderList(first)
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(log, 'clientHeight', { value: 400, configurable: true })
    log.scrollTop = 200
    fireEvent.scroll(log)

    rerender(
      <ChatMessageList
        {...props}
        messages={[...first, msg({ id: 'c', authorId: 'jo', authorName: 'Jo', createdAt: T(2) })]}
      />,
    )
    const jump = screen.getByRole('button', { name: 'Jump to latest, 1 new' })
    expect(jump).toBeTruthy()
    expect(log.scrollTop).toBe(200)
  })

  it('follows the conversation when you are already at the bottom', () => {
    const first = [msg({ id: 'a' })]
    const { rerender, props } = renderList(first)
    rerender(<ChatMessageList {...props} messages={[...first, msg({ id: 'b', createdAt: T(1) })]} />)
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull()
  })
})

describe('copyableText', () => {
  it('copies a GIF’s link when there are no words', () => {
    expect(
      copyableText(msg({ id: 'g', body: '🎬 GIF', metadata: { gif: { url: 'https://static.klipy.com/a.gif' } } }), false, true),
    ).toBe('https://static.klipy.com/a.gif')
  })

  it('returns null when there is nothing to copy', () => {
    expect(copyableText(msg({ id: 'p', body: '📎 Media' }), false, true)).toBeNull()
  })
})
