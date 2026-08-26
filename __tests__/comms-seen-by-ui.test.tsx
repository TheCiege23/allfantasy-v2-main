import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeenBy } from '@/components/core-app/comms/SeenBy'

const SENT = '2026-08-26T12:00:00.000Z'

function msg(over: Record<string, unknown> = {}) {
  return { id: 'm1', senderUserId: 'me', createdAt: SENT, ...over }
}

function receipt(over: Record<string, unknown> = {}) {
  return {
    userId: 'u2',
    displayName: 'Jordan',
    username: 'jordan',
    lastReadAt: '2026-08-26T12:05:00.000Z',
    ...over,
  }
}

describe('SeenBy', () => {
  it('names who has read the last thing you said', () => {
    render(<SeenBy messages={[msg()]} receipts={[receipt()]} viewerUserId="me" />)
    expect(screen.getByText('Seen by Jordan')).toBeTruthy()
  })

  it('says nothing when nobody has read it yet', () => {
    render(
      <SeenBy
        messages={[msg()]}
        receipts={[receipt({ lastReadAt: '2026-08-26T11:00:00.000Z' })]}
        viewerUserId="me"
      />,
    )
    expect(screen.queryByText(/Seen by/)).toBeNull()
  })

  /*
   * A member with no lastReadAt has never opened the thread on a build that
   * recorded it. That is absence of evidence, not evidence they ignored you —
   * and this is a room where people negotiate trades.
   */
  it('never treats a missing receipt as unread', () => {
    render(<SeenBy messages={[msg()]} receipts={[receipt({ lastReadAt: null })]} viewerUserId="me" />)
    expect(screen.queryByText(/Seen by/)).toBeNull()
    expect(screen.queryByText(/not read|unread/i)).toBeNull()
  })

  it('does not count your own read of your own message', () => {
    render(<SeenBy messages={[msg()]} receipts={[receipt({ userId: 'me' })]} viewerUserId="me" />)
    expect(screen.queryByText(/Seen by/)).toBeNull()
  })

  it('joins two readers and summarises more', () => {
    const many = [
      receipt({ userId: 'a', displayName: 'Ana' }),
      receipt({ userId: 'b', displayName: 'Ben' }),
      receipt({ userId: 'c', displayName: 'Cal' }),
    ]
    render(<SeenBy messages={[msg()]} receipts={many} viewerUserId="me" />)
    expect(screen.getByText('Seen by Ana, Ben +1')).toBeTruthy()
  })

  /* Marking every message would be a column of noise down the thread. */
  it('reports only the most recent message you sent', () => {
    const messages = [
      msg({ id: 'old', createdAt: '2026-08-26T09:00:00.000Z' }),
      msg({ id: 'new', createdAt: '2026-08-26T13:00:00.000Z' }),
    ]
    render(
      <SeenBy
        messages={messages}
        receipts={[receipt({ lastReadAt: '2026-08-26T12:30:00.000Z' })]}
        viewerUserId="me"
      />,
    )
    /* Read after the old one but before the new one: nothing to report. */
    expect(screen.queryByText(/Seen by/)).toBeNull()
  })

  it('renders nothing without messages or receipts', () => {
    const { container } = render(<SeenBy messages={[]} receipts={[receipt()]} viewerUserId="me" />)
    expect(container.textContent).toBe('')
  })

  it('falls back to a username when there is no display name', () => {
    render(
      <SeenBy messages={[msg()]} receipts={[receipt({ displayName: null })]} viewerUserId="me" />,
    )
    expect(screen.getByText('Seen by jordan')).toBeTruthy()
  })
})
