import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * E2 (hands-on chat test, 2026-09-25): a DM whose message read FAILED rendered "No messages yet." —
 * the empty state — with the error tucked underneath it. Read as "nobody has written here", which
 * is false and invites a first message into a conversation that already has history. A failed read
 * now replaces the empty state with the error and a Try again; an empty thread keeps its welcome.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

import ThreadPanel from '@/components/core-app/comms/ThreadPanel'

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

let messagesReply: () => Response
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url)
    if (u === '/api/shared/chat/threads') {
      return json({ threads: [{ id: 't1', threadType: 'dm', title: 'Jordan', lastMessageAt: null, unreadCount: 0, memberCount: 2 }] })
    }
    if (u.startsWith('/api/shared/chat/threads/t1/messages')) return messagesReply()
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const messageReads = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/shared/chat/threads/t1/messages'))

async function openJordan() {
  render(<ThreadPanel kind="dm" privacy="private" />)
  fireEvent.click(await screen.findByRole('button', { name: /Jordan/ }))
}

describe('DM read failure', () => {
  it('shows the error and Try again in place of "No messages yet."', async () => {
    messagesReply = () => json({ error: 'Messages are temporarily unavailable. Try again in a moment.' }, 503)
    await openJordan()

    expect(await screen.findByText('Messages are temporarily unavailable. Try again in a moment.')).toBeTruthy()
    expect(screen.queryByText('No messages yet.')).toBeNull()

    messagesReply = () =>
      json({ messages: [{ id: 'd1', senderUserId: 'jordan', senderName: 'Jordan', body: 'u up', createdAt: new Date().toISOString(), messageType: 'text' }] })
    const before = messageReads().length
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('u up')).toBeTruthy()
    expect(messageReads().length).toBeGreaterThan(before)
    await waitFor(() => expect(screen.queryByText('Messages are temporarily unavailable. Try again in a moment.')).toBeNull())
  })

  it('a thread nobody has written in still gets its welcome, and no error', async () => {
    messagesReply = () => json({ messages: [] })
    await openJordan()
    expect(await screen.findByText('No messages yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })
})
