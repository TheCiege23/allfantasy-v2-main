/**
 * Chimmy's answers in league chat used to print their Markdown raw — "**Fill the seats:**" in a private
 * @chimmy answer, and in the copy "Share with league" posts to everyone (found live 2026-11-17). Chimmy's
 * rows now use the drawer's renderer; everybody else's messages are untouched.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ChatMessageList, type ChatListMessage } from '@/components/core-app/comms/ChatMessageList'

const ANSWER = [
  'Biggest thing: fill the league first.',
  '',
  '- **Fill the seats:** 11 of 12 teams are open.',
  '- **Scoring to know:** full PPR (1 point per catch).',
  '',
  'Confidence: medium.',
].join('\n')

function msg(over: Partial<ChatListMessage> & { id: string }): ChatListMessage {
  return {
    authorId: 'owner',
    authorName: 'Chimmy',
    avatarUrl: null,
    body: ANSWER,
    createdAt: '2026-11-17T15:57:00.000Z',
    parentMessageId: null,
    metadata: null,
    messageType: 'text',
    ...over,
  }
}

function bubbleOf(m: ChatListMessage) {
  const { container } = render(
    <ChatMessageList
      messages={[m]}
      viewerId="me"
      label="League chat"
      reactionsFor={() => []}
      onToggleReaction={vi.fn()}
      onReply={vi.fn()}
      renderRich={() => null}
      nameForUserId={() => null}
    />,
  )
  return container.querySelector('.af-cm-bubble-text') as HTMLElement
}

describe("Chimmy's answers in league chat", () => {
  it('a private @chimmy answer is formatted: bold labels, a list, no ** left', () => {
    const el = bubbleOf(msg({ id: 'p', metadata: { chimmyPrivateReply: true } }))
    expect(el.getAttribute('data-rich')).toBe('true')
    expect([...el.querySelectorAll('strong')].map((s) => s.textContent)).toEqual(['Fill the seats:', 'Scoring to know:'])
    expect(el.querySelectorAll('li')).toHaveLength(2)
    expect(el.textContent).not.toContain('**')
    expect(el.textContent).toContain('Confidence: medium.')
  })

  it('the shared copy the whole league sees is formatted the same way', () => {
    const el = bubbleOf(msg({ id: 's', metadata: { chimmy: true, sharedFromReplyId: 'p' } }))
    expect(el.querySelectorAll('strong')).toHaveLength(2)
    expect(el.textContent).not.toContain('**')
  })

  it('🛑 a member\'s message is never formatted, even one named "Chimmy"', () => {
    const el = bubbleOf(msg({ id: 'm', authorId: 'sam', authorName: 'Chimmy', metadata: null }))
    expect(el.getAttribute('data-rich')).toBeNull()
    expect(el.querySelectorAll('strong')).toHaveLength(0)
    expect(el.textContent).toContain('**Fill the seats:**')
  })

  it('no HTML from the answer reaches the page', () => {
    const el = bubbleOf(msg({ id: 'x', metadata: { chimmyPrivateReply: true }, body: '**hi** <img src=x onerror=alert(1)> [click](javascript:alert(1))' }))
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('a')).toBeNull()
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
