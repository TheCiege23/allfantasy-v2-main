import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ChatMessageList, type ChatListMessage } from '@/components/core-app/comms/ChatMessageList'
import { TypingNote } from '@/components/core-app/comms/TypingNote'
import { readReactions } from '@/lib/chat-core/messageReactions'

/*
 * Visual pass 3: a reply's quote sits inside its bubble (and still jumps to the original), and
 * "is typing…" carries decorative dots without changing what is read out.
 */

const T = (min: number) => new Date(Date.UTC(2026, 9, 12, 14, min)).toISOString()

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

function renderList(messages: ChatListMessage[]) {
  return render(
    <ChatMessageList
      messages={messages}
      viewerId="me"
      label="League chat"
      reactionsFor={(m) => readReactions(m.metadata, 'me')}
      onToggleReaction={vi.fn()}
      onReply={vi.fn()}
      renderRich={() => null}
      nameForUserId={() => null}
    />,
  )
}

describe('a reply quote lives inside the bubble', () => {
  it('draws the quote inside the replying bubble, not above it', () => {
    const { container } = renderList([
      msg({ id: 'a', body: 'who wants my RB1' }),
      msg({ id: 'b', authorId: 'me', authorName: 'Me', body: 'me', parentMessageId: 'a', createdAt: T(1) }),
    ])
    const row = container.querySelector('[data-message-id="b"]')!
    const quote = row.querySelector('.af-cm-quote')!
    expect(quote).toBeTruthy()
    expect(quote.parentElement!.classList.contains('af-cm-bubble')).toBe(true)
    expect(quote.textContent).toContain('who wants my RB1')
  })

  it('still says so when the original is outside the loaded window', () => {
    const { container } = renderList([msg({ id: 'b', parentMessageId: 'gone' })])
    const quote = container.querySelector('[data-message-id="b"] .af-cm-bubble > .af-cm-quote')!
    expect(quote.textContent).toBe('Replying to an earlier message')
  })

  it('a tap on the quote jumps to the original rather than toggling the time', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { container } = renderList([
      msg({ id: 'a', body: 'original' }),
      msg({ id: 'b', authorId: 'jo', authorName: 'Jo', body: 'reply', parentMessageId: 'a', createdAt: T(1) }),
    ])
    const jump = container.querySelector('[data-message-id="b"] .af-cm-quote-jump') as HTMLButtonElement
    fireEvent.click(jump)
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('a deleted reply shows no quote', () => {
    const { container } = renderList([
      msg({ id: 'a', body: 'original' }),
      msg({ id: 'b', parentMessageId: 'a', metadata: { deletedAt: T(2) }, createdAt: T(1) }),
    ])
    expect(container.querySelector('[data-message-id="b"] .af-cm-quote')).toBeNull()
  })
})

describe('the typing indicator', () => {
  it('renders nothing when nobody is typing', () => {
    const { container } = render(<TypingNote typing={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('reads the words, and the dots are hidden from assistive tech', () => {
    const { container } = render(<TypingNote typing={[{ name: 'Jo' }]} />)
    expect(screen.getByText('Jo is typing…')).toBeTruthy()
    const dots = container.querySelector('.af-cm-typing-dots')!
    expect(dots.getAttribute('aria-hidden')).toBe('true')
    expect(dots.children).toHaveLength(3)
    expect(screen.getByRole('status').textContent).toBe('Jo is typing…')
  })

  it('counts several people', () => {
    render(<TypingNote typing={[{ name: 'Jo' }, { name: 'Sam' }]} />)
    expect(screen.getByText('2 people are typing…')).toBeTruthy()
  })
})
