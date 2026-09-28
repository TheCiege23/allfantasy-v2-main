import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const consent = vi.hoisted(() => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('@/lib/tokens/client-confirm', () => consent)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

/**
 * Running out of tokens was a line of red text — no way to buy, no mention of AF Pro, the question
 * left stranded. It is the moment a free user is most likely to pay, so it now offers both ways to
 * keep going and hands the question back.
 */

const ALLOWANCE_USED = { included: false, planName: 'AF Pro', used: 100, limit: 100, resetsAt: '2026-09-25T00:00:00.000Z' }
const NO_BALANCE = { ruleCode: 'ai_chimmy_chat_message', featureLabel: 'Chimmy', tokenCost: 10, currentBalance: 0, canSpend: false, requiresConfirmation: true }

type Reply = { status: number; body: Record<string, unknown> }

function stubChat(reply: Reply) {
  const fetchMock = vi.fn(async (url: unknown) =>
    String(url) === '/api/chat/chimmy'
      ? { ok: reply.status < 400, status: reply.status, json: async () => reply.body }
      : { ok: true, status: 200, json: async () => ({}) },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function open(allowance: typeof ALLOWANCE_USED | null = null) {
  render(
    <CommsDrawer
      open
      onClose={vi.fn()}
      mode="overlay"
      leagues={[{ id: 'l0', name: 'KBFL', platform: 'sleeper' }] as never}
      pageLeagueId={null}
      chimmyTokenCost={10}
      chimmyPlanAllowance={allowance}
      initialTab="chimmy"
      userId="u1"
    />,
  )
}

function ask(text: string) {
  const box = screen.getByLabelText('Message') as HTMLInputElement
  fireEvent.change(box, { target: { value: text } })
  fireEvent.submit(box.closest('form') as HTMLFormElement)
  return box
}

describe('Chimmy drawer — out of tokens', () => {
  beforeEach(() => {
    sessionStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
    consent.confirmTokenSpend.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('offers AF Pro and tokens to a free account, and hands the question back', async () => {
    stubChat({ status: 409, body: { code: 'token_confirmation_required', preview: NO_BALANCE, planAllowance: null } })
    consent.confirmTokenSpend.mockResolvedValue({ confirmed: false, preview: NO_BALANCE })
    open()
    const box = ask('Who should I start at flex?')

    expect(await screen.findByText('You are out of Chimmy answers')).toBeTruthy()
    expect(screen.getByText(/AF Pro includes 100 Chimmy answers a day/)).toBeTruthy()
    expect(screen.getByText(/Your 2 free questions come back at midnight UTC/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Get AF Pro' }).getAttribute('href')).toBe('/upgrade?plan=af_pro&from=chimmy-drawer')
    expect(screen.getByRole('link', { name: 'Buy tokens' }).getAttribute('href')).toBe('/tokens?from=chimmy-drawer')
    /* Back in the composer, not stranded in the transcript as a question nobody answered. */
    expect(box.value).toBe('Who should I start at flex?')
    expect(screen.queryByText('Who should I start at flex?', { selector: '.af-cm-turn-text' })).toBeNull()
    expect(screen.queryByText(/Top up and ask again/)).toBeNull()
  })

  it('never sells AF Pro to a subscriber whose day is used — tokens only', async () => {
    stubChat({ status: 409, body: { code: 'token_confirmation_required', preview: NO_BALANCE, planAllowance: ALLOWANCE_USED } })
    consent.confirmTokenSpend.mockResolvedValue({ confirmed: false, preview: NO_BALANCE })
    open()
    ask('Grade my trade')

    expect(await screen.findByText("Today's 100 AF Pro answers are used")).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Buy tokens' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Get AF Pro' })).toBeNull()
  })

  it('falls back to the plan the drawer already knows when the refusal carries none', async () => {
    stubChat({ status: 402, body: { code: 'insufficient_token_balance', requiredTokens: 10, currentBalance: 0 } })
    open(ALLOWANCE_USED)
    ask('Grade my trade')

    expect(await screen.findByText("Today's 100 AF Pro answers are used")).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Get AF Pro' })).toBeNull()
  })

  it('handles the spend-time 402 the same way as the consent-time refusal', async () => {
    stubChat({ status: 402, body: { code: 'insufficient_token_balance', requiredTokens: 10, currentBalance: 0, planAllowance: null } })
    open()
    const box = ask('Who should I pick up?')

    expect(await screen.findByRole('link', { name: 'Get AF Pro' })).toBeTruthy()
    expect(box.value).toBe('Who should I pick up?')
  })

  it('clears the card on the next send', async () => {
    const fetchMock = stubChat({ status: 402, body: { code: 'insufficient_token_balance', planAllowance: null } })
    open()
    ask('Who should I pick up?')
    expect(await screen.findByText('You are out of Chimmy answers')).toBeTruthy()

    fetchMock.mockImplementation(async (url: unknown) =>
      String(url) === '/api/chat/chimmy'
        ? { ok: true, status: 200, json: async () => ({ response: 'Add Jaylen Warren.' }) }
        : { ok: true, status: 200, json: async () => ({}) },
    )
    ask('Who should I pick up?')
    expect(await screen.findByText('Add Jaylen Warren.')).toBeTruthy()
    expect(screen.queryByText('You are out of Chimmy answers')).toBeNull()
  })
})
