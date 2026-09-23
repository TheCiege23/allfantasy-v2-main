import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * Fast / Deep in the /core Chimmy drawer (Chimmy brief item 5, user decision 2026-09-16). These drive
 * the real drawer and read the real request body: the drawer used to send no mode at all, so every
 * answer was `fast_take` without the reader ever choosing it.
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/**
 * 🛑 THE DRAWER NOW LOADS ITS HISTORY ON OPEN, AND `mockResolvedValueOnce` IS ORDER-BASED.
 * `useScopedConversation` GETs `/api/chat/chimmy?leagueId=…` at mount to restore the transcript
 * the server has always stored. Queued onto ONE shared mock, that request consumes the FIRST
 * queued response — so the first question got the answer meant for the second, and the assertion
 * failed on a message that had never been rendered.
 *
 * Splitting the mocks routes by URL instead of by call order, which is what makes this file immune
 * rather than merely corrected: a later test can queue as many POST answers as it likes without
 * having to count the drawer's own requests. Same trap this file's CI note already records for the
 * 429 case — an in-flight call eating a `mockResolvedValueOnce` — reached from another direction.
 */
let postMock: ReturnType<typeof vi.fn>
let fetchMock: ReturnType<typeof vi.fn>

/** The drawer's own history read, which must never consume a queued POST answer. */
const isHistoryRead = (url: unknown, init?: { method?: string }) =>
  String(url).startsWith('/api/chat/chimmy?') && (init?.method ?? 'GET').toUpperCase() === 'GET'

const chimmyPosts = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/chat/chimmy')
const sentMode = (i: number) => (chimmyPosts()[i]![1].body as FormData).get('assistantMode')

function openDrawer(userId = 'u1') {
  return render(
    <CommsDrawer
      open
      onClose={vi.fn()}
      mode="overlay"
      leagues={[]}
      pageLeagueId={null}
      chimmyTokenCost={9}
      initialTab="chimmy"
      userId={userId}
    />,
  )
}

function ask(question: string) {
  const input = screen.getByLabelText('Message')
  fireEvent.change(input, { target: { value: question } })
  fireEvent.submit(input.closest('form')!)
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  postMock = vi.fn().mockResolvedValue(jsonResponse(200, { response: 'Start him.', meta: {} }))
  fetchMock = vi.fn((url: unknown, init?: { method?: string }) =>
    isHistoryRead(url, init)
      ? Promise.resolve(jsonResponse(200, { turns: [] }))
      : postMock(url, init),
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the Answer toggle', () => {
  // The full answer is the default (user decision 2026-09-23); Fast is opt-in.
  it('starts on Deep (the full answer) and sends it', async () => {
    openDrawer()
    expect(screen.getByRole('button', { name: 'Deep' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Fast' }).getAttribute('aria-pressed')).toBe('false')
    ask('Who should I start?')
    await waitFor(() => expect(chimmyPosts()).toHaveLength(1))
    expect(sentMode(0)).toBe('deep_analysis')
  })

  it('sends Fast once chosen', async () => {
    openDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Fast' }))
    expect(screen.getByRole('button', { name: 'Fast' }).getAttribute('aria-pressed')).toBe('true')
    ask('Who should I start?')
    await waitFor(() => expect(chimmyPosts()).toHaveLength(1))
    expect(sentMode(0)).toBe('fast_take')
  })

  /*
   * ⚠ MID-CONVERSATION IS THE CASE THAT CAN GO STALE. With no turns yet, the conversation hook hands
   * back a fresh empty array every render, so the send callback is rebuilt regardless of its deps.
   * Once a turn exists the array is stable, and a send callback that forgot `answerMode` would keep
   * sending the mode it was created with.
   */
  it('a switch mid-conversation applies to the next question', async () => {
    openDrawer()
    ask('First question')
    await waitFor(() => expect(screen.getByText('Start him.')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Fast' }))
    ask('Second question')
    await waitFor(() => expect(chimmyPosts()).toHaveLength(2))
    expect(sentMode(0)).toBe('deep_analysis')
    expect(sentMode(1)).toBe('fast_take')
  })

  it('remembers the choice for that user only', async () => {
    const first = openDrawer('u1')
    fireEvent.click(screen.getByRole('button', { name: 'Fast' }))
    first.unmount()

    const again = openDrawer('u1')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fast' }).getAttribute('aria-pressed')).toBe('true'))
    again.unmount()

    openDrawer('u2')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Deep' }).getAttribute('aria-pressed')).toBe('true'))
  })

  it('never implies Deep costs more', () => {
    openDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Deep' }))
    expect(screen.getByText(/Same price either way/)).toBeTruthy()
  })
})

describe('which mode answered', () => {
  it('tags an answer with the mode the server says shaped it', async () => {
    postMock.mockResolvedValue(jsonResponse(200, { response: 'The long version.', meta: { mode: 'deep_analysis' } }))
    openDrawer()
    ask('Break it down')
    await waitFor(() => expect(screen.getByText('The long version.')).toBeTruthy())
    expect(screen.getByText('Deep answer')).toBeTruthy()
  })

  it('claims nothing when the server did not say, or said something else', async () => {
    postMock
      .mockResolvedValueOnce(jsonResponse(200, { response: 'First.', meta: {} }))
      .mockResolvedValueOnce(jsonResponse(200, { response: 'Second.', meta: { mode: 'dynasty_lens' } }))
    openDrawer()
    ask('One')
    await waitFor(() => expect(screen.getByText('First.')).toBeTruthy())
    ask('Two')
    await waitFor(() => expect(screen.getByText('Second.')).toBeTruthy())
    expect(screen.queryByText('Deep answer')).toBeNull()
    expect(screen.queryByText('Fast answer')).toBeNull()
  })
})
