import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ChatMessageList, type ChatListMessage } from '@/components/core-app/comms/ChatMessageList'
import { readReactions } from '@/lib/chat-core/messageReactions'

/*
 * The three things the draft room and the league page needed from the shared list:
 *   - a row that is not somebody talking (a draft pick) drawn as a card, with no actions;
 *   - a label over a bubble ("Draft room");
 *   - a rich shape RichMessage does not know still reaching the surface's renderer.
 */

const T = (min: number) => new Date(Date.UTC(2026, 8, 25, 14, min)).toISOString()
const msg = (over: Partial<ChatListMessage> & { id: string }): ChatListMessage => ({
  authorId: 'sam',
  authorName: 'Sam',
  avatarUrl: null,
  body: 'hello',
  createdAt: T(0),
  parentMessageId: null,
  metadata: null,
  messageType: 'text',
  ...over,
})

function renderList(messages: ChatListMessage[], over: Partial<React.ComponentProps<typeof ChatMessageList>> = {}) {
  return render(
    <ChatMessageList
      messages={messages}
      viewerId="me"
      label="Chat"
      reactionsFor={(m) => readReactions(m.metadata, 'me')}
      onToggleReaction={vi.fn()}
      onReply={vi.fn()}
      renderRich={() => null}
      nameForUserId={() => null}
      {...over}
    />,
  )
}

describe('ChatMessageList — system rows, tags and custom rich content', () => {
  it('draws a system row as its card, with no bubble and no actions', () => {
    const { container } = renderList([msg({ id: 'p1', authorId: null, body: '' }), msg({ id: 'a', createdAt: T(1) })], {
      renderSystem: (m) => (m.id === 'p1' ? <div data-testid="pick-card">Pick 1.01</div> : null),
    })
    const pick = container.querySelector('[data-message-id="p1"]') as HTMLElement
    expect(within(pick).getByTestId('pick-card')).toBeTruthy()
    expect(pick.getAttribute('data-system')).toBe('true')
    expect(within(pick).queryByRole('article')).toBeNull()
    /* The ordinary message beside it is untouched. */
    expect(within(container.querySelector('[data-message-id="a"]') as HTMLElement).getByRole('article')).toBeTruthy()
  })

  it('labels a bubble', () => {
    const { container } = renderList([msg({ id: 'a' }), msg({ id: 'b', createdAt: T(1) })], {
      tagFor: (m) => (m.id === 'b' ? 'Draft room' : null),
    })
    expect(within(container.querySelector('[data-message-id="b"]') as HTMLElement).getByText('Draft room')).toBeTruthy()
    expect(within(container.querySelector('[data-message-id="a"]') as HTMLElement).queryByText('Draft room')).toBeNull()
  })

  it('asks the surface’s renderer when it says a message is rich', () => {
    const renderRich = vi.fn(() => <div data-testid="custom-rich" />)
    renderList([msg({ id: 'o1', messageType: 'poll', metadata: { question: 'Q', options: ['a', 'b'] } })], {
      renderRich,
      hasRichFor: (m) => m.messageType === 'poll',
    })
    expect(screen.getByTestId('custom-rich')).toBeTruthy()
  })

  it('names its scroller when asked, for specs that find it by test id', () => {
    renderList([msg({ id: 'a' })], { scrollTestId: 'draft-chat-scroll-root' })
    expect(screen.getByTestId('draft-chat-scroll-root').getAttribute('role')).toBe('log')
  })

  it('copies a system-free message as before', () => {
    const { container } = renderList([msg({ id: 'a' })])
    fireEvent.keyDown(within(container.querySelector('[data-message-id="a"]') as HTMLElement).getByRole('article'), { key: 'Enter' })
    expect(screen.getByRole('button', { name: /Copy text/ })).toBeTruthy()
  })
})
