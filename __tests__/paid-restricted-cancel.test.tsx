import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/*
 * Owner's call, 2026-10-02: a subscriber located in a paid-restricted state is refused the billing
 * portal, so /paid-restricted gives them "Cancel my subscription", which cancels on our side.
 */

const { sessionMock, cancelMock } = vi.hoisted(() => ({ sessionMock: vi.fn(), cancelMock: vi.fn() }))

vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { userSubscription: { findMany: vi.fn(async () => []) } } }))
vi.mock('@/lib/stripe-client', () => ({ getStripeClient: vi.fn() }))
vi.mock('@/lib/account/cancelSubscriptionsOnDelete', () => ({ cancelSubscriptionsOnDelete: cancelMock }))

import { POST } from '@/app/api/account/cancel-subscription/route'
import { CancelSubscriptionPanel } from '@/app/paid-restricted/CancelSubscriptionPanel'

const post = (body?: unknown) =>
  POST(new Request('http://localhost/api/account/cancel-subscription', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sessionMock.mockResolvedValue({ user: { id: 'u1' } })
  cancelMock.mockResolvedValue({ cancelled: ['sub_1'], hasAppleSubscription: false })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('POST /api/account/cancel-subscription', () => {
  it('requires a session', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await post({ confirm: true })).status).toBe(401)
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('requires an explicit confirmation', async () => {
    expect((await post({})).status).toBe(400)
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it("cancels the caller's subscriptions, noting why on the Stripe record", async () => {
    const res = await post({ confirm: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, cancelledSubscriptions: 1, appleSubscriptionActive: false })
    expect(cancelMock.mock.calls[0]![0]).toBe('u1')
    expect(cancelMock.mock.calls[0]![2]).toMatchObject({ comment: expect.stringMatching(/paid-restricted/) })
  })

  it('says it failed, never that it worked, when Stripe refuses', async () => {
    cancelMock.mockRejectedValue(new Error('stripe down'))
    const res = await post({ confirm: true })
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ code: 'subscription_cancel_failed' })
  })
})

describe('the /paid-restricted cancel panel', () => {
  it('asks once more, then cancels and says so', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, appleSubscriptionActive: false })))
    vi.stubGlobal('fetch', fetchMock)
    render(<CancelSubscriptionPanel hasStripe hasApple={false} />)

    fireEvent.click(screen.getByTestId('paid-restricted-cancel-start'))
    expect(fetchMock).not.toHaveBeenCalled() // the first tap only asks
    fireEvent.click(screen.getByTestId('paid-restricted-cancel-confirm'))
    expect(await screen.findByTestId('paid-restricted-cancel-done')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account/cancel-subscription',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirm: true }) }),
    )
  })

  it("shows the server's reason when cancelling fails", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: "We couldn't cancel your subscription just now." }), { status: 502 })),
    )
    render(<CancelSubscriptionPanel hasStripe hasApple={false} />)
    fireEvent.click(screen.getByTestId('paid-restricted-cancel-start'))
    fireEvent.click(screen.getByTestId('paid-restricted-cancel-confirm'))
    expect((await screen.findByTestId('paid-restricted-cancel-error')).textContent).toMatch(/couldn't cancel/i)
    expect(screen.queryByTestId('paid-restricted-cancel-done')).toBeNull()
  })

  it('tells an App Store subscriber where to cancel instead of offering a button that cannot', () => {
    render(<CancelSubscriptionPanel hasStripe={false} hasApple />)
    expect(screen.getByTestId('paid-restricted-cancel-apple').textContent).toMatch(/iPhone Settings/)
    expect(screen.queryByTestId('paid-restricted-cancel-start')).toBeNull()
  })
})
