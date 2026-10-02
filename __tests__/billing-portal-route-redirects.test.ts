import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

/*
 * GET /api/subscription/billing-portal is only ever opened as a PAGE (an <a href> on Settings,
 * the hub and /vpn-blocked). Every answer must therefore be a browser destination: a JSON error
 * body is printed raw in place of the app. These pin each outcome to a redirect.
 */

const { sessionMock, findFirstMock, portalCreateMock, geoMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  findFirstMock: vi.fn(),
  portalCreateMock: vi.fn(),
  geoMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { userSubscription: { findFirst: findFirstMock } } }))
vi.mock('@/lib/stripe-client', () => ({
  getStripeClient: () => ({ billingPortal: { sessions: { create: portalCreateMock } } }),
}))
vi.mock('@/lib/geo/enforcePaidSubscriptionGeo', () => ({ enforcePaidSubscriptionGeo: geoMock }))

import { GET } from '@/app/api/subscription/billing-portal/route'

const ORIGIN = 'https://app.example.test'
const req = () => new Request(`${ORIGIN}/api/subscription/billing-portal`)

async function expectRedirect(res: Response, to: string) {
  expect([302, 303, 307, 308]).toContain(res.status)
  expect(res.headers.get('location')).toBe(to)
  expect(res.headers.get('content-type') ?? '').not.toContain('application/json')
}

beforeEach(() => {
  vi.stubEnv('NEXTAUTH_URL', ORIGIN)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  geoMock.mockResolvedValue(null)
  sessionMock.mockResolvedValue({ user: { id: 'u1' } })
  findFirstMock.mockResolvedValue({ stripeCustomerId: 'cus_1' })
  portalCreateMock.mockResolvedValue({ url: 'https://billing.stripe.com/session/abc' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GET /api/subscription/billing-portal', () => {
  it('opens the Stripe portal, returning to the Billing tab', async () => {
    await expectRedirect(await GET(req()), 'https://billing.stripe.com/session/abc')
    expect(portalCreateMock).toHaveBeenCalledWith({ customer: 'cus_1', return_url: `${ORIGIN}/settings?tab=billing` })
  })

  it('sends a signed-out visit to sign-in, then back to Billing', async () => {
    sessionMock.mockResolvedValue(null)
    await expectRedirect(await GET(req()), `${ORIGIN}/login?callbackUrl=${encodeURIComponent('/settings?tab=billing')}`)
  })

  it('sends a member with no Stripe customer to pricing', async () => {
    findFirstMock.mockResolvedValue(null)
    await expectRedirect(await GET(req()), `${ORIGIN}/pricing?msg=no_subscription`)
  })

  it('sends a Stripe failure back to Billing with a message, not raw JSON', async () => {
    portalCreateMock.mockRejectedValue(new Error('stripe down'))
    await expectRedirect(await GET(req()), `${ORIGIN}/settings?tab=billing&billing=portal_error`)
  })

  it('treats a portal session with no URL as a failure too', async () => {
    portalCreateMock.mockResolvedValue({ url: null })
    await expectRedirect(await GET(req()), `${ORIGIN}/settings?tab=billing&billing=portal_error`)
  })

  it("follows the geo gate's redirectTo instead of printing its 451 JSON", async () => {
    geoMock.mockResolvedValue(
      NextResponse.json({ error: 'PAID_GEO_BLOCKED', redirectTo: '/paid-restricted' }, { status: 451 }),
    )
    await expectRedirect(await GET(req()), `${ORIGIN}/paid-restricted`)
  })

  it('never follows an off-site redirectTo from the gate body', async () => {
    geoMock.mockResolvedValue(NextResponse.json({ redirectTo: '//evil.example/x' }, { status: 451 }))
    await expectRedirect(await GET(req()), `${ORIGIN}/paid-restricted`)
  })
})
