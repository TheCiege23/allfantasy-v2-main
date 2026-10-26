/**
 * Google Play Developer API (androidpublisher v3) — the purchase calls the
 * billing flow needs, and nothing else.
 *
 * Every entitlement decision is made from what THESE calls return, never from
 * what the app or the browser claims: a purchase token is only a lookup key.
 *
 * The service account must be invited in Play Console with "View financial
 * data, orders and cancellation survey responses" and "Manage orders and
 * subscriptions", or Google answers 401/403 here.
 *
 * ⚠ A PURCHASE TOKEN IS A BEARER CREDENTIAL FOR THAT PURCHASE. It goes in the
 * URL path because that is the API's shape, so error messages below carry the
 * HTTP status and the product id only — never the URL.
 */

import {
  fetchWithTimeout,
  getGoogleAccessToken,
  parseServiceAccount,
  type ServiceAccount,
} from "@/lib/google-play/serviceAccountAuth"

const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
const SCOPE = "https://www.googleapis.com/auth/androidpublisher"
const DEFAULT_PACKAGE_NAME = "ai.allfantasy.app"

export type PlayBillingConfig = { serviceAccount: ServiceAccount; packageName: string }

export class PlayApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export function readPlayBillingConfig(
  env: Record<string, string | undefined> = process.env,
): PlayBillingConfig | null {
  const raw = env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) return null
  const serviceAccount = parseServiceAccount(raw)
  if (!serviceAccount) return null
  return { serviceAccount, packageName: env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || DEFAULT_PACKAGE_NAME }
}

export function playBillingConfigured(): boolean {
  return readPlayBillingConfig() !== null
}

/** subscriptionsv2 resource, trimmed to the fields we read. */
export type PlaySubscriptionPurchase = {
  subscriptionState?: string
  acknowledgementState?: string
  latestOrderId?: string
  linkedPurchaseToken?: string
  startTime?: string
  testPurchase?: Record<string, unknown>
  lineItems?: Array<{
    productId?: string
    expiryTime?: string
    autoRenewingPlan?: { autoRenewEnabled?: boolean }
  }>
}

/** purchases.products resource, trimmed to the fields we read. */
export type PlayProductPurchase = {
  /** 0 purchased, 1 canceled, 2 pending. */
  purchaseState?: number
  /** 0 not consumed, 1 consumed. */
  consumptionState?: number
  /** 0 not acknowledged, 1 acknowledged. */
  acknowledgementState?: number
  orderId?: string
  /** Present and 0 for license-tester purchases. */
  purchaseType?: number
  quantity?: number
  purchaseTimeMillis?: string
}

async function call<T>(
  config: PlayBillingConfig,
  path: string,
  method: "GET" | "POST",
  what: string,
): Promise<T> {
  const token = await getGoogleAccessToken(config.serviceAccount, SCOPE)
  const res = await fetchWithTimeout(`${API}/${encodeURIComponent(config.packageName)}/purchases/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
    ...(method === "POST" ? { body: "{}" } : {}),
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new PlayApiError(`Google Play refused ${what}. Check the service account's Play Console permissions.`, res.status)
    }
    if (res.status === 404 || res.status === 410) {
      throw new PlayApiError(`Google Play does not know this purchase (${what}).`, res.status)
    }
    throw new PlayApiError(`Google Play ${what} failed (HTTP ${res.status})`, res.status)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

const enc = encodeURIComponent

export function getSubscriptionPurchase(config: PlayBillingConfig, purchaseToken: string) {
  return call<PlaySubscriptionPurchase>(config, `subscriptionsv2/tokens/${enc(purchaseToken)}`, "GET", "subscription lookup")
}

export function acknowledgeSubscription(config: PlayBillingConfig, productId: string, purchaseToken: string) {
  return call<Record<string, never>>(
    config,
    `subscriptions/${enc(productId)}/tokens/${enc(purchaseToken)}:acknowledge`,
    "POST",
    `acknowledge of ${productId}`,
  )
}

export function getProductPurchase(config: PlayBillingConfig, productId: string, purchaseToken: string) {
  return call<PlayProductPurchase>(config, `products/${enc(productId)}/tokens/${enc(purchaseToken)}`, "GET", `lookup of ${productId}`)
}

/** Consuming also acknowledges, and lets the user buy the same pack again. */
export function consumeProduct(config: PlayBillingConfig, productId: string, purchaseToken: string) {
  return call<Record<string, never>>(
    config,
    `products/${enc(productId)}/tokens/${enc(purchaseToken)}:consume`,
    "POST",
    `consume of ${productId}`,
  )
}
