/**
 * Report and Block in the three chats that do not use ChatMessageList — the app/draft shell's
 * chat, the mock draft simulator's chat and bracket pool chat (App Store guideline 1.2).
 * Driven through the REAL panels and the shared MessageModerationMenu, asserting the wire.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('@/hooks/useUserTimezone', () => ({
  useUserTimezone: () => ({ formatDateInTimezone: () => '2026-09-29', formatInTimezone: () => '2:00 AM' }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/league/L1',
  useSearchParams: () => new URLSearchParams(),
}))

import { MessageModerationMenu } from '@/components/moderation/MessageModerationMenu'
import { DraftChatPanel } from '@/app/draft/components/DraftChatPanel'
import { MockDraftChatPanel } from '@/components/mock-draft/MockDraftChatPanel'
import { PoolChat } from '@/components/bracket/PoolChat'
import { LeagueChatInPanel } from '@/app/dashboard/components/LeagueChatInPanel'

type Call = { url: string; init?: RequestInit }
let calls: Call[] = []
let routes: Record<string, unknown> = {}

beforeEach(() => {
  calls = []
  routes = {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      const key = Object.keys(routes).find((k) => url.startsWith(k) && (!init?.method || init.method === 'GET'))
      return new Response(JSON.stringify(key ? routes[key] : {}), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const bodyOf = (c: Call) => JSON.parse(String(c.init?.body ?? '{}'))
const posted = (url: string) => calls.find((c) => c.url === url && c.init?.method === 'POST')

async function report(nameInLabel: string, reasonLabel = 'Hate speech') {
  fireEvent.click(await screen.findByRole('button', { name: `Message options for ${nameInLabel}` }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByText('Report message'))
  fireEvent.click(within(dialog).getByLabelText(reasonLabel))
  fireEvent.click(within(dialog).getByText('Send report'))
  await waitFor(() => expect(posted('/api/shared/chat/report/message')).toBeTruthy())
}

async function block(nameInLabel: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Message options for ${nameInLabel}` }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByText(`Block ${nameInLabel}`))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Block' }))
  await waitFor(() => expect(posted('/api/shared/chat/block')).toBeTruthy())
}

describe('MessageModerationMenu', () => {
  it('offers nothing on your own message, or on one with no author', () => {
    render(
      <>
        <MessageModerationMenu threadId="t" messageId="a" authorId="me" authorName="Me" viewerId="me" />
        <MessageModerationMenu threadId="t" messageId="b" authorId={null} authorName="System" viewerId="me" />
        <MessageModerationMenu threadId="t" messageId="c" authorId="sam" authorName="Sam" viewerId={null} />
      </>,
    )
    expect(screen.queryByRole('button', { name: /Message options/ })).toBeNull()
  })

  it('reports with the chosen reason and says it was sent', async () => {
    render(<MessageModerationMenu threadId="league:L1" messageId="m1" authorId="sam" authorName="Sam" viewerId="me" />)
    await report('Sam')
    expect(bodyOf(posted('/api/shared/chat/report/message')!)).toEqual({ messageId: 'm1', threadId: 'league:L1', reason: 'hate_speech' })
    expect(await screen.findByText(/We review reports within 24 hours/)).toBeTruthy()
  })

  it("shows the server's refusal instead of claiming success", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not allowed' }), { status: 400 })))
    render(<MessageModerationMenu threadId="league:L1" messageId="m1" authorId="sam" authorName="Sam" viewerId="me" />)
    fireEvent.click(screen.getByRole('button', { name: 'Message options for Sam' }))
    fireEvent.click(screen.getByText('Report message'))
    fireEvent.click(screen.getByText('Send report'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Report not sent: Not allowed.')
    expect(screen.queryByText(/We review reports/)).toBeNull()
  })

  it('blocks the author and hands the id back', async () => {
    const onBlocked = vi.fn()
    render(<MessageModerationMenu threadId="t" messageId="m1" authorId="sam" authorName="Sam" viewerId="me" onBlocked={onBlocked} />)
    await block('Sam')
    expect(bodyOf(posted('/api/shared/chat/block')!)).toEqual({ blockedUserId: 'sam' })
    await waitFor(() => expect(onBlocked).toHaveBeenCalledWith('sam'))
  })
})

describe('the app/draft shell chat', () => {
  beforeEach(() => {
    routes['/api/draft/chat/history'] = {
      messages: [
        { id: 'd1', authorUserId: 'sam', authorDisplayName: 'Sam', message: 'you drafted like a clown', type: 'user', createdAt: 'x' },
        { id: 'd2', authorUserId: 'me', authorDisplayName: 'Me', message: 'we will see', type: 'user', createdAt: 'x' },
        { id: 'd3', authorUserId: null, authorDisplayName: null, message: 'Pick is in', type: 'system', createdAt: 'x' },
      ],
    }
  })

  it("reports against the session's draftroom room", async () => {
    render(<DraftChatPanel sessionId="live:L1" mode="live" viewerId="me" />)
    await screen.findByText('you drafted like a clown')
    expect(screen.getAllByRole('button', { name: /Message options/ })).toHaveLength(1)
    await report('Sam')
    expect(bodyOf(posted('/api/shared/chat/report/message')!)).toMatchObject({ messageId: 'd1', threadId: 'draftroom:live:L1' })
  })

  it('blocking hides their messages at once, before the next poll', async () => {
    render(<DraftChatPanel sessionId="live:L1" mode="live" viewerId="me" />)
    await screen.findByText('you drafted like a clown')
    await block('Sam')
    await waitFor(() => expect(screen.queryByText('you drafted like a clown')).toBeNull())
    expect(screen.getByText('we will see')).toBeTruthy()
  })
})

describe('the mock draft chat', () => {
  beforeEach(() => {
    routes['/api/mock-draft/D9/chat'] = {
      viewerUserId: 'me',
      messages: [
        { id: 'k1', userId: 'sam', displayName: 'Sam', content: 'worst mock ever', createdAt: 'x' },
        { id: 'k2', userId: 'me', displayName: 'Me', content: 'sure', createdAt: 'x' },
      ],
    }
  })

  it('offers the menu only on others, from the viewer id the route returns, and reports to mockdraft:', async () => {
    render(<MockDraftChatPanel draftId="D9" pollIntervalMs={60_000} />)
    await screen.findByText('worst mock ever')
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Message options/ })).toHaveLength(1))
    await report('Sam')
    expect(bodyOf(posted('/api/shared/chat/report/message')!)).toMatchObject({ messageId: 'k1', threadId: 'mockdraft:D9' })
  })

  it('blocking hides their messages at once', async () => {
    render(<MockDraftChatPanel draftId="D9" pollIntervalMs={60_000} />)
    await screen.findByText('worst mock ever')
    await block('Sam')
    await waitFor(() => expect(screen.queryByText('worst mock ever')).toBeNull())
  })
})

describe('bracket pool chat', () => {
  beforeEach(() => {
    routes['/api/bracket/leagues/B1/chat'] = {
      messages: [
        { id: 'b1', userId: 'sam', user: { id: 'sam', displayName: 'Sam', username: 'sam' }, message: 'your bracket is garbage', type: 'text', createdAt: '2026-09-29T02:00:00.000Z', reactions: [] },
        { id: 'b2', userId: 'me', user: { id: 'me', displayName: 'Me', username: 'me' }, message: 'we will see', type: 'text', createdAt: '2026-09-29T02:01:00.000Z', reactions: [] },
      ],
    }
  })

  async function openPool() {
    const { container } = render(<PoolChat leagueId="B1" currentUserId="me" members={[]} />)
    /* The pool chat starts as a collapsed dock — a clickable <div>, not a button — so open it by
       clicking the dock itself, the way a member does. */
    fireEvent.click(container.firstElementChild as HTMLElement)
    await screen.findByText('your bracket is garbage')
  }

  it("offers the menu on others' messages — visible, not hover-only — and reports to the league room", async () => {
    await openPool()
    expect(screen.getAllByRole('button', { name: /Message options/ })).toHaveLength(1)
    await report('Sam')
    expect(bodyOf(posted('/api/shared/chat/report/message')!)).toMatchObject({ messageId: 'b1', threadId: 'league:B1' })
  })

  it('blocking hides their messages at once', async () => {
    await openPool()
    await block('Sam')
    await waitFor(() => expect(screen.queryByText('your bracket is garbage')).toBeNull())
    expect(screen.getByText('we will see')).toBeTruthy()
  })
})

