/**
 * Google Play purchases → AllFantasy entitlements. The Play twin of
 * applePurchases.ts, and deliberately the same shape.
 *
 * ⚠ TRUST NOTHING BUT GOOGLE. The browser sends a product id and a purchase
 * token; both are only lookup keys. Product, state, expiry and order id all
 * come from the Play Developer API response.
 *
 * ⚠ ACCOUNT BINDING IS FIRST CLAIM. A TWA's Payment Request cannot pass an
 * account id into Play (Apple's appAccountToken has no equivalent here), so a
 * token belongs to the first signed-in AllFantasy account that presents it,
 * recorded in google_play_purchases under a unique token hash. Any other
 * account presenting the same token gets 409. Claiming happens under a row
 * lock, so two concurrent posts of one token cannot both create entitlements.
 *
 * ⚠ ONE CATALOG SKU = ONE PLAY PRODUCT ID. Play subscriptions are created with
 * a single base plan each, because a TWA selects by product id alone. That
 * keeps this mapping the identity, exactly like Apple.
 */

import { createHash, randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getMonetizationCatalogItemBySku, type MonetizationSku } from "@/lib/monetization/catalog"
import { upsertSubscriptionPlanForCatalogItem } from "@/lib/subscription/webhookHandlers"
import { syncUserProfileFromSubscriptions } from "@/lib/subscription/syncBridge"
import { TokenSpendService } from "@/lib/tokens/TokenSpendService"
import {
  acknowledgeSubscription,
  consumeProduct,
  getProductPurchase,
  getSubscriptionPurchase,
  readPlayBillingConfig,
  type PlayBillingConfig,
  type PlaySubscriptionPurchase,
} from "@/lib/google-play/playDeveloperApi"

export class GooglePlayPurchaseError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export type GooglePlayPurchaseResult = { sku: string; purchaseType: "subscription" | "tokens" }

type PurchaseRecord = {
  id: string
  userId: string
  userSubscriptionId: string | null
  latestOrderId: string | null
  createdAt: Date
}

export function hashPurchaseToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function requireConfig(): PlayBillingConfig {
  const config = readPlayBillingConfig()
  if (!config) throw new GooglePlayPurchaseError("Google Play purchases are not configured", 503)
  return config
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Play subscriptionState → our status. CANCELED keeps access until expiry, like Stripe's cancel-at-period-end. */
export function statusForSubscriptionState(state: string | undefined): "active" | "past_due" | "expired" | null {
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE":
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
    case "SUBSCRIPTION_STATE_CANCELED":
      return "active"
    case "SUBSCRIPTION_STATE_ON_HOLD":
    case "SUBSCRIPTION_STATE_PAUSED":
      return "past_due"
    case "SUBSCRIPTION_STATE_EXPIRED":
      return "expired"
    default:
      return null // PENDING, PENDING_PURCHASE_CANCELED, unspecified
  }
}

/**
 * Insert the token's claim row if absent, then lock it. Returns the row as it
 * stands under the lock, so a concurrent caller waits and then sees the owner.
 */
async function claimPurchase(
  tx: Prisma.TransactionClient,
  input: { tokenHash: string; token: string; userId: string; productId: string; kind: "subscription" | "product" },
): Promise<PurchaseRecord> {
  await tx.$executeRaw`
    INSERT INTO "google_play_purchases" ("id", "purchaseTokenHash", "purchaseToken", "userId", "productId", "kind", "updatedAt")
    VALUES (${randomUUID()}, ${input.tokenHash}, ${input.token}, ${input.userId}, ${input.productId}, ${input.kind}, NOW())
    ON CONFLICT ("purchaseTokenHash") DO NOTHING`
  const rows = await tx.$queryRaw<PurchaseRecord[]>`
    SELECT "id", "userId", "userSubscriptionId", "latestOrderId", "createdAt"
    FROM "google_play_purchases" WHERE "purchaseTokenHash" = ${input.tokenHash} FOR UPDATE`
  const row = rows[0]
  if (!row) throw new Error("Google Play purchase claim row missing after insert")
  return row
}

/** Is another, newer token already carrying this subscription row? Then this one is superseded. */
async function isSuperseded(tx: Prisma.TransactionClient, record: PurchaseRecord): Promise<boolean> {
  if (!record.userSubscriptionId) return false
  const newer = await tx.googlePlayPurchase.findFirst({
    where: { userSubscriptionId: record.userSubscriptionId, createdAt: { gt: record.createdAt }, id: { not: record.id } },
    select: { id: true },
  })
  return Boolean(newer)
}

