// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { syncGooglePlayPurchase, reverseVoidedPlayPack } from "@/lib/google-play/billingPurchases"
import { obfuscatedPlayAccountId, purchaseHash } from "@/lib/google-play/billingConfig"
import { cancelGooglePlayOnDelete } from "@/lib/google-play/billingCancellation"
import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"
import type { PlayPublisher } from "@/lib/google-play/billingPublisher"
const enabled = process.env.RUN_BILLING_LIFECYCLE_DB === "1"
if (enabled) for (const url of [process.env.DATABASE_URL, process.env.DIRECT_URL]) {
  const target = new URL(url || "http://invalid")
  if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/billing_lifecycle_20261026") throw Error("Play billing tests require the isolated local database")
}
const users: string[] = [], hashes: string[] = []
async function fixture(productId = "af_tokens_5") {
  const id = randomUUID(), token = `test-purchase-${randomUUID()}`
  await prisma.appUser.create({ data: { id, email: `${id}@play-billing.invalid`, username: `play-${id}` } }); users.push(id); hashes.push(purchaseHash(token))
  const intent = await prisma.googlePlayCheckoutIntent.create({ data: { userId: id, sku: productId, expiresAt: new Date(Date.now() + 86400_000) } })
  const body: any = productId === "af_tokens_5" ? { purchaseStateContext: { purchaseState: "PURCHASED" }, purchaseCompletionTime: new Date().toISOString(),
    productLineItem: [{ productId, productOfferDetails: { quantity: 1, refundableQuantity: 1, consumptionState: "CONSUMPTION_STATE_YET_TO_BE_CONSUMED" } }] } :
    { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", startTime: new Date().toISOString(), acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
      lineItems: [{ productId, expiryTime: new Date(Date.now() + 30 * 86400_000).toISOString(), autoRenewingPlan: { autoRenewEnabled: true }, offerDetails: { basePlanId: "standard" } }] }
  const publisher: PlayPublisher = { get: vi.fn(async () => structuredClone(body)), finish: vi.fn(async () => ({})) }
  return { id, token, intent, body, publisher, input: { token, productId, userId: id, intentId: intent.id } }
}
const wallet = (userId: string) => prisma.userTokenBalance.findUnique({ where: { userId } })
const access = (userId: string) => new EntitlementResolver().resolveSnapshot(userId, undefined, { strictReads: true })
describe.runIf(enabled)("Google Play lifecycle against ordinary PostgreSQL accounts", () => {
  beforeAll(() => vi.stubEnv("GOOGLE_PLAY_PURCHASE_ENCRYPTION_KEY", "bc".repeat(32)))
  afterEach(async () => {
    await prisma.googlePlayPurchase.deleteMany({ where: { tokenHash: { in: hashes.splice(0) } } })
    for (const id of users.splice(0)) { await prisma.googlePlayCheckoutIntent.deleteMany({ where: { userId: id } }); await prisma.appUser.delete({ where: { id } }) }
  })
  afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect() })
  it("concurrent receipt retries credit exactly one 250-token pack", async () => {
    const f = await fixture()
    await Promise.all(Array.from({ length: 5 }, () => syncGooglePlayPurchase(f.input, f.publisher)))
    expect(await wallet(f.id)).toMatchObject({ balance: 250, lifetimePurchased: 250 })
    expect(await prisma.tokenLedger.count({ where: { userId: f.id, sourceType: "google_play" } })).toBe(1)
    const row = await prisma.googlePlayPurchase.findUniqueOrThrow({ where: { tokenHash: purchaseHash(f.token) } })
    expect(row.ownerId).toBe(f.id); expect(row.tokenCiphertext).not.toContain(f.token)
  })
  it("fulfills durably before consume; failed consume can retry without new credit", async () => {
    const f = await fixture(); let checked = false
    f.publisher.finish = vi.fn(async () => { expect(await wallet(f.id)).toMatchObject({ balance: 250 }); checked = true; throw Error("provider unavailable") })
    expect(await syncGooglePlayPurchase(f.input, f.publisher)).toMatchObject({ finishPending: true })
    expect(checked).toBe(true)
    f.publisher.finish = vi.fn(async () => ({}))
    await syncGooglePlayPurchase(f.input, f.publisher)
    expect(await wallet(f.id)).toMatchObject({ balance: 250, lifetimePurchased: 250 })
  })
  it("a different account cannot restore or claim a receipt", async () => {
    const f = await fixture(), other = await fixture()
    await syncGooglePlayPurchase(f.input, f.publisher)
    await expect(syncGooglePlayPurchase({ ...f.input, userId: other.id, intentId: other.intent.id }, f.publisher)).rejects.toThrow(/different/)
    expect(await wallet(other.id)).toBeNull()
  })
  it("rejects missing intent and native attribution for another account", async () => {
    const f = await fixture()
    await expect(syncGooglePlayPurchase({ ...f.input, intentId: undefined }, f.publisher)).rejects.toThrow(/saved purchase/)
    f.body.obfuscatedExternalAccountId = obfuscatedPlayAccountId(randomUUID())
    await expect(syncGooglePlayPurchase(f.input, f.publisher)).rejects.toThrow(/another account/)
    expect(await wallet(f.id)).toBeNull()
  })
  it("one checkout authorization cannot claim a second receipt", async () => {
    const f = await fixture(); await syncGooglePlayPurchase(f.input, f.publisher)
    const anotherToken = `test-purchase-${randomUUID()}`; hashes.push(purchaseHash(anotherToken))
    await expect(syncGooglePlayPurchase({ ...f.input, token: anotherToken }, f.publisher)).rejects.toThrow(/already used/)
    expect(await wallet(f.id)).toMatchObject({ balance: 250, lifetimePurchased: 250 })
  })
  it("a pending purchase grants nothing and is not consumed", async () => {
    const f = await fixture(); f.body.purchaseStateContext.purchaseState = "PENDING"
    expect(await syncGooglePlayPurchase(f.input, f.publisher)).toMatchObject({ pending: true })
    expect(await wallet(f.id)).toBeNull(); expect(f.publisher.finish).not.toHaveBeenCalled()
    f.body.purchaseStateContext.purchaseState = "PURCHASED"
    await syncGooglePlayPurchase(f.input, f.publisher)
    expect(await wallet(f.id)).toMatchObject({ balance: 250 })
  })
  it("duplicate refunds reverse once and an old PURCHASED read cannot restore tokens", async () => {
    const f = await fixture(); await syncGooglePlayPurchase(f.input, f.publisher)
    await Promise.all([reverseVoidedPlayPack(f.token), reverseVoidedPlayPack(f.token)])
    await syncGooglePlayPurchase(f.input, f.publisher)
    expect(await wallet(f.id)).toMatchObject({ balance: 0 })
    expect(await prisma.tokenLedger.count({ where: { userId: f.id, sourceType: "google_play_refund" } })).toBe(1)
  })
  it("a refund before receipt delivery blocks delayed fulfillment", async () => {
    const f = await fixture(); await reverseVoidedPlayPack(f.token)
    await expect(syncGooglePlayPurchase(f.input, f.publisher)).rejects.toThrow(/mismatch/)
    expect(await wallet(f.id)).toBeNull()
  })
  it("a consumed, previously unclaimed pack cannot refill a wallet", async () => {
    const f = await fixture(); f.body.productLineItem[0].productOfferDetails.consumptionState = "CONSUMPTION_STATE_CONSUMED"
    await expect(syncGooglePlayPurchase(f.input, f.publisher)).rejects.toThrow(/consumed/)
    f.body.obfuscatedExternalAccountId = obfuscatedPlayAccountId(f.id)
    await expect(syncGooglePlayPurchase(f.input, f.publisher)).rejects.toThrow(/consumed/)
    expect(await wallet(f.id)).toBeNull()
  })
  it("subscription purchase, renewal and restore grant access without any token bundle", async () => {
    const f = await fixture("af_pro_monthly"); await syncGooglePlayPurchase(f.input, f.publisher)
    expect((await access(f.id)).plans).toContain("pro"); expect(await wallet(f.id)).toBeNull()
    const later = new Date(Date.now() + 60 * 86400_000)
    f.body.lineItems[0].expiryTime = later.toISOString()
    await syncGooglePlayPurchase({ ...f.input, intentId: undefined }, f.publisher)
    const rows = await prisma.userSubscription.findMany({ where: { userId: f.id } })
    expect(rows).toHaveLength(1); expect(rows[0].currentPeriodEnd).toEqual(later); expect(await wallet(f.id)).toBeNull()
  })
  it("cancel preserves the paid period; grace grants access; hold and pause stop it", async () => {
    const f = await fixture("af_pro_monthly")
    for (const [state, allowed] of [["CANCELED", true], ["IN_GRACE_PERIOD", true], ["ON_HOLD", false], ["PAUSED", false], ["ACTIVE", true], ["EXPIRED", false]] as const) {
      f.body.subscriptionState = `SUBSCRIPTION_STATE_${state}`
      await syncGooglePlayPurchase(f.input, f.publisher)
      expect((await access(f.id)).plans.includes("pro")).toBe(allowed)
    }
  })
  it("stops future Play billing before account deletion and retries safely", async () => {
    const f = await fixture("af_pro_monthly"); await syncGooglePlayPurchase(f.input, f.publisher)
    const cancel = vi.fn(async () => ({}))
    expect(await cancelGooglePlayOnDelete(f.id, { get: f.publisher.get, cancel })).toEqual([`google_play:${purchaseHash(f.token)}`])
    expect(cancel).toHaveBeenCalledWith(f.token)
    f.body.subscriptionState = "SUBSCRIPTION_STATE_CANCELED"
    expect(await cancelGooglePlayOnDelete(f.id, { get: f.publisher.get, cancel })).toEqual([])
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it("a cancellation provider failure prevents the deletion workflow from continuing", async () => {
    const f = await fixture("af_pro_monthly"); await syncGooglePlayPurchase(f.input, f.publisher)
    await expect(cancelGooglePlayOnDelete(f.id, { get: f.publisher.get, cancel: vi.fn(async () => { throw Error("Google unavailable") }) })).rejects.toThrow(/unavailable/)
    expect((await access(f.id)).plans).toContain("pro")
  })
  it("notifications cannot recreate access after an account is anonymized", async () => {
    const f = await fixture("af_pro_monthly"); await syncGooglePlayPurchase(f.input, f.publisher)
    await prisma.userSubscription.deleteMany({ where: { userId: f.id } })
    await prisma.appUser.update({ where: { id: f.id }, data: { email: `deleted+${f.id}@deleted.invalid` } })
    await syncGooglePlayPurchase({ ...f.input, userId: undefined, intentId: undefined }, f.publisher)
    expect(await prisma.userSubscription.count({ where: { userId: f.id } })).toBe(0)
  })

})
