import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * The $9.99 "Bracket Lab Pass" is no longer sold (app/api/stripe/create-checkout-session).
 * It promised simulation tools that nothing delivered — no page renders the Lab dashboard,
 * its /api/lab routes do not exist, and the webhook grants nothing for it. Live Stripe,
 * checked 2026-09-25: no lab session was ever created. Donations are unchanged.
 */

const session = vi.hoisted(() => vi.fn())
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const createSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/stripe-client', () => ({ getStripeClient: () => ({ checkout: { sessions: { create: createSession } } }) }))
vi.mock('@/lib/get-base-url', () => ({ getBaseUrl: () => 'https://allfantasy.test' }))
vi.mock('@/lib/tournament', () => ({ getActiveTournament: vi.fn(async () => ({ id: 't-1' })) }))

const search = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => search.value }))
vi.mock('@/hooks/useEntitlement', () => ({ useEntitlement: () => ({ refetch: vi.fn() }) }))
vi.mock('@/hooks/useTokenBalance', () => ({ useTokenBalance: () => ({ refetch: vi.fn() }) }))

import { POST } from '@/app/api/stripe/create-checkout-session/route'
import DonatePage from '@/app/donate/page'
import DonateSuccessPage from '@/app/donate/success/page'

const post = (body: unknown) =>
  POST(new Request('http://x.test/api/stripe/create-checkout-session', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  session.mockResolvedValue({ user: { id: 'u1' } })
  createSession.mockResolvedValue({ url: 'https://checkout.stripe.test/s' })
  search.value = new URLSearchParams()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('POST /api/stripe/create-checkout-session', () => {
  it('🛑 a Lab Pass checkout is refused before Stripe is ever called', async () => {
    const res = await post({ mode: 'lab', amount: 9.99, currency: 'usd' })
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'The Bracket Lab Pass is no longer sold.' })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('🛑 any mode but a donation is refused — the webhook routes on the purchase_type this route writes', async () => {
    for (const mode of [undefined, '', 'subscription', 'tokens', 'LAB ']) {
      const res = await post({ mode, amount: 5, currency: 'usd' })
      expect(res.status, String(mode)).toBeGreaterThanOrEqual(400)
    }
    expect(createSession).not.toHaveBeenCalled()
  })

  it('a donation still checks out, as a donation', async () => {
    const res = await post({ mode: 'donate', amount: 5, currency: 'usd' })
    expect(res.status).toBe(200)
    const params = createSession.mock.calls[0]![0]
    expect(params.line_items[0].price_data).toMatchObject({ unit_amount: 500, product_data: { name: 'Donation' } })
    expect(params.metadata).toMatchObject({ purchase_type: 'donate', userId: 'u1' })
    expect(params.success_url).toBe('https://allfantasy.test/donate/success?mode=donate')
  })

  it('donation limits are unchanged ($1–$500)', async () => {
    expect((await post({ mode: 'donate', amount: 0.5, currency: 'usd' })).status).toBe(400)
    expect((await post({ mode: 'donate', amount: 501, currency: 'usd' })).status).toBe(400)
    expect(createSession).not.toHaveBeenCalled()
  })
})

describe('/donate', () => {
  it('🛑 an old ?mode=lab link lands on the donation form and checks out a donation', async () => {
    window.history.replaceState({}, '', '/donate?mode=lab')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'stop' }), { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('alert', vi.fn())

    render(<DonatePage />)
    expect(screen.getByRole('heading', { name: 'Support AllFantasy' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/lab/i)
    expect(document.body.textContent).not.toContain('$9.99')

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Checkout' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ mode: 'donate', amount: 5, currency: 'usd' })
  })
})

describe('/donate/success', () => {
  it('never shows a Lab Pass, even for an old ?mode=lab return', () => {
    search.value = new URLSearchParams('mode=lab')
    render(<DonateSuccessPage />)
    expect(document.body.textContent).toContain('Thank you for supporting AllFantasy')
    expect(document.body.textContent).not.toMatch(/lab/i)
  })
})
