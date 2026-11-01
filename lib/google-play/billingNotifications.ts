import "server-only"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { PLAY_PACKAGE } from "./billingCatalog"
import { PlayBillingError, purchaseHash, validatePurchaseToken } from "./billingConfig"
import { prisma } from "@/lib/prisma"
import { reverseVoidedPlayPack, syncGooglePlayPurchase, refreshStoredGooglePlayPurchase } from "./billingPurchases"

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))
export async function authenticatePlayPush(request: Request) {
  const audience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE?.trim(), email = process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL?.trim()
  if (!audience || !email) throw new PlayBillingError("Google Play notifications are not configured.", 503)
  const header = request.headers.get("authorization") || ""
  if (!header.startsWith("Bearer ")) throw new PlayBillingError("Unauthorized", 401)
  try {
    const { payload } = await jwtVerify(header.slice(7), googleKeys, { audience, issuer: ["https://accounts.google.com", "accounts.google.com"], algorithms: ["RS256"] })
    if (payload.email !== email || payload.email_verified !== true) throw new Error()
  } catch { throw new PlayBillingError("Unauthorized", 401) }
}
export async function applyPlayNotification(body: unknown) {
  const envelope = body as { subscription?: string; message?: { data?: string; messageId?: string } }
  if (envelope?.subscription !== process.env.GOOGLE_PLAY_PUBSUB_SUBSCRIPTION?.trim()) throw new PlayBillingError("Unexpected Pub/Sub subscription.", 403)
  const data = envelope.message?.data
  if (typeof data !== "string" || data.length > 30_000 || !envelope.message?.messageId) throw new PlayBillingError("Invalid notification.")
  let event: Record<string, any>
  try { event = JSON.parse(Buffer.from(data, "base64").toString("utf8")) } catch { throw new PlayBillingError("Invalid notification.") }
  if (event.packageName !== PLAY_PACKAGE) throw new PlayBillingError("Package mismatch.", 403)
  if (event.testNotification) return
  if (event.subscriptionNotification) {
    const token = validatePurchaseToken(event.subscriptionNotification.purchaseToken)
    const row = await prisma.googlePlayPurchase.findUnique({ where: { tokenHash: purchaseHash(token) } })
    // For an unclaimed subscription, the initial verification/restore will fetch current state.
    if (row) await refreshStoredGooglePlayPurchase(row.tokenHash)
    return
  }
  if (event.oneTimeProductNotification) {
    const n = event.oneTimeProductNotification
    await syncGooglePlayPurchase({ token: validatePurchaseToken(n.purchaseToken), productId: n.sku })
    return
  }
  if (event.voidedPurchaseNotification) {
    const token = validatePurchaseToken(event.voidedPurchaseNotification.purchaseToken)
    if (event.voidedPurchaseNotification.productType === 2) await reverseVoidedPlayPack(token)
    else {
      const row = await prisma.googlePlayPurchase.findUnique({ where: { tokenHash: purchaseHash(token) } })
      if (row) await refreshStoredGooglePlayPurchase(row.tokenHash)
    }
    return
  }
  throw new PlayBillingError("Unsupported Google Play notification.")
}
