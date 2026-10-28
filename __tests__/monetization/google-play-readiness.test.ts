// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { inspectPlayCatalogProduct, playMoneyCents, checkGooglePlayReadiness } from "@/lib/google-play/billingReadiness"
import { playBillingCatalog, PLAY_PACKAGE } from "@/lib/google-play/billingCatalog"
import { PlayBillingError } from "@/lib/google-play/billingConfig"
const all = playBillingCatalog(), monthly = all.find(p => p.sku === "af_pro_monthly")!, pack = all.find(p => p.sku === "af_tokens_5")!
function fixture(item = monthly): any {
  const price = { currencyCode: "USD", units: String(Math.floor(item.amountUsd)), nanos: Math.round((item.amountUsd % 1) * 100) * 10_000_000 }
  return item.type === "subscription" ? { productId: item.productId, packageName: PLAY_PACKAGE, basePlans: [{ basePlanId: "standard", state: "ACTIVE", autoRenewingBasePlanType: { billingPeriodDuration: item.interval === "month" ? "P1M" : "P1Y" }, regionalConfigs: [{ regionCode: "US", newSubscriberAvailability: true, price }] }] } :
    { productId: item.productId, packageName: PLAY_PACKAGE, purchaseOptions: [{ purchaseOptionId: "standard", state: "ACTIVE", buyOption: { multiQuantityEnabled: false }, regionalPricingAndAvailabilityConfigs: [{ regionCode: "US", availability: "AVAILABLE", price }] }] }
}
afterEach(() => vi.unstubAllEnvs())
describe("Play operator readiness checks", () => {
  it("compares exact cents without rounding a different price", () => {
    expect(playMoneyCents({ currencyCode: "USD", units: "9", nanos: 990000000 })).toBe(999)
    expect(playMoneyCents({ currencyCode: "USD", units: "9", nanos: 990000001 })).toBeNull()
    expect(playMoneyCents({ currencyCode: "EUR", units: "9" })).toBeNull()
  })
  it.each(all)("accepts the matching active product $productId", item => expect(inspectPlayCatalogProduct(item, fixture(item))).toMatchObject({ ok: true, actualUsdCents: Math.round(item.amountUsd * 100) }))
  it("rejects a different interval, inactive product and wrong app", () => {
    const body = fixture(); body.basePlans[0].autoRenewingBasePlanType.billingPeriodDuration = "P1Y"; body.packageName = "other.app"; body.basePlans[0].state = "DRAFT"
    expect(inspectPlayCatalogProduct(monthly, body).ok).toBe(false)
  })
  it("rejects ambiguous plans and active introductory offers", () => {
    const body = fixture(); body.basePlans.push({ ...body.basePlans[0], basePlanId: "second" })
    expect(inspectPlayCatalogProduct(monthly, body).ok).toBe(false)
    expect(inspectPlayCatalogProduct(monthly, fixture(), { subscriptionOffers: [{ state: "ACTIVE" }] }).ok).toBe(false)
  })
  it("rejects multi-quantity packs and a one-cent price difference", () => {
    const body = fixture(pack); body.purchaseOptions[0].buyOption.multiQuantityEnabled = true
    body.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[0].price.nanos = 980000000
    expect(inspectPlayCatalogProduct(pack, body)).toMatchObject({ ok: false, actualUsdCents: 498 })
  })
  it("reports missing configuration without touching Google", async () => {
    vi.stubEnv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", ""); vi.stubEnv("GOOGLE_PLAY_BILLING_SERVICE_ACCOUNT_JSON", "")
    const read = vi.fn()
    expect(await checkGooglePlayReadiness(read)).toMatchObject({ serviceAccount: null, catalogVerified: false })
    expect(read).not.toHaveBeenCalled()
  })
  it("reports a permission blocker without exposing provider bodies or private keys", async () => {
    vi.stubEnv("GOOGLE_PLAY_BILLING_SERVICE_ACCOUNT_JSON", JSON.stringify({ client_email: "billing@test.iam.gserviceaccount.com", private_key: "private-test-key", project_id: "test-project" }))
    const read = vi.fn(async () => { throw new PlayBillingError("private provider details", 502, 403, "SERVICE_DISABLED") })
    const report = await checkGooglePlayReadiness(read)
    expect(report.providerFailure).toEqual({ status: 403, reason: "SERVICE_DISABLED" })
    expect(read).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(report)).not.toContain("private-test-key")
    expect(JSON.stringify(report)).not.toContain("private provider details")
  })
})
