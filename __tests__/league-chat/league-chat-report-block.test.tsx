/**
 * League chat — Report and Block (App Store guideline 1.2).
 *
 * Driven through the REAL LeagueConversation and ChatMessageList: open a member's
 * message, use the sheet's own buttons, and assert what actually went over the
 * wire. Before this, league chat passed neither handler, so the sheet showed
 * neither option — which is what App Review would have found.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { LeagueConversation } from '@/components/core-app/comms/LeagueConversation'

const LEAGUE = 'L1'
const VIEWER = 'u-me'

/** Blocked senders, as the real GET drops them (getBlockedUserIdsForRead). */
let blocked = new Set<string>()

const chatPayload = () => ({
  viewerUserId: VIEWER,
  presence: [],
  messages: [
    { id: 'm-sam', authorId: 'u-sam', authorName: 'Sam', text: 'your team is a joke', createdAt: '2026-09-28T20:00:00.000Z' },
    { id: 'm-me', authorId: VIEWER, authorName: 'Me', text: 'we will see', createdAt: '2026-09-28T20:01:00.000Z' },
  ].filter((m) => !blocked.has(m.authorId)),
})

type Call = { url: string; init?: RequestInit }
let calls: Call[] = []

beforeEach(() => {
  calls = []
  blocked = new Set()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === "/api/shared/chat/block") blocked.add(JSON.parse(String(init?.body)).blockedUserId)
      const json = url.includes(`/api/app/leagues/${LEAGUE}/chat`) ? chatPayload() : {}
      return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openMenuOn(text: string) {
  const bubble = await screen.findByText(text)
  const article = bubble.closest('[role="article"]') as HTMLElement
  fireEvent.keyDown(article, { key: 'Enter' })
  return screen.getByRole('dialog')
}

const bodyOf = (c: Call) => JSON.parse(String(c.init?.body ?? '{}'))

describe('league chat — Report and Block', () => {
  it("offers Report and Block on another member's message", async () => {
    render(<LeagueConversation leagueId={LEAGUE} viewerId={VIEWER} />)
    const sheet = await openMenuOn('your team is a joke')
    expect(within(sheet).getByText(/Report message/)).toBeTruthy()
    expect(within(sheet).getByText(/Block Sam/)).toBeTruthy()
  })

  it('control: never on your own message', async () => {
    render(<LeagueConversation leagueId={LEAGUE} viewerId={VIEWER} />)
    const sheet = await openMenuOn('we will see')
    expect(within(sheet).queryByText(/Report message/)).toBeNull()
    expect(within(sheet).queryByText(/Block/)).toBeNull()
  })

  it("reports the message against this league's room", async () => {
    render(<LeagueConversation leagueId={LEAGUE} viewerId={VIEWER} />)
    const sheet = await openMenuOn('your team is a joke')
    fireEvent.click(within(sheet).getByText(/Report message/))
    fireEvent.click(within(sheet).getByText('Send report'))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/shared/chat/report/message')).toBe(true))
    const report = calls.find((c) => c.url === '/api/shared/chat/report/message')!
    expect(report.init?.method).toBe('POST')
    expect(bodyOf(report)).toMatchObject({ messageId: 'm-sam', threadId: `league:${LEAGUE}` })
  })

  it('blocks the author and their messages leave the screen at once', async () => {
    render(<LeagueConversation leagueId={LEAGUE} viewerId={VIEWER} />)
    const sheet = await openMenuOn('your team is a joke')
    fireEvent.click(within(sheet).getByText(/Block Sam/))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Block' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/shared/chat/block')).toBe(true))
    expect(bodyOf(calls.find((c) => c.url === '/api/shared/chat/block')!)).toEqual({ blockedUserId: 'u-sam' })
    await waitFor(() => expect(screen.queryByText('your team is a joke')).toBeNull())
  })
})