describe('the dashboard league chat panel (LeagueChatInPanel)', () => {
  beforeEach(() => {
    routes['/api/league/chat'] = {
      viewerUserId: 'u-viewer',
      messages: [
        { id: 'm-pat', authorId: 'u-pat', authorName: 'Pat', text: 'your lineup is a joke', createdAt: '2026-09-29T02:00:00.000Z', messageType: 'text' },
        { id: 'm-me', authorId: 'u-viewer', authorName: 'Me', text: 'we will see', createdAt: '2026-09-29T02:01:00.000Z', messageType: 'text' },
      ],
    }
  })

  function renderPanel() {
    render(
      <LeagueChatInPanel
        selectedLeague={{ id: 'L1', name: 'Degenerates', leagueVariant: null } as never}
        userId="u-viewer"
        onAskChimmy={() => {}}
      />,
    )
  }

  it("offers the menu on another member's message only, and reports to the league room", async () => {
    renderPanel()
    await screen.findByText('your lineup is a joke')
    expect(screen.getAllByRole('button', { name: /Message options/ })).toHaveLength(1)
    await report('Pat')
    expect(bodyOf(posted('/api/shared/chat/report/message')!)).toMatchObject({ messageId: 'm-pat', threadId: 'league:L1' })
  })

  it('blocking hides their messages at once', async () => {
    renderPanel()
    await screen.findByText('your lineup is a joke')
    await block('Pat')
    await waitFor(() => expect(screen.queryByText('your lineup is a joke')).toBeNull())
    expect(screen.getByText('we will see')).toBeTruthy()
  })
})