async function applySubscription(
  config: PlayBillingConfig,
  input: { userId: string; sku: string; purchaseToken: string; allowInactive: boolean; subscription?: PlaySubscriptionPurchase },
): Promise<GooglePlayPurchaseResult> {
  const item = getMonetizationCatalogItemBySku(input.sku as MonetizationSku)
  if (!item || item.type !== "subscription" || !item.planFamily) {
    throw new GooglePlayPurchaseError("Unknown Google Play subscription")
  }
  const sub = input.subscription ?? (await getSubscriptionPurchase(config, input.purchaseToken))
  const line = sub.lineItems?.find((l) => l.productId === item.sku)
  if (!line) throw new GooglePlayPurchaseError("Google Play subscription does not match the requested plan")

  const status = statusForSubscriptionState(sub.subscriptionState)
  if (status === null) {
    throw new GooglePlayPurchaseError(
      sub.subscriptionState === "SUBSCRIPTION_STATE_PENDING"
        ? "Your Google Play payment is still pending. Access starts as soon as Google confirms it."
        : "This Google Play subscription is not active",
      sub.subscriptionState === "SUBSCRIPTION_STATE_PENDING" ? 202 : 400,
    )
  }
  const expiresAt = parseDate(line.expiryTime)
  if (!expiresAt) throw new GooglePlayPurchaseError("Google Play subscription has no expiry")
  if (!input.allowInactive && (status !== "active" || expiresAt <= new Date())) {
    throw new GooglePlayPurchaseError("This Google Play subscription is expired or on hold")
  }

  const plan = await upsertSubscriptionPlanForCatalogItem(item)
  if (!plan) throw new Error("Unable to create subscription plan")
  const tokenHash = hashPurchaseToken(input.purchaseToken)
  const linkedHash = sub.linkedPurchaseToken ? hashPurchaseToken(sub.linkedPurchaseToken) : null
  const testPurchase = Boolean(sub.testPurchase)

  const outcome = await prisma.$transaction(async (tx) => {
    const record = await claimPurchase(tx, {
      tokenHash,
      token: input.purchaseToken,
      userId: input.userId,
      productId: item.sku,
      kind: "subscription",
    })
    if (record.userId !== input.userId) {
      throw new GooglePlayPurchaseError("This Google Play purchase is already linked to another AllFantasy account", 409)
    }

    // An upgrade, downgrade or resubscribe issues a new token linked to the old one: keep one row.
    let subscriptionId = record.userSubscriptionId
    if (!subscriptionId && linkedHash) {
      const linked = await tx.googlePlayPurchase.findUnique({
        where: { purchaseTokenHash: linkedHash },
        select: { userId: true, userSubscriptionId: true },
      })
      if (linked && linked.userId !== input.userId) {
        throw new GooglePlayPurchaseError("This Google Play subscription is linked to another AllFantasy account", 409)
      }
      subscriptionId = linked?.userSubscriptionId ?? null
    }

    // A late notification for a replaced token must not roll the shared row back.
    if (await isSuperseded(tx, record)) return { written: false }

    const data = {
      userId: input.userId,
      subscriptionPlanId: plan.id,
      status,
      source: "google_play",
      sku: item.sku,
      currentPeriodStart: parseDate(sub.startTime),
      currentPeriodEnd: expiresAt,
      gracePeriodEnd: null,
      canceledAt: sub.subscriptionState === "SUBSCRIPTION_STATE_CANCELED" ? new Date() : null,
      expiresAt: status === "expired" ? new Date(0) : null,
      metadata: { googlePlay: { state: sub.subscriptionState ?? null, latestOrderId: sub.latestOrderId ?? null, testPurchase } },
    }
    const row = subscriptionId
      ? await tx.userSubscription.update({ where: { id: subscriptionId }, data, select: { id: true } })
      : await tx.userSubscription.create({ data, select: { id: true } })

    await tx.googlePlayPurchase.update({
      where: { id: record.id },
      data: {
        userSubscriptionId: row.id,
        productId: item.sku,
        latestOrderId: sub.latestOrderId ?? null,
        state: sub.subscriptionState ?? null,
        testPurchase,
      },
    })
    return { written: true }
  })

  // Play refunds a subscription that is not acknowledged within three days.
  if (outcome.written && status === "active" && sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
    await acknowledgeSubscription(config, item.sku, input.purchaseToken).catch((error) => {
      // Not fatal: the next restore or notification for this token retries it.
      console.error("[google-play] acknowledge failed", error instanceof Error ? error.message : error)
    })
  }
  await syncUserProfileFromSubscriptions(input.userId)
  return { sku: item.sku, purchaseType: "subscription" }
}

