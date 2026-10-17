import type { JWSTransactionDecodedPayload } from "@apple/app-store-server-library"
import { prisma } from "@/lib/prisma"
import { getMonetizationCatalogItemBySku, type MonetizationSku } from "@/lib/monetization/catalog"
import { upsertSubscriptionPlanForCatalogItem } from "@/lib/subscription/webhookHandlers"
import { syncUserProfileFromSubscriptions } from "@/lib/subscription/syncBridge"
import { TokenSpendService } from "@/lib/tokens/TokenSpendService"

export class ApplePurchaseError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function dateFromApple(value: number | undefined): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function applyApplePurchase(
  transaction: JWSTransactionDecodedPayload,
  userId: string
): Promise<{ sku: string; purchaseType: "subscription" | "tokens" }> {
  const transactionId = transaction.transactionId?.trim()
  const originalTransactionId = transaction.originalTransactionId?.trim()
  const productId = transaction.productId?.trim()
  if (!transactionId || !originalTransactionId || !productId) {
    throw new ApplePurchaseError("Apple transaction is missing required identifiers")
  }
  // AppUser.id is a UUID and is passed to StoreKit as appAccountToken at purchase time.
  // This prevents replaying someone else's valid Apple transaction onto this account.
  if (transaction.appAccountToken?.toLowerCase() !== userId.toLowerCase()) {
    throw new ApplePurchaseError("Apple purchase belongs to a different AllFantasy account", 403)
  }
  const item = getMonetizationCatalogItemBySku(productId as MonetizationSku)
  if (!item) throw new ApplePurchaseError("Unknown Apple product identifier")
  const expectedType = item.type === "subscription" ? "Auto-Renewable Subscription" : "Consumable"
  if (transaction.type !== expectedType) {
    throw new ApplePurchaseError("Apple product type does not match the catalog")
  }
  if (transaction.revocationDate) {
    throw new ApplePurchaseError("This Apple purchase has been refunded or revoked")
  }
  if (item.type === "token_pack") {
    if (transaction.quantity !== undefined && transaction.quantity !== 1) {
      throw new ApplePurchaseError("Unsupported Apple token pack quantity")
    }
    await new TokenSpendService().grantTokensFromPackagePurchase({
      userId,
      packageSku: item.sku,
      sourceType: "apple_iap",
      sourceId: transactionId,
      idempotencyKey: `apple_iap:${transactionId}`,
      description: `App Store purchase: ${item.title}`,
      metadata: { originalTransactionId, productId, environment: transaction.environment },
    })
    return { sku: item.sku, purchaseType: "tokens" }
  }

  const expiresAt = dateFromApple(transaction.expiresDate)
  const purchasedAt = dateFromApple(transaction.purchaseDate)
  if (!expiresAt || !purchasedAt || !item.planFamily || expiresAt <= new Date()) {
    throw new ApplePurchaseError("Apple subscription is expired or incomplete")
  }
  const plan = await upsertSubscriptionPlanForCatalogItem(item)
  if (!plan) throw new Error("Unable to create subscription plan")

  const existing = await prisma.userSubscription.findUnique({
    where: { appleOriginalTransactionId: originalTransactionId },
    select: { userId: true, currentPeriodEnd: true },
  })
  if (existing && existing.userId !== userId) {
    throw new ApplePurchaseError("Apple subscription is already linked to another account", 409)
  }
  // Renewal notifications may arrive out of order. Older periods cannot roll back access.
  if (existing?.currentPeriodEnd && existing.currentPeriodEnd > expiresAt) {
    return { sku: item.sku, purchaseType: "subscription" }
  }
  const data = {
    userId,
    subscriptionPlanId: plan.id,
    status: "active",
    source: "apple",
    sku: item.sku,
    appleLatestTransactionId: transactionId,
    currentPeriodStart: purchasedAt,
    currentPeriodEnd: expiresAt,
    gracePeriodEnd: null,
    canceledAt: null,
    expiresAt: null,
    metadata: { environment: transaction.environment },
  }
  await prisma.userSubscription.upsert({
    where: { appleOriginalTransactionId: originalTransactionId },
    update: data,
    create: { ...data, appleOriginalTransactionId: originalTransactionId },
  })
  await syncUserProfileFromSubscriptions(userId)
  return { sku: item.sku, purchaseType: "subscription" }
}

export async function expireAppleSubscription(
  transaction: JWSTransactionDecodedPayload,
  status: "expired" | "past_due"
): Promise<void> {
  const originalTransactionId = transaction.originalTransactionId?.trim()
  if (!originalTransactionId) throw new ApplePurchaseError("Missing Apple original transaction ID")
  const row = await prisma.userSubscription.findUnique({
    where: { appleOriginalTransactionId: originalTransactionId },
  })
  if (!row) return
  if (transaction.appAccountToken && transaction.appAccountToken.toLowerCase() !== row.userId.toLowerCase()) {
    throw new ApplePurchaseError("Apple transaction account mismatch", 403)
  }
  // An old expiry/refund event cannot terminate a newer renewal.
  if (row.appleLatestTransactionId !== transaction.transactionId) return
  await prisma.userSubscription.update({
    where: { id: row.id },
    data: { status, gracePeriodEnd: null, ...(status === "expired" ? { expiresAt: new Date(0) } : {}) },
  })
  await syncUserProfileFromSubscriptions(row.userId)
}
