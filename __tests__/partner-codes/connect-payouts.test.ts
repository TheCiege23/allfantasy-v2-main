import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Automatic payouts through Stripe Connect. The properties that cost money if wrong:
 *  - money moves only to an account whose v2 stripe_transfers capability is ACTIVE, re-checked first;
 *  - the transfer's idempotency key is the payout id, so a retry or double click can't pay twice;
 *  - a failed transfer is recorded for a retry, never marked paid;
 *  - auto-send respects its cap and never sends a statement touching a flagged subscriber.
 */

vi.mock('server-only', () => ({}))

type Row = Record<string, any>
const db = {
  profile: null as Row | null,
  payouts: new Map<string, Row>(),
  entries: [] as Row[],
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    partnerTaxProfile: {
      findUnique: vi.fn(async () => (db.profile ? { ...db.profile } : null)),
      update: vi.fn(async ({ data }: { data: Row }) => Object.assign(db.profile!, data)),
    },
    partnerPayout: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (db.payouts.has(where.id) ? { ...db.payouts.get(where.id) } : null)),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = db.payouts.get(where.id)!
        for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? (row[k] ?? 0) + v.increment : v
        return row
      }),
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        Array.from(db.payouts.values()).filter((p) => p.status === where.status && p.totalCents <= (where.totalCents?.lte ?? Infinity) && p.transferError == null),
      ),
    },
    partnerCommissionEntry: {
      count: vi.fn(async ({ where }: { where: Row }) => db.entries.filter((e) => e.payoutId === where.payoutId && e.flagged).length),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        for (const e of db.entries) if (e.payoutId === where.payoutId && e.status === where.status) Object.assign(e, data)
        return { count: 0 }
      }),
    },
    appUser: { findUnique: vi.fn(async () => ({ email: null })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn((await import('@/lib/prisma')).prisma)),
  },
}))

const stripe = {
  v2: { core: { accounts: { retrieve: vi.fn() } } },
  transfers: { create: vi.fn(), list: vi.fn(async () => ({ data: [] as Row[] })) },
}
vi.mock('@/lib/stripe-client', () => ({ getStripeClient: () => stripe }))
vi.mock('@/lib/resend-client', () => ({ sendNotificationEmail: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/partner-codes/service', async () => {
  const { DEFAULT_PARTNER_SETTINGS } = await import('@/lib/partner-codes/settings')
  return { loadPartnerSettings: async () => DEFAULT_PARTNER_SETTINGS }
})
vi.mock('@/lib/subscription/webhookHandlers', () => ({ upsertSubscriptionPlanForCatalogItem: vi.fn() }))
vi.mock('@/lib/subscription/syncBridge', () => ({ syncUserProfileFromSubscriptions: vi.fn() }))
vi.mock('@/lib/partner-codes/paidPlanOverlap', () => ({ overlapEmail: vi.fn(), stopPaidPlansCoveredBy: vi.fn() }))

const accountWith = (status: string) => ({ id: 'acct_1', configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status } } } } } })

function seed(over: Row = {}) {
  db.profile = { ownerUserId: 'u1', stripeAccountId: 'acct_1', w9Status: 'verified', stripeTransfersStatus: 'active' }
  db.payouts = new Map([['po_1', { id: 'po_1', ownerUserId: 'u1', partnerCodeId: 'pc1', periodMonth: '2026-10', totalCents: 3512, status: 'pending_review', approvedAt: null, approvedBy: null, transferError: null, transferAttempts: 0, ...over }]])
  db.entries = [{ payoutId: 'po_1', status: 'accrued', flagged: false }]
}

describe('transfersStatusOf', () => {
  it('reads only the v2 recipient capability path', async () => {
    const { transfersStatusOf } = await import('@/lib/partner-codes/connect')
    expect(transfersStatusOf(accountWith('active') as never)).toBe('active')
    expect(transfersStatusOf({ id: 'a', payouts_enabled: true } as never)).toBe('none')
  })
})

describe('payPayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seed()
  })

  it('sends the statement as a transfer keyed on the payout id + attempt, then marks it and its entries paid', async () => {
    stripe.v2.core.accounts.retrieve.mockResolvedValue(accountWith('active'))
    stripe.transfers.create.mockResolvedValue({ id: 'tr_1' })
    const { payPayout } = await import('@/lib/partner-codes/jobs')
    const out = await payPayout('po_1', 'admin', 'admin-1')
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3512, currency: 'usd', destination: 'acct_1' }),
      { idempotencyKey: 'partner-payout-po_1-a0' },
    )
    expect(stripe.transfers.create.mock.calls[0][0]).toMatchObject({ transfer_group: 'partner-payout-po_1' })
    expect(out).toMatchObject({ status: 'paid', method: 'stripe_connect', externalRef: 'tr_1', transferError: null })
    expect(db.entries[0].status).toBe('paid')
  })

  it('re-checks readiness first: an account that is no longer active gets nothing', async () => {
    stripe.v2.core.accounts.retrieve.mockResolvedValue(accountWith('restricted'))
    const { payPayout } = await import('@/lib/partner-codes/jobs')
    const out = await payPayout('po_1', 'admin')
    expect(stripe.transfers.create).not.toHaveBeenCalled()
    expect(out).toMatchObject({ status: 'approved' })
    expect(out.transferError).toMatch(/isn't active/)
  })

  it('a failed transfer is kept for a retry, never marked paid, and never shows Stripe’s own text', async () => {
    stripe.v2.core.accounts.retrieve.mockResolvedValue(accountWith('active'))
    stripe.transfers.create.mockRejectedValue(Object.assign(new Error('Invalid API Key provided: sk_live_secret'), { code: 'api_key_expired' }))
    const { payPayout } = await import('@/lib/partner-codes/jobs')
    const out = await payPayout('po_1', 'admin')
    expect(out.status).toBe('approved')
    expect(out.transferError).toContain('api_key_expired')
    expect(out.transferError).not.toContain('sk_live')
    expect(db.entries[0].status).toBe('accrued')
  })

  it('names an empty platform balance so the admin knows to retry later', async () => {
    stripe.v2.core.accounts.retrieve.mockResolvedValue(accountWith('active'))
    stripe.transfers.create.mockRejectedValue(Object.assign(new Error('x'), { code: 'balance_insufficient' }))
    const { payPayout } = await import('@/lib/partner-codes/jobs')
    expect((await payPayout('po_1', 'admin')).transferError).toMatch(/Not enough available balance/)
  })

  it('a held statement is never sent', async () => {
    seed({ status: 'held' })
    const { payPayout } = await import('@/lib/partner-codes/jobs')
    await expect(payPayout('po_1', 'admin')).rejects.toThrow(/hold/)
    expect(stripe.transfers.create).not.toHaveBeenCalled()
  })
})

