import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * 🛑 THE CHAT BUBBLE'S CHIMMY TAB REFUSED EVERY PAID ANSWER.
 *
 * `/api/chat/chimmy` returns 409 `token_confirmation_required` unless the request
 * carries `confirmTokenSpend`, and every token rule is seeded with
 * `requiresConfirmation: true`. The drawer never sent the flag and had no way to
 * collect it, so a paid question came back "Confirm the token spend and ask again"
 * with nothing on screen to confirm.
 *
 * These render the real drawer and drive the real `send`. The contract is the
 * draft room's: ask through `confirmTokenSpend`, retry ONCE with the flag, and on
 * a decline send nothing and give the question back.
 */

const confirmTokenSpendMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/tokens/client-confirm', () => ({
  confirmTokenSpend: confirmTokenSpendMock,
  previewTokenSpend: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

const QUESTION = 'Who should I start this week?'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const CONFIRMATION_REQUIRED = jsonResponse(409, {
  error: 'Token spend confirmation required before sending to Chimmy.',
  code: 'token_confirmation_required',
  preview: { ruleCode: 'ai_chimmy_chat_message' },
})

function openDrawer() {
  render(
    <CommsDrawer
      open
      onClose={vi.fn()}
      mode="overlay"
      leagues={[]}
      pageLeagueId={null}
      chimmyTokenCost={9}
      initialTab="chimmy"
    />,
  )
  const input = screen.getByLabelText('Message')
  fireEvent.change(input, { target: { value: QUESTION } })
  fireEvent.submit(input.closest('form')!)
}

const chimmyPosts = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url) === '/api/chat/chimmy')

describe('chat bubble Chimmy — token consent', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks for consent on a 409 and resends once with confirmTokenSpend', async () => {
    fetchMock
      .mockResolvedValueOnce(CONFIRMATION_REQUIRED)
      .mockResolvedValueOnce(jsonResponse(200, { response: 'Start him.', meta: { tokenSpend: { tokenCost: 9 } } }))
    confirmTokenSpendMock.mockResolvedValue({ confirmed: true, preview: { canSpend: true } })

    openDrawer()

    await waitFor(() => expect(screen.getByText('Start him.')).toBeTruthy())
    expect(confirmTokenSpendMock).toHaveBeenCalledWith('ai_chimmy_chat_message')

    const posts = chimmyPosts(fetchMock)
    expect(posts).toHaveLength(2)
    expect((posts[0]![1].body as FormData).get('confirmTokenSpend')).toBeNull()
    expect((posts[1]![1].body as FormData).get('confirmTokenSpend')).toBe('true')
  })

  it('sends nothing more and hands the question back when consent is declined', async () => {
    fetchMock.mockResolvedValueOnce(CONFIRMATION_REQUIRED)
    confirmTokenSpendMock.mockResolvedValue({ confirmed: false, preview: { canSpend: true } })

    openDrawer()

    await waitFor(() => expect(screen.getByText(/No tokens were spent/)).toBeTruthy())
    expect(chimmyPosts(fetchMock)).toHaveLength(1)
    expect((screen.getByLabelText('Message') as HTMLInputElement).value).toBe(QUESTION)
  })

  it('does not prompt a user who cannot afford the answer', async () => {
    fetchMock.mockResolvedValueOnce(CONFIRMATION_REQUIRED)
    confirmTokenSpendMock.mockResolvedValue({ confirmed: false, preview: { canSpend: false } })

    openDrawer()

    await waitFor(() => expect(screen.getByText(/out of tokens/)).toBeTruthy())
    expect(chimmyPosts(fetchMock)).toHaveLength(1)
  })
})
