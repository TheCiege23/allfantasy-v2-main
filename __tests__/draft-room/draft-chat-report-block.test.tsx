/**
 * Draft room chat — Report and Block (App Store guideline 1.2).
 *
 * League chat and DMs had both; the draft view of DraftChatPanel had neither, so the Terms
 * and the App Review notes could only say "league chat and direct messages". Driven through
 * the REAL DraftChatPanel and ChatMessageList: open a drafter's message, use the sheet's own
 * buttons, assert what went over the wire.
 *
 * ⚠ The panel's messages are PROPS the parent owns, and they are not changed after a block
 * here — exactly as in the draft room, which merges each read into what it already holds.
 * So the "leave the screen" assertion can only pass through the panel's own hide.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

import { DraftChatPanel, type DraftChatMessage } from '@/components/app/draft-room/DraftChatPanel'

const LEAGUE = 'L1'
const VIEWER = 'me'

function wire(over: Partial<DraftChatMessage> & { id: string }): DraftChatMessage {
  return {
    from: 'Sam',
    text: 'hello',
    at: '2026-09-28T20:00:00.000Z',
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
  wire({ id: 'm-sam', text: 'you drafted like a clown' }),
  wire({ id: 'm-me', from: 'Me', senderUserId: VIEWER, text: 'we will see', at: '2026-09-28T20:01:00.000Z' }),
]

type Call = { url: string; init?: RequestInit }
let calls: Call[] = []

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPanel(onRefreshChat = vi.fn()) {
  render(
    <DraftChatPanel
      messages={MESSAGES}
      onSend={vi.fn()}
      currentUserId={VIEWER}
      leagueId={LEAGUE}
      leagueName="Test League"
      onRefreshChat={onRefreshChat}
    />,
  )
  return onRefreshChat
}

async function openMenuOn(text: string) {
  const bubble = await screen.findByText(text)
  const article = bubble.closest('[role="article"]') as HTMLElement
  fireEvent.keyDown(article, { key: 'Enter' })
  return screen.getByRole('dialog')
}

const bodyOf = (c: Call) => JSON.parse(String(c.init?.body ?? '{}'))

describe('draft chat — Report and Block', () => {
  it("offers Report and Block on another drafter's message", async () => {
    renderPanel()
    const sheet = await openMenuOn('you drafted like a clown')
    expect(within(sheet).getByText(/Report message/)).toBeTruthy()
    expect(within(sheet).getByText(/Block Sam/)).toBeTruthy()
  })

  it('control: never on your own message', async () => {
    renderPanel()
    const sheet = await openMenuOn('we will see')
    expect(within(sheet).queryByText(/Report message/)).toBeNull()
    expect(within(sheet).queryByText(/Block/)).toBeNull()
  })

  it("reports the message against this league's room — the room every draft message lives in", async () => {
    renderPanel()
    const sheet = await openMenuOn('you drafted like a clown')
    fireEvent.click(within(sheet).getByText(/Report message/))
    fireEvent.click(within(sheet).getByText('Send report'))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/shared/chat/report/message')).toBe(true))
    const report = calls.find((c) => c.url === '/api/shared/chat/report/message')!
    expect(report.init?.method).toBe('POST')
    expect(bodyOf(report)).toMatchObject({ messageId: 'm-sam', threadId: `league:${LEAGUE}` })
  })

  it('blocks the author; their messages leave the screen although the parent still passes them', async () => {
    const refresh = renderPanel()
    const sheet = await openMenuOn('you drafted like a clown')
    fireEvent.click(within(sheet).getByText(/Block Sam/))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Block' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/shared/chat/block')).toBe(true))
    expect(bodyOf(calls.find((c) => c.url === '/api/shared/chat/block')!)).toEqual({ blockedUserId: 'sam' })
    await waitFor(() => expect(screen.queryByText('you drafted like a clown')).toBeNull())
    expect(screen.getByText('we will see')).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
  })
})