describe('retrying a failed statement (found by the sandbox drill)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seed()
    stripe.v2.core.accounts.retrieve.mockResolvedValue(accountWith('active'))
  })

  it('a definite refusal moves the next retry to a fresh key, so Stripe does not replay the failure', async () => {
    stripe.transfers.create.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'balance_insufficient', type: 'StripeInvalidRequestError' }))
    stripe.transfers.create.mockResolvedValueOnce({ id: 'tr_ok' })
    const { payPayout } = await import('@/lib/partner-codes/jobs')
    expect((await payPayout('po_1', 'admin')).status).toBe('approved')
    expect(db.payouts.get('po_1')!.transferAttempts).toBe(1)
    expect((await payPayout('po_1', 'admin')).status).toBe('paid')
    expect(stripe.transfers.create.mock.calls.map((c) => c[1].idempotencyKey)).toEqual(['partner-payout-po_1-a0', 'partner-payout-po_1-a1'])
  })

  it('an uncertain failure (connection error) keeps the same key, so a retry cannot make a second transfer', async () => {
    stripe.transfers.create.mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' }))
    const { payPayout } = await import('@/lib/partner-codes/jobs')
    await payPayout('po_1', 'admin')
    expect(db.payouts.get('po_1')!.transferAttempts).toBe(0)
  })

  it('if a transfer already exists for the statement, it is recorded as paid and nothing new is sent', async () => {
    stripe.transfers.list.mockResolvedValueOnce({ data: [{ id: 'tr_earlier', reversed: false }] })
    const { payPayout } = await import('@/lib/partner-codes/jobs')
    expect(await payPayout('po_1', 'admin')).toMatchObject({ status: 'paid', externalRef: 'tr_earlier' })
    expect(stripe.transfers.create).not.toHaveBeenCalled()
  })

  it('refusals before Stripe is called (not ready) never use up an attempt', async () => {
    stripe.v2.core.accounts.retrieve.mockResolvedValue(accountWith('pending'))
    const { payPayout } = await import('@/lib/partner-codes/jobs')
    await payPayout('po_1', 'admin')
    expect(db.payouts.get('po_1')!.transferAttempts).toBe(0)
  })
})

describe('setPayoutStatus approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seed()
  })

  it('on Stripe Connect, approving sends', async () => {
    stripe.v2.core.accounts.retrieve.mockResolvedValue(accountWith('active'))
    stripe.transfers.create.mockResolvedValue({ id: 'tr_9' })
    const { setPayoutStatus } = await import('@/lib/partner-codes/jobs')
    expect(await setPayoutStatus('po_1', 'approve', 'admin-1')).toMatchObject({ status: 'paid', externalRef: 'tr_9' })
  })

  it('without a payout account or W-9, approval is refused', async () => {
    db.profile = null
    const { setPayoutStatus } = await import('@/lib/partner-codes/jobs')
    await expect(setPayoutStatus('po_1', 'approve', 'admin-1')).rejects.toThrow(/payout setup/)
  })
})

describe('autoSendSmallPayouts (the optional "send without approval" setting)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seed()
    stripe.v2.core.accounts.retrieve.mockResolvedValue(accountWith('active'))
    stripe.transfers.create.mockResolvedValue({ id: 'tr_auto' })
  })

  it('is off at 0', async () => {
    const { autoSendSmallPayouts } = await import('@/lib/partner-codes/jobs')
    expect(await autoSendSmallPayouts(0)).toBe(0)
    expect(stripe.transfers.create).not.toHaveBeenCalled()
  })

  it('sends statements under the cap and leaves bigger ones for the admin', async () => {
    const { autoSendSmallPayouts } = await import('@/lib/partner-codes/jobs')
    expect(await autoSendSmallPayouts(3000)).toBe(0) // $35.12 is over a $30 cap
    expect(await autoSendSmallPayouts(5000)).toBe(1)
    expect(db.payouts.get('po_1')).toMatchObject({ status: 'paid', approvedBy: 'auto' })
  })

  it('never auto-sends a statement that touches a flagged subscriber', async () => {
    db.entries[0].flagged = true
    const { autoSendSmallPayouts } = await import('@/lib/partner-codes/jobs')
    expect(await autoSendSmallPayouts(5000)).toBe(0)
    expect(stripe.transfers.create).not.toHaveBeenCalled()
  })
})