async function applyTokenPack(
  config: PlayBillingConfig,
  input: { userId: string; sku: string; purchaseToken: string },
): Promise<GooglePlayPurchaseResult> {
  const item = getMonetizationCatalogItemBySku(input.sku as MonetizationSku)
  if (!item || item.type !== "token_pack") throw new GooglePlayPurchaseError("Unknown Google Play token pack")

  const purchase = await getProductPurchase(config, item.sku, input.purchaseToken)
  if (purchase.purchaseState === 2) {
    throw new GooglePlayPurchaseError("Your Google Play payment is still pending. Tokens arrive as soon as Google confirms it.", 202)
  }
  if (purchase.purchaseState !== 0) throw new GooglePlayPurchaseError("This Google Play purchase was cancelled")
  if (purchase.quantity !== undefined && purchase.quantity !== 1) {
    throw new GooglePlayPurchaseError("Unsupported Google Play token pack quantity")
  }

  const tokenHash = hashPurchaseToken(input.purchaseToken)
  // Order ids fit the ledger columns; tokens do not. License-tester purchases can lack an order id.
  const purchaseRef = purchase.orderId?.trim() || `t:${tokenHash.slice(0, 40)}`
  const testPurchase = purchase.purchaseType === 0

  await prisma.$transaction(async (tx) => {
    const record = await claimPurchase(tx, {
      tokenHash,
      token: input.purchaseToken,
      userId: input.userId,
      productId: item.sku,
      kind: "product",
    })
    if (record.userId !== input.userId) {
      throw new GooglePlayPurchaseError("This Google Play purchase is already linked to another AllFantasy account", 409)
    }
    await tx.googlePlayPurchase.update({
      where: { id: record.id },
      data: { latestOrderId: purchase.orderId ?? null, state: "PURCHASED", testPurchase },
    })
  })

  // Idempotent on the order: a retry, a restore or a second tab returns the same ledger entry.
  await new TokenSpendService().grantTokensFromPackagePurchase({
    userId: input.userId,
    packageSku: item.sku,
    sourceType: "google_play",
    sourceId: purchaseRef,
    idempotencyKey: `google_play:${purchaseRef}`,
    description: `Google Play purchase: ${item.title}`,
    metadata: { orderId: purchase.orderId ?? null, testPurchase },
  })

  // Consume only AFTER the grant is recorded, so a crash between the two leaves
  // a purchase restore can still grant, never a consumed pack with no tokens.
  if (purchase.consumptionState !== 1) {
    await consumeProduct(config, item.sku, input.purchaseToken).catch((error) => {
      console.error("[google-play] consume failed", error instanceof Error ? error.message : error)
    })
  }
  return { sku: item.sku, purchaseType: "tokens" }
}

/** A signed-in user presenting a purchase from the Android app (new purchase or restore). */
export async function applyGooglePlayPurchase(input: {
  userId: string
  sku: string
  purchaseToken: string
}): Promise<GooglePlayPurchaseResult> {
  const config = requireConfig()
  const item = getMonetizationCatalogItemBySku(input.sku as MonetizationSku)
  if (!item) throw new GooglePlayPurchaseError("Unknown Google Play product")
  return item.type === "subscription"
    ? applySubscription(config, { ...input, allowInactive: false })
    : applyTokenPack(config, input)
}

/**
 * A Real-time Developer Notification for a subscription token: re-read Google's
 * state and apply it to whoever owns the token. A token nobody has claimed yet
 * is ignored; the app posts it after purchase, or on Restore.
 */
export async function refreshGooglePlaySubscription(purchaseToken: string): Promise<"applied" | "unclaimed"> {
  const config = requireConfig()
  const sub = await getSubscriptionPurchase(config, purchaseToken)
  const owner =
    (await prisma.googlePlayPurchase.findUnique({
      where: { purchaseTokenHash: hashPurchaseToken(purchaseToken) },
      select: { userId: true },
    })) ??
    (sub.linkedPurchaseToken
      ? await prisma.googlePlayPurchase.findUnique({
          where: { purchaseTokenHash: hashPurchaseToken(sub.linkedPurchaseToken) },
          select: { userId: true },
        })
      : null)
  if (!owner) return "unclaimed"
  const sku = sub.lineItems?.[0]?.productId
  if (!sku) throw new GooglePlayPurchaseError("Google Play subscription has no product")
  await applySubscription(config, { userId: owner.userId, sku, purchaseToken, allowInactive: true, subscription: sub })
  return "applied"
}

/**
 * Google voided a purchase (refund or chargeback). A subscription loses access
 * now; a token pack is reversed once, without clawing back tokens already spent.
 */
export async function voidGooglePlayPurchase(purchaseToken: string): Promise<"voided" | "unknown"> {
  const record = await prisma.googlePlayPurchase.findUnique({
    where: { purchaseTokenHash: hashPurchaseToken(purchaseToken) },
    select: { id: true, userId: true, kind: true, userSubscriptionId: true, latestOrderId: true, createdAt: true, purchaseTokenHash: true },
  })
  if (!record) return "unknown"

  if (record.kind === "product") {
    const purchaseRef = record.latestOrderId?.trim() || `t:${record.purchaseTokenHash.slice(0, 40)}`
    await new TokenSpendService().reverseGooglePlayPackagePurchase(purchaseRef)
  } else if (record.userSubscriptionId) {
    const superseded = await prisma.googlePlayPurchase.findFirst({
      where: { userSubscriptionId: record.userSubscriptionId, createdAt: { gt: record.createdAt }, id: { not: record.id } },
      select: { id: true },
    })
    // Refunding an old, replaced token must not end the plan the newer token pays for.
    if (!superseded) {
      await prisma.userSubscription.update({
        where: { id: record.userSubscriptionId },
        data: { status: "expired", gracePeriodEnd: null, expiresAt: new Date(0) },
      })
      await syncUserProfileFromSubscriptions(record.userId)
    }
  }
  await prisma.googlePlayPurchase.update({ where: { id: record.id }, data: { state: "VOIDED" } })
  return "voided"
}
