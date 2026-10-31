import "server-only"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { TokenSpendService } from "@/lib/tokens/TokenSpendService"
import { syncUserProfileFromSubscriptions } from "@/lib/subscription/syncBridge"
import { playProduct } from "./billingCatalog"
import { decryptPurchaseToken, encryptPurchaseToken, obfuscatedPlayAccountId, PlayBillingError, purchaseHash, validatePurchaseToken } from "./billingConfig"
import { googlePlayPublisher, type PlayPublisher } from "./billingPublisher"
import { parsePlayPurchase } from "./billingState"

const subscriptionId = (hash: string) => `google_play:${hash}`
const purchaseKey = (hash: string) => `google_play:${hash}`

/** Provider reads are serialized per receipt. Notification timestamps never decide access. */
export async function syncGooglePlayPurchase(input: {
  token: string; productId: string; userId?: string; intentId?: string
}, publisher: PlayPublisher = googlePlayPublisher) {
  const token = validatePurchaseToken(input.token), hash = purchaseHash(token), product = playProduct(input.productId)
  if (!product) throw new PlayBillingError("Unknown Google Play product.")
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`play:${hash}`}, 0))::text`)
    const existing = await tx.googlePlayPurchase.findUnique({ where: { tokenHash: hash } })
    if (existing && (existing.productId !== product.productId || existing.sku !== product.sku)) throw new PlayBillingError("Receipt product mismatch.", 409)
    if (existing?.ownerId && input.userId && existing.ownerId !== input.userId) throw new PlayBillingError("This purchase belongs to a different AllFantasy account.", 409)
    // Reading Google while holding the receipt lock prevents concurrent old events from overwriting newer reads.
    const verified = parsePlayPurchase(product.type, await publisher.get(product.type, token), product.productId)
    let ownerId = existing?.ownerId ?? null
    let checkoutIntentId = existing?.checkoutIntentId ?? null
    const linked = verified.linkedToken ? await tx.googlePlayPurchase.findUnique({ where: { tokenHash: purchaseHash(verified.linkedToken) } }) : null
    if (linked?.ownerId && input.userId && linked.ownerId !== input.userId) throw new PlayBillingError("The previous subscription belongs to another account.", 409)
    if (!ownerId && linked?.ownerId) ownerId = linked.ownerId
    if (ownerId && verified.accountId && verified.accountId !== obfuscatedPlayAccountId(ownerId)) throw new PlayBillingError("Google Play account attribution mismatch.", 409)
    if (!ownerId && input.userId) {
      if (verified.consumed) throw new PlayBillingError("A previously consumed token pack cannot be restored as a new purchase.", 409)
      if (verified.accountId) {
        if (verified.accountId !== obfuscatedPlayAccountId(input.userId)) throw new PlayBillingError("Google Play purchase belongs to another account.", 409)
      } else {
        // Stock TWA cannot set BillingClient's account ID. Only the account that authorized
        // checkout may make the first claim. Unclaimed restores require that saved intent.
        const intent = input.intentId ? await tx.googlePlayCheckoutIntent.findUnique({ where: { id: input.intentId } }) : null
        if (!intent || intent.userId !== input.userId || intent.sku !== product.sku || intent.expiresAt < new Date()) {
          throw new PlayBillingError("Sign in with the account used for this purchase and retry the saved purchase.", 409)
        }
        if (verified.start && (verified.start.getTime() < intent.createdAt.getTime() - 300_000 || verified.start > intent.expiresAt)) {
          throw new PlayBillingError("This receipt predates the authorized checkout.", 409)
        }
        const previousClaim = await tx.googlePlayPurchase.findUnique({ where: { checkoutIntentId: intent.id } })
        if (previousClaim && previousClaim.tokenHash !== hash) throw new PlayBillingError("This checkout authorization was already used for another purchase.", 409)
        checkoutIntentId = intent.id
      }
      ownerId = input.userId
    }
    if (ownerId && input.userId && ownerId !== input.userId) throw new PlayBillingError("This purchase belongs to another account.", 409)
    const revokedAt = existing?.revokedAt ?? (verified.revoked ? new Date() : null)
    const row = await tx.googlePlayPurchase.upsert({ where: { tokenHash: hash },
      create: { tokenHash: hash, tokenCiphertext: encryptPurchaseToken(token), ownerId, checkoutIntentId, productId: product.productId,
        sku: product.sku, purchaseType: product.type, state: verified.state, orderId: verified.orderId, revokedAt },
      update: { ownerId, checkoutIntentId, state: verified.state, orderId: verified.orderId, revokedAt, lastCheckedAt: new Date() },
    })
    const owner = ownerId ? await tx.appUser.findUnique({ where: { id: ownerId }, select: { id: true, email: true } }) : null
    const ownerExists = Boolean(owner && owner.email !== `deleted+${owner.id}@deleted.invalid`)
    if (ownerId && ownerExists && product.type === "subscription") {
      const plan = await tx.subscriptionPlan.upsert({ where: { code: product.planFamily! },
        create: { code: product.planFamily!, name: product.title.replace(/ (Monthly|Yearly)$/, ""), description: product.description, isBundle: product.planFamily === "af_supreme", isActive: true },
        update: { description: product.description, isActive: true } })
      const inactive = verified.status === "expired"
      const data = { userId: ownerId, subscriptionPlanId: plan.id, source: "google_play", sku: product.sku,
        status: verified.status === "pending" ? "incomplete" : verified.status, currentPeriodStart: verified.start, currentPeriodEnd: verified.end,
        gracePeriodEnd: verified.status === "grace" ? verified.end : null,
        canceledAt: verified.status === "canceled" ? new Date() : null,
        expiresAt: inactive || verified.status === "pending" ? new Date(0) : null, metadata: { playPurchaseHash: hash, basePlanId: product.basePlanId } }
      await tx.userSubscription.upsert({ where: { id: subscriptionId(hash) }, create: { id: subscriptionId(hash), ...data }, update: data })
      if (linked?.ownerId === ownerId && ["active", "grace"].includes(verified.status)) {
        await tx.userSubscription.updateMany({ where: { id: subscriptionId(linked.tokenHash), userId: ownerId }, data: { status: "expired", expiresAt: new Date(0), gracePeriodEnd: null } })
      }
    }
    return { row, verified, ownerId: ownerExists ? ownerId : null, revoked: Boolean(revokedAt) }
  }, { timeout: 30_000, maxWait: 5_000 })

  if (!result.ownerId) return { ok: true, claimed: false, pending: true, sku: product.sku, finishPending: false }
  if (product.type === "token_pack") {
    const service = new TokenSpendService()
    const context = { userId: result.ownerId, packageSku: product.sku, sourceType: "google_play", sourceId: hash }
    // The shared purchase lock and durable reversal marker handle grant/refund reordering.
    if (result.revoked) await service.reversePackagePurchase({ ...context, purchaseKey: purchaseKey(hash), reason: "refund" })
    else if (result.verified.status === "active") await service.grantTokensFromPackagePurchase({ ...context,
      idempotencyKey: purchaseKey(hash), description: `Google Play purchase: ${product.title}`, metadata: { productId: product.productId } })
  } else if (result.verified.status !== "pending") await syncUserProfileFromSubscriptions(result.ownerId)

  let finishPending = false
  if (!result.revoked && result.verified.status !== "pending" && result.verified.status !== "expired") {
    try {
      if (result.verified.needsFinish) await publisher.finish(product.type, product.productId, token)
      await prisma.googlePlayPurchase.update({ where: { tokenHash: hash }, data: { finalizedAt: new Date() } })
    } catch { finishPending = true } // Durable fulfillment succeeded. Cron retries acknowledgment/consume.
  }
  return { ok: true, claimed: true, pending: result.verified.status === "pending", sku: product.sku, finishPending }
}

export async function reverseVoidedPlayPack(token: string) {
  const hash = purchaseHash(validatePurchaseToken(token))
  const row = await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`play:${hash}`}, 0))::text`)
    const existing = await tx.googlePlayPurchase.findUnique({ where: { tokenHash: hash } })
    if (existing?.purchaseType === "subscription") return null
    if (!existing) {
      // A refund can precede the client receipt. Keep an unclaimable tombstone.
      await tx.googlePlayPurchase.create({ data: { tokenHash: hash, tokenCiphertext: encryptPurchaseToken(token),
        productId: "refunded", sku: "refunded", purchaseType: "token_pack", state: "VOIDED", revokedAt: new Date() } })
      return null
    }
    return tx.googlePlayPurchase.update({ where: { tokenHash: hash }, data: { revokedAt: existing.revokedAt ?? new Date() } })
  })
  if (!row) return
  const owner = row.ownerId ? await prisma.appUser.findUnique({ where: { id: row.ownerId }, select: { id: true, email: true } }) : null
  if (owner && owner.email !== `deleted+${owner.id}@deleted.invalid`) await new TokenSpendService().reversePackagePurchase({ purchaseKey: purchaseKey(hash),
    userId: owner.id, packageSku: row.sku, sourceType: "google_play", sourceId: hash, reason: "refund" })
}

export async function refreshStoredGooglePlayPurchase(tokenHash: string) {
  const row = await prisma.googlePlayPurchase.findUnique({ where: { tokenHash } })
  if (!row) return null
  return syncGooglePlayPurchase({ token: decryptPurchaseToken(row.tokenCiphertext), productId: row.productId })
}
