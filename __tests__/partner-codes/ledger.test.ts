import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Stripe side of the ledger, against an in-memory stand-in for the four
 * tables it touches. Proves the two properties that cost money if wrong:
 * a re-delivered invoice never pays twice, and nothing earns before cash unlocks.
 */

vi.mock('server-only', () => ({}))

type Ref = Record<string, any>
const db = {
  referral: null as Ref | null,
  entries: [] as Ref[],
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    partnerProgramSettings: { upsert: vi.fn(async () => ({ id: 'singleton', commissionBasis: 'net' })) },
    partnerReferral: {
      findUnique: vi.fn(async () => (db.referral ? { ...db.referral, partnerCode: db.referral.partnerCode } : null)),
      count: vi.fn(async () => 0),
      update: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const r = db.referral!
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'push' in v) r[k] = [...r[k], v.push]
          else if (v && typeof v === 'object' && 'increment' in v) r[k] = (r[k] ?? 0) + v.increment
          else r[k] = v
        }
        return r
      }),
    },
    partnerCommissionEntry: {
      createMany: vi.fn(async ({ data }: { data: Ref[] }) => {
        let count = 0
        for (const e of data) {
          const dupe = db.entries.some((x) => x.source === e.source && x.sourceRef === e.sourceRef && x.installment === e.installment)
          if (!dupe) { db.entries.push(e); count++ }
        }
        return { count }
      }),
    },
  },
}))

vi.mock('@/lib/subscription/webhookHandlers', () => ({
  invoiceSubscriptionId: () => 'sub_1',
  resolveUserIdFromStripeCustomerId: async () => 'friend-1',
}))

vi.mock('@/lib/monetization/catalog', () => ({
  getMonetizationCatalog: () => ({ subscriptions: [{ stripePriceEnvVar: 'STRIPE_PRICE_TEST_SUPREME', planFamily: 'af_supreme', interval: 'month' }] }),
}))

process.env.STRIPE_PRICE_TEST_SUPREME = 'price_supreme_m'

const stripe = {
  invoicePayments: { list: vi.fn(async () => ({ data: [{ status: 'paid', payment: { type: 'charge', charge: 'ch_1' } }] })) },
  paymentIntents: { retrieve: vi.fn() },
  charges: { retrieve: vi.fn(async () => ({ balance_transaction: { fee: 88 }, payment_method_details: { card: { fingerprint: 'fp_1' } } })) },
} as any

const invoice = (id: string, paidAtSec: number) =>
  ({
    id,
    amount_paid: 1999,
    customer: 'cus_1',
    created: paidAtSec,
    status_transitions: { paid_at: paidAtSec },
    lines: { data: [{ pricing: { price_details: { price: 'price_supreme_m' } } }] },
  }) as any

describe('recordPartnerInvoicePaid', () => {
  beforeEach(() => {
    db.entries = []
    db.referral = {
      id: 'ref_1',
      partnerCodeId: 'code_1',
      status: 'pending',
      flagReasons: [],
      seenPaymentRefs: [],
      paidInvoiceCount: 0,
      commissionMonths: 0,
      firstPaidAt: null,
      cardFingerprint: null,
      plan: null,
      partnerCode: { id: 'code_1', cashUnlockedAt: new Date('2026-10-01T00:00:00Z'), ownerUserId: 'owner-1' },
    }
  })

  it('accrues 10% of the net once, and a re-delivered invoice changes nothing', async () => {
    const { recordPartnerInvoicePaid } = await import('@/lib/partner-codes/ledger')
    const paid = Date.parse('2026-11-05T00:00:00Z') / 1000
    expect(await recordPartnerInvoicePaid(stripe, invoice('in_1', paid))).toBe('accrued')
    expect(await recordPartnerInvoicePaid(stripe, invoice('in_1', paid))).toBe('duplicate')
    expect(db.entries).toHaveLength(1)
    // $19.99 − $0.88 Stripe fee = $19.11; 10% = 191.1¢ = 191,100 millicents.
    expect(db.entries[0].commissionMillicents).toBe(191_100)
    expect(db.referral!.paidInvoiceCount).toBe(1)
  })

  it('a payment made before cash unlocked earns nothing, but still counts the subscriber', async () => {
    const { recordPartnerInvoicePaid } = await import('@/lib/partner-codes/ledger')
    const paid = Date.parse('2026-09-15T00:00:00Z') / 1000
    expect(await recordPartnerInvoicePaid(stripe, invoice('in_early', paid))).toBe('before_cash_unlocked')
    expect(db.entries).toHaveLength(0)
    expect(db.referral!.firstPaidAt).toBeInstanceOf(Date)
  })

  it('a rejected referral earns nothing', async () => {
    db.referral!.status = 'rejected'
    const { recordPartnerInvoicePaid } = await import('@/lib/partner-codes/ledger')
    expect(await recordPartnerInvoicePaid(stripe, invoice('in_2', Date.parse('2026-11-05T00:00:00Z') / 1000))).toBe('rejected')
    expect(db.entries).toHaveLength(0)
  })
})
