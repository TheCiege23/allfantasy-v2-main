/**
 * Commissioner announcements from the UI actually reach league chat.
 *
 * 🛑 THE COMMISSIONER TAB'S BROADCAST COULD NOT DELIVER ANYWHERE. It posted to the thread named by
 * `settings.leagueChatThreadId` and was only shown when that link existed — and nothing sets it
 * (0 of 390 leagues in production). Both surfaces showed "link league chat in Settings" instead,
 * pointing at a control that does not exist.
 *
 * Now the form posts through `POST /api/commissioner/broadcast` (the path the Commissioner Hub,
 * format hubs and draft room already use), which writes into the league's own chat, and the
 * announcement renders with the commissioner label in both league chat surfaces.
 *
 * The real components render; `fetch` is the only seam, answering like the real routes do.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/app/commissioner/AICommissionerPanel', () => ({ default: () => null }))
vi.mock('@/components/app/recruitment', () => ({ LeagueRecruitmentTools: () => null }))
vi.mock('@/components/app/commissioner/CommissionerMonetizationOverview', () => ({ CommissionerMonetizationOverview: () => null }))
vi.mock('@/components/subscription/FeatureGate', () => ({
  FeatureGate: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/hooks/useEntitlement', () => ({ useEntitlement: () => ({ hasAccess: () => true }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/league/L1',
  useSearchParams: () => new URLSearchParams(),
}))

import CommissionerBroadcastForm from '@/components/chat/CommissionerBroadcastForm'
import CommissionerTab from '@/components/app/tabs/CommissionerTab'
import CommissionerControlsPanel from '@/components/app/settings/CommissionerControlsPanel'
import { LeagueConversation } from '@/components/core-app/comms/LeagueConversation'
import { LeagueChatInPanel } from '@/app/dashboard/components/LeagueChatInPanel'

type Json = Record<string, unknown>

const net = {
  broadcastLeagues: [] as Json[],
  broadcastResponse: { status: 200, body: {} as Json },
  leagueMessages: [] as Json[],
}
let fetchMock: ReturnType<typeof vi.fn>

function reply(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

function urlOf(input: unknown): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : String((input as { url?: string })?.url ?? input)
}

beforeEach(() => {
  net.broadcastLeagues = [{ id: 'L1', isNative: true, platform: 'native' }]
  net.broadcastResponse = { status: 200, body: { ok: true, results: [{ leagueId: 'L1', sent: true }] } }
  net.leagueMessages = []
  Element.prototype.scrollIntoView = vi.fn()
  fetchMock = vi.fn(async (input: unknown, init?: { method?: string }) => {
    const url = urlOf(input)
    if (url.startsWith('/api/commissioner/leagues') && url.split('?')[0] === '/api/commissioner/leagues') {
      return reply({ leagues: net.broadcastLeagues })
    }
    if (url === '/api/commissioner/broadcast' && init?.method === 'POST') {
      return reply(net.broadcastResponse.body, net.broadcastResponse.status)
    }
    if (url.startsWith('/api/app/leagues/L1/chat') || url.startsWith('/api/league/chat')) {
      return reply({ viewerUserId: 'u-viewer', messages: net.leagueMessages })
    }
    return reply({})
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const called = (pred: (url: string) => boolean) => fetchMock.mock.calls.filter(([u]) => pred(urlOf(u)))

describe('CommissionerBroadcastForm', () => {
  it('posts through /api/commissioner/broadcast for this league, never into a chat thread', async () => {
    render(<CommissionerBroadcastForm leagueId="L1" />)
    const box = await screen.findByTestId('commissioner-announcement-input')
    fireEvent.change(box, { target: { value: 'Trade deadline is Sunday' } })
    fireEvent.click(screen.getByTestId('commissioner-announcement-send'))

    await screen.findByText(/Posted to league chat/)
    const sends = called((u) => u === '/api/commissioner/broadcast')
    expect(sends).toHaveLength(1)
    expect(JSON.parse(String((sends[0]![1] as { body: string }).body))).toEqual({
      leagueIds: ['L1'],
      message: 'Trade deadline is Sunday',
    })
    expect(called((u) => u.includes('/api/shared/chat/threads'))).toHaveLength(0)
  })

  it('says plainly that an imported league has no league chat here to post to', async () => {
    net.broadcastLeagues = [{ id: 'L1', isNative: false, platform: 'sleeper' }]
    render(<CommissionerBroadcastForm leagueId="L1" />)
    const note = await screen.findByTestId('commissioner-announcement-unavailable')
    expect(note.textContent).toMatch(/no league chat here to post to/i)
    expect(note.textContent).toMatch(/Sleeper/)
    expect(screen.queryByTestId('commissioner-announcement-input')).toBeNull()
  })

  it('does not offer a send to someone who is not a commissioner or co-commissioner', async () => {
    net.broadcastLeagues = []
    render(<CommissionerBroadcastForm leagueId="L1" />)
    const note = await screen.findByTestId('commissioner-announcement-unavailable')
    expect(note.textContent).toMatch(/Only this league's commissioner or a co-commissioner/)
    expect(screen.queryByTestId('commissioner-announcement-input')).toBeNull()
  })

  it("shows the route's refusal in plain words and keeps the message", async () => {
    net.broadcastResponse = { status: 200, body: { ok: true, results: [{ leagueId: 'L1', sent: false, error: 'Forbidden' }] } }
    render(<CommissionerBroadcastForm leagueId="L1" />)
    const box = (await screen.findByTestId('commissioner-announcement-input')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Trade deadline is Sunday' } })
    fireEvent.click(screen.getByTestId('commissioner-announcement-send'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Only this league's commissioner or a co-commissioner/)
    expect(box.value).toBe('Trade deadline is Sunday')
  })
})

describe('where the form lives — no chat link needed, no dead "link chat" copy', () => {
  it('CommissionerTab offers the announcement box with no leagueChatThreadId set', async () => {
    render(<CommissionerTab leagueId="L1" />)
    await screen.findByTestId('commissioner-announcement-input')
    expect(document.body.textContent).not.toMatch(/link chat|League chat not linked|Link league chat/i)
  })

  it('CommissionerControlsPanel offers the announcement box with no leagueChatThreadId set', async () => {
    render(<CommissionerControlsPanel leagueId="L1" />)
    await screen.findByTestId('commissioner-announcement-input')
    expect(document.body.textContent).not.toMatch(/link chat|Link league chat|Checking chat link/i)
  })
})

describe('an announcement renders as a commissioner announcement in league chat', () => {
  const broadcast = {
    id: 'm-announce',
    authorId: 'u-comm',
    authorName: 'Coach Guap',
    text: '@everyone Trade deadline is Sunday',
    createdAt: '2026-09-25T12:00:00.000Z',
    messageType: 'broadcast',
  }
  const chatter = {
    id: 'm-chatter',
    authorId: 'u-pat',
    authorName: 'Pat',
    text: 'finally some rules',
    createdAt: '2026-09-25T12:01:00.000Z',
    messageType: 'text',
  }

  it('LeagueConversation tags it "Commissioner" and leaves ordinary messages alone', async () => {
    net.leagueMessages = [broadcast, chatter]
    render(<LeagueConversation leagueId="L1" viewerId="u-viewer" />)
    // The body is split around the @everyone highlight, so wait for the row itself.
    await waitFor(() => expect(document.getElementById('af-cm-msg-m-chatter')).not.toBeNull())
    const announceRow = document.getElementById('af-cm-msg-m-announce')
    const chatterRow = document.getElementById('af-cm-msg-m-chatter')
    expect(announceRow?.querySelector('.af-cm-msg-tag')?.textContent).toBe('Commissioner')
    expect(chatterRow).not.toBeNull()
    expect(chatterRow?.querySelector('.af-cm-msg-tag')).toBeNull()
  })

  it('the dashboard league panel labels it too', async () => {
    net.leagueMessages = [broadcast, chatter]
    render(
      <LeagueChatInPanel
        selectedLeague={{ id: 'L1', name: 'Degenerates', leagueVariant: null } as never}
        userId="u-viewer"
        onAskChimmy={() => {}}
      />,
    )
    const text = await screen.findByText('@everyone Trade deadline is Sunday')
    const bubble = text.parentElement as HTMLElement
    expect(bubble.textContent).toMatch(/Commissioner/)
    const other = await screen.findByText('finally some rules')
    expect((other.parentElement as HTMLElement).textContent).not.toMatch(/Commissioner/)
  })
})

