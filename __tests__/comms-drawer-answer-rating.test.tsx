import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * Thumbs up / down under a Chimmy answer in the chat bubble (owner's call 2026-09-24). These render
 * the real drawer and drive the real `send`: the thumbs appear under a delivered answer and nowhere
 * else, and a tap sends the same `feedback_submit` event the /chimmy/chat page sends — tagged with
 * the tools the answer used and the screen it was asked from.
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/waivers',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function ask(question = 'Who should I pick up?') {
  render(
    <CommsDrawer
      open
      onClose={vi.fn()}
      mode="overlay"
      leagues={[]}
      pageLeagueId={null}
      pageSurface="waivers"
      chimmyTokenCost={9}
      initialTab="chimmy"
    />,
  )
  const input = screen.getByLabelText('Message')
  fireEvent.change(input, { target: { value: question } })
  fireEvent.submit(input.closest('form')!)
}

const ratings = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .filter(([url]) => String(url) === '/api/ai/events')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))

describe('chat bubble Chimmy — thumbs up / down', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    fetchMock = vi.fn(async (url: unknown) =>
      String(url) === '/api/ai/events'
        ? jsonResponse(200, { ok: true })
        : jsonResponse(200, { response: 'Grab Jaylen Warren.', meta: { toolsUsed: ['get_waivers', 'compare_players'], mode: 'fast_take' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rates a delivered answer, tagged with its tools and the screen it was asked from', async () => {
    ask()
    await waitFor(() => expect(screen.getByText('Grab Jaylen Warren.')).toBeTruthy())
    const up = screen.getByRole('button', { name: 'Useful' })
    expect(up.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(up)
    await waitFor(() => expect(ratings(fetchMock)).toHaveLength(1))
    expect(up.getAttribute('aria-pressed')).toBe('true')
    const [event] = ratings(fetchMock)
    expect(event).toMatchObject({
      event_name: 'feedback_submit',
      action: 'thumbs_up',
      surface: 'waiver',
      mode: 'fast_take',
      metadata: { feedbackValue: 'helpful', source: 'core_comms', entry: 'drawer:waivers', tools: ['get_waivers', 'compare_players'] },
    })
    expect(typeof event.metadata.messageId).toBe('string')
    expect(event.metadata.messageId.length).toBeGreaterThan(8)
    // No answer text travels with a rating.
    expect(JSON.stringify(event)).not.toContain('Jaylen Warren')
  })

  it('a second tap on the same thumb sends nothing; changing your mind sends the new one', async () => {
    ask()
    await waitFor(() => expect(screen.getByText('Grab Jaylen Warren.')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Useful' }))
    fireEvent.click(screen.getByRole('button', { name: 'Useful' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not useful' }))
    await waitFor(() => expect(ratings(fetchMock)).toHaveLength(2))
    expect(ratings(fetchMock).map((e) => e.action)).toEqual(['thumbs_up', 'thumbs_down'])
    expect(screen.getByRole('button', { name: 'Not useful' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Useful' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText(/Tell me what I missed/)).toBeTruthy()
  })

  it('does not offer thumbs under a refusal', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(412, { error: 'needs league', details: { message: 'Which league do you mean?' } }),
    )
    ask()
    await waitFor(() => expect(screen.getByText('Which league do you mean?')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Useful' })).toBeNull()
  })

  it('an answer that reports no tools is still rateable, with an empty list', async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url) === '/api/ai/events' ? jsonResponse(200, { ok: true }) : jsonResponse(200, { response: 'Hold.', meta: { toolsUsed: 'nope' } }),
    )
    ask()
    await waitFor(() => expect(screen.getByText('Hold.')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Not useful' }))
    await waitFor(() => expect(ratings(fetchMock)).toHaveLength(1))
    expect(ratings(fetchMock)[0].metadata.tools).toEqual([])
  })
})
