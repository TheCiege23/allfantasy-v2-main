import "server-only"
import { playBillingCatalog, PLAY_PACKAGE } from "./billingCatalog"
import { playCheckoutEnabled, PlayBillingError, playServerConfigured, playServiceAccount } from "./billingConfig"
import { publisherRequest } from "./billingPublisher"

type Money = { currencyCode?: string; units?: string; nanos?: number }
export function playMoneyCents(money: Money | undefined): number | null {
  if (money?.currencyCode !== "USD" || !/^-?\d+$/.test(money.units ?? "")) return null
  const nanos = money.nanos ?? 0, cents = Number(money.units) * 100 + nanos / 10_000_000
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null
}
export type PlayCatalogCheck = { productId: string; ok: boolean; issues: string[]; expectedUsdCents: number; actualUsdCents: number | null }
export function inspectPlayCatalogProduct(item: ReturnType<typeof playBillingCatalog>[number], value: unknown, offers: unknown = {}): PlayCatalogCheck {
  const data = value as Record<string, any>, issues: string[] = [], expectedUsdCents = Math.round(item.amountUsd * 100)
  if (!data || data.productId !== item.productId || data.packageName !== PLAY_PACKAGE) issues.push("Product identity does not match the app catalog")
  let actualUsdCents: number | null = null
  if (item.type === "subscription") {
    const active = (Array.isArray(data?.basePlans) ? data.basePlans : []).filter((p: any) => p.state === "ACTIVE")
    if (active.length !== 1 || active[0]?.basePlanId !== "standard") issues.push("Exactly one active standard base plan is required")
    const plan = active.find((p: any) => p.basePlanId === "standard")
    if (plan?.autoRenewingBasePlanType?.billingPeriodDuration !== (item.interval === "month" ? "P1M" : "P1Y")) issues.push("Subscription billing interval does not match")
    const us = plan?.regionalConfigs?.find((r: any) => r.regionCode === "US")
    actualUsdCents = playMoneyCents(us?.price)
    if (us?.newSubscriberAvailability !== true) issues.push("US subscription availability is disabled")
    const o = offers as { subscriptionOffers?: Array<{ state?: string }>; nextPageToken?: string }
    if (o.nextPageToken || o.subscriptionOffers?.some(x => x.state === "ACTIVE")) issues.push("Active introductory offers are unsupported by this TWA checkout")
  } else {
    const active = (Array.isArray(data?.purchaseOptions) ? data.purchaseOptions : []).filter((p: any) => p.state === "ACTIVE")
    if (active.length !== 1 || !active[0]?.buyOption || active[0]?.rentOption) issues.push("Exactly one active buy option is required")
    const option = active[0]
    if (option?.buyOption?.multiQuantityEnabled === true) issues.push("Disable multi-quantity for token packs")
    const us = option?.regionalPricingAndAvailabilityConfigs?.find((r: any) => r.regionCode === "US")
    actualUsdCents = playMoneyCents(us?.price)
    if (us?.availability !== "AVAILABLE") issues.push("US token pack availability is disabled")
  }
  if (actualUsdCents !== expectedUsdCents) issues.push("US price does not match the central catalog")
  return { productId: item.productId, ok: issues.length === 0, issues, expectedUsdCents, actualUsdCents }
}

/** Operator-only read check; no purchase, acknowledgment, consume, refund or configuration writes. */
export async function checkGooglePlayReadiness(read: (path: string) => Promise<unknown> = publisherRequest) {
  const identity = (() => { try { const { email, projectId } = playServiceAccount(); return { email, projectId } } catch { return null } })()
  const notifications = { audience: process.env.GOOGLE_PLAY_RTDN_AUDIENCE || null,
    serviceAccountEmail: process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL || null,
    subscription: process.env.GOOGLE_PLAY_PUBSUB_SUBSCRIPTION || null }
  const products: PlayCatalogCheck[] = []
  let providerFailure: { status: number | null; reason: string | null } | null = null
  if (identity) for (const item of playBillingCatalog()) {
    try {
      const id = encodeURIComponent(item.productId)
      const body = await read(`${item.type === "subscription" ? "subscriptions" : "oneTimeProducts"}/${id}`)
      const offers = item.type === "subscription" ? await read(`subscriptions/${id}/basePlans/standard/offers?pageSize=100`) : {}
      products.push(inspectPlayCatalogProduct(item, body, offers))
    } catch (error) {
      const status = error instanceof PlayBillingError ? error.providerStatus ?? null : null
      const reason = error instanceof PlayBillingError ? error.providerReason ?? null : null
      products.push({ productId: item.productId, ok: false, issues: [status === 404 ? "Product or standard base plan not found" : "Publisher API access could not be verified"], expectedUsdCents: Math.round(item.amountUsd * 100), actualUsdCents: null })
      providerFailure = { status, reason }
      if (status === 401 || status === 403 || status === null) break
    }
  }
  return { packageName: PLAY_PACKAGE, serviceAccount: identity, receiptProtectionConfigured: playServerConfigured(),
    publicCheckoutEnabled: playCheckoutEnabled(), notifications,
    notificationSettingsPresent: Object.values(notifications).every(Boolean), providerFailure,
    catalogVerified: products.length === 11 && products.every(p => p.ok), products }
}
