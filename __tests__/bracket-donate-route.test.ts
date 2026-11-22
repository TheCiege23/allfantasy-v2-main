import { beforeEach, describe, expect, it, vi } from 'vitest'

const { session, createSession } = vi.hoisted(() => ({ session: vi.fn(), createSession: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/stripe-client', () => ({ getStripeClient: () => ({ checkout: { sessions: { create: createSession } } }) }))
vi.mock('@/lib/get-base-url', () => ({ getBaseUrl: () => 'https://allfantasy.test' }))

import { POST } from '@/app/api/bracket/donate/route'

const post = (body: unknown) =>
  POST(new Request('http://x.test/api/bracket/donate', { method: 'POST', body: JSON.stringify(body) }) as any)

beforeEach(() => {
  vi.clearAllMocks()
  session.mockResolvedValue({ user: { id: 'u1' } })
  createSession.mockResolvedValue({ url: 'https://checkout.stripe.test/s' })
})

describe('POST /api/bracket/donate', () => {
  it('🛑 a fractional amount is charged in whole cents, never sent to Stripe as a fraction', async () => {
    const res = await post({ amountCents: 150.5 })
    expect(res.status).toBe(200)
    const params = createSession.mock.calls[0]![0]
    expect(params.line_items[0].price_data.unit_amount).toBe(151)
    expect(Number.isInteger(params.line_items[0].price_data.unit_amount)).toBe(true)
    expect(params.metadata.amountCents).toBe('151')
  })

  it('🛑 labels the session with purchase_type, the key the Stripe webhook routes on', async () => {
    await post({ amountCents: 500 })
    expect(createSession.mock.calls[0]![0].metadata).toMatchObject({
      purchase_type: 'donation',
      type: 'donation',
      userId: 'u1',
    })
  })

  it('keeps the $1–$500 limits and refuses non-numbers before Stripe is called', async () => {
    for (const amountCents of [99, 50001, 'abc', null, undefined, Infinity]) {
      const res = await post({ amountCents })
      expect(res.status, String(amountCents)).toBe(400)
    }
    expect(createSession).not.toHaveBeenCalled()
  })

  it('still requires a signed-in user', async () => {
    session.mockResolvedValueOnce(null)
    expect((await post({ amountCents: 500 })).status).toBe(401)
    expect(createSession).not.toHaveBeenCalled()
  })
})
