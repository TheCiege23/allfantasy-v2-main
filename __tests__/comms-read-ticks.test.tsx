import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThreadListRow, type ThreadRowThread } from '@/components/core-app/comms/ThreadListRow'
import { SeenBy } from '@/components/core-app/comms/SeenBy'

/*
 * "Can we add a 'read' check mark so the user knows if it's been seen or not" (owner, 2026-10-02).
 *
 * ✓ = sent, ✓✓ = seen — ONLY on your own last message. One tick is a fact about the message (it is
 * saved and in their thread), never a claim that somebody ignored you.
 */

const NOW = new Date('2026-10-02T21:00:00Z')

function row(context: ThreadRowThread['context']): ThreadRowThread {
  return {
    id: 't1',
    threadType: 'dm',
    title: 'Matt Jones',
    lastMessageAt: '2026-10-02T12:00:00Z',
    unreadCount: 0,
    memberCount: 2,
    context: { members: [{ id: 'u2', name: 'Matt Jones', avatarUrl: null }], ...context },
  }
}

function ticksIn(container: HTMLElement) {
  return container.querySelector('.af-cm-ticks')
}

describe('the DM list row', () => {
  it('one tick — "Sent" — on your own message nobody has opened yet', () => {
    const { container } = render(
      <ThreadListRow thread={row({ lastMessagePreview: 'Sup!', lastMessageMine: true, lastMessageSeen: false })} now={NOW} onOpen={() => {}} />,
    )
    const ticks = ticksIn(container)!
    expect(ticks).toBeTruthy()
    expect(ticks.getAttribute('data-seen')).toBeNull()
    expect(ticks.querySelectorAll('path')).toHaveLength(1)
    expect(screen.getByText('Sent')).toBeTruthy()
    expect(screen.getByText('You: Sup!')).toBeTruthy()
  })

  it('two ticks — "Seen" — once they have', () => {
    const { container } = render(
      <ThreadListRow thread={row({ lastMessagePreview: 'Sup!', lastMessageMine: true, lastMessageSeen: true })} now={NOW} onOpen={() => {}} />,
    )
    const ticks = ticksIn(container)!
    expect(ticks.getAttribute('data-seen')).toBe('true')
    expect(ticks.querySelectorAll('path')).toHaveLength(2)
    expect(screen.getByText('Seen')).toBeTruthy()
  })

  it('no ticks on THEIR message, and none on an empty conversation', () => {
    const theirs = render(
      <ThreadListRow thread={row({ lastMessagePreview: 'yo', lastMessageMine: false, lastMessageSeen: true })} now={NOW} onOpen={() => {}} />,
    )
    expect(ticksIn(theirs.container)).toBeNull()
    theirs.unmount()

    const empty = render(<ThreadListRow thread={row({ lastMessagePreview: '  ', lastMessageMine: true })} now={NOW} onOpen={() => {}} />)
    expect(ticksIn(empty.container)).toBeNull()
  })
})

describe('the open conversation', () => {
  const sent = { id: 'm1', senderUserId: 'me', createdAt: '2026-10-02T12:00:00Z' }

  it('says "Sent" with one tick until they open it — and still names nobody', () => {
    const { container } = render(
      <SeenBy
        messages={[sent]}
        receipts={[{ userId: 'u2', displayName: 'Matt', username: 'matt', lastReadAt: '2026-10-02T11:00:00Z' }]}
        viewerUserId="me"
      />,
    )
    expect(screen.getByText('Sent')).toBeTruthy()
    expect(container.textContent).not.toMatch(/Matt|unread|not read/i)
    expect(container.querySelectorAll('.af-cm-ticks path')).toHaveLength(1)
  })

  it('says "Seen by Matt" with two ticks once they have', () => {
    const { container } = render(
      <SeenBy
        messages={[sent]}
        receipts={[{ userId: 'u2', displayName: 'Matt', username: 'matt', lastReadAt: '2026-10-02T12:01:00Z' }]}
        viewerUserId="me"
      />,
    )
    expect(screen.getByText('Seen by Matt')).toBeTruthy()
    expect(container.querySelectorAll('.af-cm-ticks path')).toHaveLength(2)
    // The visible label already says it; the ticks add no second announcement.
    expect(container.querySelector('.af-cm-sr')).toBeNull()
  })

  it('stays silent until receipts have loaded, rather than flashing "Sent"', () => {
    const { container } = render(<SeenBy messages={[sent]} receipts={[]} viewerUserId="me" />)
    expect(container.textContent).toBe('')
  })
})
