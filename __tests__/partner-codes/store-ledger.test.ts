import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * App Store and Google Play subscribers earn their commissioner commission exactly like web ones:
 * 10% of what the store pays us (price minus the store's 15%), refunds reverse it, an ended
 * subscription stops counting, and it is all off unless PARTNER_CODES_ENABLED=1.
 */

vi.mock('server-only', () => ({}))

const recordPartnerPayment = vi.fn(async (_p: Record<string, unknown>) => 'accrued')
const reversePaymentCommission = vi.fn(async (..._a: unknown[]) => 'reversed')
const markReferralForInvoice = vi.fn(async (..._a: unknown[]) => undefined)
vi.mock('@/lib/partner-codes/ledger', () => ({ recordPartnerPayment, reversePaymentCommission, markReferralForInvoice }))

const attachReferral = vi.fn(async (..._a: unknown[]) => ({ ok: true }))
const findPartnerCode = vi.fn(async (raw: string) => (raw.toUpperCase() === 'THECIEGE' ? { id: 'pc1', code: 'TheCiege' } : null))
vi.mock('@/lib/partner-codes/service', async () => {
  const { DEFAULT_PARTNER_SETTINGS } = await import('@/lib/partner-codes/settings')
  return { attachReferral, findPartnerCode, loadPartnerSettings: async () => DEFAULT_PARTNER_SETTINGS }
})

const updateMany = vi.fn(async (..._a: unknown[]) => ({ count: 1 }))
vi.mock('@/lib/prisma', () => ({ prisma: { partnerReferral: { updateMany } } }))

const USER = '6f1c2b0e-1111-4c4c-9999-abcdefabcdef'
const tx = (over: Record<string, unknown> = {}) => ({
  transactionId: 't_100', originalTransactionId: 'o_1', productId: 'af_supreme_monthly', appAccountToken: USER.toUpperCase(),
  purchaseDate: Date.parse('2026-11-20T00:00:00Z'), price: 19990, currency: 'USD', ...over,
})

describe('Apple', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PARTNER_CODES_ENABLED = '1'
  })

  it('a renewal earns on $19.99 minus Apple’s 15%, keyed on the transaction id', async () => {
    const { onPartnerAppleNotification } = await import('@/lib/partner-codes/storeLedger')
    expect(await onPartnerAppleNotification('DID_RENEW', tx())).toBe('accrued')
    expect(recordPartnerPayment).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER, source: 'apple', sourceRef: 't_100', grossCents: 1999, feeCents: 300, planFamily: 'af_supreme', interval: 'month', platform: 'ios', storeSubscriptionRef: 'o_1',
    }))
  })

  it('outside USD it uses the catalog price instead of guessing an exchange rate', async () => {
    const { onPartnerAppleNotification } = await import('@/lib/partner-codes/storeLedger')
    await onPartnerAppleNotification('SUBSCRIBED', tx({ price: 21990, currency: 'EUR', productId: 'af_pro_yearly' }))
    expect(recordPartnerPayment).toHaveBeenCalledWith(expect.objectContaining({ grossCents: 7999, interval: 'year' }))
  })

  it('a commissioner’s offer code redeemed in Apple’s sheet attaches the subscriber to them', async () => {
    const { onPartnerAppleNotification } = await import('@/lib/partner-codes/storeLedger')
    await onPartnerAppleNotification('SUBSCRIBED', tx({ offerType: 3, offerIdentifier: 'theciege', price: 17990 }))
    expect(attachReferral).toHaveBeenCalledWith({ userId: USER, rawCode: 'TheCiege' })
    expect(recordPartnerPayment).toHaveBeenCalledWith(expect.objectContaining({ grossCents: 1799 }))
  })

  it('a refund reverses that transaction’s commission', async () => {
    const { onPartnerAppleNotification } = await import('@/lib/partner-codes/storeLedger')
    await onPartnerAppleNotification('REFUND', tx())
    expect(reversePaymentCommission).toHaveBeenCalledWith('apple', 't_100', 'apple-refund:t_100', 1, 'refunded')
    expect(recordPartnerPayment).not.toHaveBeenCalled()
  })

  it('an expired subscription stops counting as paying', async () => {
    const { onPartnerAppleNotification } = await import('@/lib/partner-codes/storeLedger')
    expect(await onPartnerAppleNotification('EXPIRED', tx())).toBe('churned')
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ storeOriginalTxnId: 'o_1' }) }))
  })

  it('does nothing with the flag off, and never throws into the Apple route', async () => {
    const { onPartnerAppleNotification } = await import('@/lib/partner-codes/storeLedger')
    delete process.env.PARTNER_CODES_ENABLED
    expect(await onPartnerAppleNotification('DID_RENEW', tx())).toBeNull()
    expect(recordPartnerPayment).not.toHaveBeenCalled()
    process.env.PARTNER_CODES_ENABLED = '1'
    recordPartnerPayment.mockRejectedValueOnce(new Error('db down'))
    expect(await onPartnerAppleNotification('DID_RENEW', tx())).toBe('error')
  })
})

describe('Google Play', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PARTNER_CODES_ENABLED = '1'
  })
  const play = (over: Record<string, unknown> = {}) => ({
    ownerId: USER, sku: 'af_commissioner_monthly', purchaseType: 'subscription', tokenHash: 'h_1', status: 'active', orderId: 'GPA.1-2-3..0', start: new Date(), revoked: false, ...over,
  })

  it('a new order is a payment at the catalog price minus Google’s 15%', async () => {
    const { onPartnerPlayPurchase } = await import('@/lib/partner-codes/storeLedger')
    await onPartnerPlayPurchase(play())
    expect(recordPartnerPayment).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER, source: 'google', sourceRef: 'GPA.1-2-3..0', grossCents: 1499, feeCents: 225, platform: 'android', storeSubscriptionRef: 'h_1',
    }))
  })

  it('an expired subscription stops counting; token packs are ignored', async () => {
    const { onPartnerPlayPurchase } = await import('@/lib/partner-codes/storeLedger')
    expect(await onPartnerPlayPurchase(play({ status: 'expired' }))).toBe('churned')
    expect(await onPartnerPlayPurchase(play({ purchaseType: 'token_pack' }))).toBe('ignored')
    expect(recordPartnerPayment).not.toHaveBeenCalled()
  })

  it('a voided order reverses its commission', async () => {
    const { onPartnerPlayVoided } = await import('@/lib/partner-codes/storeLedger')
    await onPartnerPlayVoided('GPA.1-2-3..0')
    expect(reversePaymentCommission).toHaveBeenCalledWith('google', 'GPA.1-2-3..0', 'play-voided:GPA.1-2-3..0', 1, 'refunded')
  })
})

describe('storeGrossCents', () => {
  it('reads Apple milliunits in USD, falls back to the catalog otherwise', async () => {
    const { storeGrossCents } = await import('@/lib/partner-codes/storeLedger')
    expect(storeGrossCents({ priceMilliunits: 9990, currency: 'usd', catalogUsd: 9.99 })).toBe(999)
    expect(storeGrossCents({ priceMilliunits: 9990, currency: 'GBP', catalogUsd: 9.99 })).toBe(999)
    expect(storeGrossCents({ priceMilliunits: undefined, currency: 'USD', catalogUsd: 14.99 })).toBe(1499)
  })
})
