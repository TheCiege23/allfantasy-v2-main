import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * "Did it / Not doing it" under advice Chimmy put on file (brief item 10, user decision
 * 2026-09-16: "Buttons + inferred"). Two halves, as with the evidence block: the component sends
 * the right vote, AND the real drawer reads `meta.advice` off the envelope — a component test alone
 * would pass with the wiring deleted.
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer, { readAdvice } from '@/components/core-app/comms/CommsDrawer'
import { ChimmyAdviceFollow } from '@/components/core-app/comms/ChimmyAdviceFollow'

const KEY = 'L1:2026:6:add:11620'
const EVENT_URL = '/api/user/chimmy-personalization/event'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const votes = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url) === EVENT_URL).map(([, init]) => JSON.parse(String(init.body)))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ChimmyAdviceFollow', () => {
  const advice = { key: KEY, type: 'add' as const, playerName: 'Jaylen Wright' }

  it('sends the vote with the advice key, and shows it was taken', async () => {
    const onVoted = vi.fn()
    render(<ChimmyAdviceFollow advice={advice} onVoted={onVoted} />)
    expect(screen.getByRole('group', { name: 'Add Jaylen Wright?' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Did it' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Did it' }).getAttribute('aria-pressed')).toBe('true'))

    expect(votes(fetchMock)).toEqual([
      {
        type: 'recommendation_accepted',
        metadata: { adviceKey: KEY, adviceType: 'add', surface: 'core_comms' },
      },
    ])
    expect(onVoted).toHaveBeenCalledWith('did')
    expect(screen.getByRole('status').textContent).toMatch(/Noted/)
  })

  it('lets you change your mind, and does not resend the same vote', async () => {
    render(<ChimmyAdviceFollow advice={advice} />)
    fireEvent.click(screen.getByRole('button', { name: 'Did it' }))
    await waitFor(() => expect(votes(fetchMock)).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Did it' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Did it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not doing it' }))
    await waitFor(() => expect(votes(fetchMock)).toHaveLength(2))
    expect(votes(fetchMock)[1].type).toBe('recommendation_rejected')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Not doing it' }).getAttribute('aria-pressed')).toBe('true'),
    )
    expect(screen.getByRole('button', { name: 'Did it' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('says so when the vote did not save, and records nothing', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}))
    const onVoted = vi.fn()
    render(<ChimmyAdviceFollow advice={advice} onVoted={onVoted} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not doing it' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/did not save/))
    expect(onVoted).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Not doing it' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('shows a vote already on the turn', () => {
    render(<ChimmyAdviceFollow advice={{ ...advice, vote: 'not' }} />)
    expect(screen.getByRole('button', { name: 'Not doing it' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('readAdvice', () => {
  it('keeps only a well-formed add', () => {
    expect(readAdvice({ meta: { advice: { key: ` ${KEY} `, type: 'add', playerName: 'Jaylen Wright' } } })).toEqual({
      key: KEY,
      type: 'add',
      playerName: 'Jaylen Wright',
      vote: null,
    })
    for (const advice of [
      undefined,
      { key: KEY, type: 'start_sit', playerName: 'X' },
      { key: '', type: 'add', playerName: 'X' },
      { key: KEY, type: 'add', playerName: '  ' },
      { key: 7, type: 'add', playerName: 'X' },
      { key: 'k'.repeat(201), type: 'add', playerName: 'X' },
    ]) {
      expect(readAdvice({ meta: { advice } })).toBeNull()
    }
    expect(readAdvice({})).toBeNull()
  })
})

describe('the /core drawer', () => {
  function ask() {
    const view = render(
      <CommsDrawer
        open
        onClose={vi.fn()}
        mode="overlay"
        leagues={[]}
        pageLeagueId={null}
        chimmyTokenCost={9}
        initialTab="chimmy"
        userId="u1"
      />,
    )
    const input = screen.getByLabelText('Message')
    fireEvent.change(input, { target: { value: 'Who should I pick up?' } })
    fireEvent.submit(input.closest('form')!)
    return view
  }

  it('renders the buttons for advice the answer put on file, and keeps the vote', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url) === '/api/chat/chimmy'
        ? jsonResponse(200, {
            response: 'Add Jaylen Wright.',
            meta: { advice: { key: KEY, type: 'add', playerName: 'Jaylen Wright' } },
          })
        : jsonResponse(200, { ok: true }),
    )
    const view = ask()
    await waitFor(() => expect(screen.getByRole('group', { name: 'Add Jaylen Wright?' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Did it' }))
    await waitFor(() => expect(votes(fetchMock)).toHaveLength(1))
    expect(votes(fetchMock)[0].metadata.adviceKey).toBe(KEY)

    // Reopened: the saved conversation still shows the vote.
    const saved = () =>
      Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.getItem(sessionStorage.key(i) ?? '') ?? '').join('')
    await waitFor(() => expect(saved()).toContain('"vote":"did"'))
    view.unmount()
    render(
      <CommsDrawer
        open
        onClose={vi.fn()}
        mode="overlay"
        leagues={[]}
        pageLeagueId={null}
        chimmyTokenCost={9}
        initialTab="chimmy"
        userId="u1"
      />,
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Did it' }).getAttribute('aria-pressed')).toBe('true'),
    )
  })

  it('renders nothing extra for an answer with no advice on file', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { response: 'Add Jaylen Wright.', meta: {} }))
    ask()
    await waitFor(() => expect(screen.getByText('Add Jaylen Wright.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Did it' })).toBeNull()
  })
})
