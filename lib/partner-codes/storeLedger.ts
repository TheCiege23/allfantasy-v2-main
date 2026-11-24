import 'server-only'
import { prisma } from '@/lib/prisma'
import { getMonetizationCatalogItemBySku, type MonetizationSku } from '@/lib/monetization/catalog'
import { isPartnerCodesEnabled } from './flags'
import { attachReferral, findPartnerCode, loadPartnerSettings } from './service'
import { markReferralForInvoice, recordPartnerPayment, reversePaymentCommission } from './ledger'

/**
 * Commissioner Partner Codes — App Store and Google Play subscribers.
 *
 * Who brought a subscriber is known from their AllFantasy account (the /with link at signup,
 * or a code typed in the app), exactly as on the web: Apple's `appAccountToken` and Google's
 * purchase owner are that account. So commissioners earn on app subscribers with no store
 * setup at all. The friend DISCOUNT on the stores is separate (Apple offer codes / Play promo
 * codes) and not required for any of this.
 *
 * Commission is 10% of what the store pays us: the price the subscriber paid, minus the store's
 * cut (PartnerProgramSettings.storeFeePercent, 15% by default: Small Business Program / year-2
 * subscriptions on Apple, every subscription on Google).
 *
 * Every function here is called AFTER the store purchase has been applied, never throws, and is
 * off unless PARTNER_CODES_ENABLED=1. Twice-delivered notifications are harmless: the payment id
 * (Apple transaction id / Google order id) is the ledger's no-double-pay key.
 */

const APPLE_OFFER_CODE = 3 // OfferType: 1 introductory, 2 promotional, 3 offer code, 4 win-back

function subscriptionItem(sku: string) {
  const item = getMonetizationCatalogItemBySku(sku as MonetizationSku)
  return item && item.type === 'subscription' && item.interval ? item : null
}

/**
 * The price a store says was paid, in US cents. Apple reports milliunits in the buyer's currency;
 * outside USD we fall back to the catalog's USD price rather than guess an exchange rate.
 */
export function storeGrossCents(args: { priceMilliunits?: number | null; currency?: string | null; catalogUsd: number }): number {
  if (args.currency?.toUpperCase() === 'USD' && typeof args.priceMilliunits === 'number' && args.priceMilliunits >= 0) {
    return Math.round(args.priceMilliunits / 10)
  }
  return Math.round(args.catalogUsd * 100)
}

async function quiet<T>(label: string, fn: () => Promise<T>): Promise<T | 'error' | null> {
  if (!isPartnerCodesEnabled()) return null
  try {
    return await fn()
  } catch (error) {
    console.error(`[partner-codes] ${label} failed`, (error as Error)?.message)
    return 'error'
  }
}

// ---------------------------------------------------------------------------
// Apple
// ---------------------------------------------------------------------------

export type AppleTxn = {
  transactionId?: string
  originalTransactionId?: string
  productId?: string
  appAccountToken?: string
  purchaseDate?: number
  price?: number
  currency?: string
  offerType?: number | string
  offerIdentifier?: string
  revocationDate?: number
}

const APPLE_PAYMENT_TYPES = new Set(['SUBSCRIBED', 'DID_RENEW', 'DID_RECOVER', 'OFFER_REDEEMED'])

export function onPartnerAppleNotification(notificationType: string, tx: AppleTxn) {
  return quiet('apple notification', async () => {
    const item = tx.productId ? subscriptionItem(tx.productId) : null
    const userId = tx.appAccountToken?.toLowerCase()
    if (!item || !userId || !tx.transactionId) return 'ignored'

    if (APPLE_PAYMENT_TYPES.has(notificationType)) {
      if (tx.revocationDate) return 'revoked'
      // Redeemed one of our offer codes in Apple's own sheet without telling us first: the code
      // IS the commissioner's (custom codes are app-unique), so attach them here.
      if (Number(tx.offerType) === APPLE_OFFER_CODE && tx.offerIdentifier) {
        const code = await findPartnerCode(tx.offerIdentifier)
        if (code) await attachReferral({ userId, rawCode: code.code })
      }
      const s = await loadPartnerSettings()
      const gross = storeGrossCents({ priceMilliunits: tx.price, currency: tx.currency, catalogUsd: item.amountUsd })
      return recordPartnerPayment({
        userId,
        source: 'apple',
        sourceRef: tx.transactionId,
        paidAt: new Date(tx.purchaseDate ?? Date.now()),
        grossCents: gross,
        feeCents: Math.round((gross * s.storeFeePercent) / 100),
        planFamily: item.planFamily,
        interval: item.interval!,
        platform: 'ios',
        storeSubscriptionRef: tx.originalTransactionId,
      })
    }
    if (notificationType === 'REFUND' || notificationType === 'REVOKE') {
      return reversePaymentCommission('apple', tx.transactionId, `apple-refund:${tx.transactionId}`, 1, 'refunded')
    }
    if (notificationType === 'EXPIRED' || notificationType === 'GRACE_PERIOD_EXPIRED') {
      return endStoreSubscription(tx.originalTransactionId)
    }
    return 'ignored'
  })
}

// ---------------------------------------------------------------------------
// Google Play
// ---------------------------------------------------------------------------

export function onPartnerPlayPurchase(args: {
  ownerId: string | null
  sku: string
  purchaseType: string
  tokenHash: string
  status: string
  orderId: string | null
  start: Date | null
  revoked: boolean
}) {
  return quiet('google play purchase', async () => {
    if (!args.ownerId || args.purchaseType !== 'subscription') return 'ignored'
    const item = subscriptionItem(args.sku)
    if (!item) return 'ignored'
    if (args.status === 'expired' || args.revoked) return endStoreSubscription(args.tokenHash)
    if ((args.status !== 'active' && args.status !== 'grace' && args.status !== 'canceled') || !args.orderId) return 'not_paid'
    // Play's v2 state carries the latest successful ORDER, not its price, so the catalog price is
    // used. A promo-code discount therefore pays the commissioner slightly more than the friend paid.
    const s = await loadPartnerSettings()
    const gross = Math.round(item.amountUsd * 100)
    return recordPartnerPayment({
      userId: args.ownerId,
      source: 'google',
      sourceRef: args.orderId,
      // A renewal order id is seen when we sync, close to when it was charged.
      paidAt: new Date(),
      grossCents: gross,
      feeCents: Math.round((gross * s.storeFeePercent) / 100),
      planFamily: item.planFamily,
      interval: item.interval!,
      platform: 'android',
      storeSubscriptionRef: args.tokenHash,
    })
  })
}

export function onPartnerPlayVoided(orderId: string | null | undefined) {
  return quiet('google play voided', async () => {
    if (!orderId) return 'ignored'
    const r = await reversePaymentCommission('google', orderId, `play-voided:${orderId}`, 1, 'refunded')
    if (r === 'no_commission') await markReferralForInvoice(orderId, 'refunded')
    return r
  })
}

// ---------------------------------------------------------------------------

/** A store subscription ended: the subscriber stops counting as paying. Paid periods stay paid. */
async function endStoreSubscription(storeRef: string | null | undefined) {
  if (!storeRef) return 'ignored'
  const res = await prisma.partnerReferral.updateMany({
    where: { storeOriginalTxnId: storeRef, status: { in: ['pending', 'qualified'] } },
    data: { currentlyPaying: false, status: 'churned', churnedAt: new Date() },
  })
  return res.count ? 'churned' : 'not_referred'
}
