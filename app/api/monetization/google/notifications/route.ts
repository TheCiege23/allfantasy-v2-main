import { NextResponse } from "next/server"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { readPlayBillingConfig } from "@/lib/google-play/playDeveloperApi"
import {
  GooglePlayPurchaseError,
  refreshGooglePlaySubscription,
  voidGooglePlayPurchase,
} from "@/lib/monetization/googlePlayPurchases"

export const runtime = "nodejs"

/**
 * Google Play Real-time Developer Notifications, delivered by a Cloud Pub/Sub
 * PUSH subscription. Renewals, cancellations, holds, expiries and refunds reach
 * us here; without it a Play subscriber would lose access at the end of their
 * first period even though Google kept charging them.
 *
 * ⚠ AUTHENTICATED, NOT OPEN. The push subscription must be created with
 * "Enable authentication": Pub/Sub then signs each request with a Google OIDC
 * token for the configured service account and audience, verified below
 * against Google's published keys. Without both env vars this answers 503 and
 * processes nothing, rather than accepting unauthenticated pushes.
 *
 * ⚠ NOTHING IN THE MESSAGE IS TRUSTED BEYOND THE TOKEN. Each handler re-reads
 * the purchase from the Play Developer API before changing anything, so a
 * replayed or reordered message cannot grant or remove access by itself.
 *
 * Answer codes: 2xx acknowledges the message; anything else makes Pub/Sub
 * retry. A purchase-level refusal (unknown product, pending payment) is
 * acknowledged, because retrying cannot change it.
 */

const GOOGLE_CERTS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))

type RtdnPayload = {
  packageName?: string
  subscriptionNotification?: { notificationType?: number; purchaseToken?: string; subscriptionId?: string }
  oneTimeProductNotification?: { notificationType?: number; purchaseToken?: string; sku?: string }
  voidedPurchaseNotification?: { purchaseToken?: string; orderId?: string; productType?: number }
  testNotification?: { version?: string }
}

async function verifyPush(request: Request): Promise<boolean> {
  const audience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE?.trim()
  const pushServiceAccount = process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT?.trim()
  if (!audience || !pushServiceAccount) return false
  const header = request.headers.get("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
  if (!token) return false
  try {
    const { payload } = await jwtVerify(token, GOOGLE_CERTS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience,
    })
    return payload.email === pushServiceAccount && payload.email_verified === true
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  const config = readPlayBillingConfig()
  if (!config || !process.env.GOOGLE_PLAY_RTDN_AUDIENCE || !process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT) {
    return NextResponse.json({ error: "Google Play notifications are not configured" }, { status: 503 })
  }
  if (!(await verifyPush(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let notification: RtdnPayload
  try {
    const body = (await request.json()) as { message?: { data?: string } }
    const data = body.message?.data
    if (typeof data !== "string" || data.length > 20_000) throw new Error("missing data")
    notification = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as RtdnPayload
  } catch {
    // Malformed: acknowledge, a retry would be just as malformed.
    return NextResponse.json({ ok: true, ignored: "malformed" })
  }
  if (notification.packageName !== config.packageName) {
    return NextResponse.json({ ok: true, ignored: "package" })
  }

  try {
    if (notification.voidedPurchaseNotification?.purchaseToken) {
      const result = await voidGooglePlayPurchase(notification.voidedPurchaseNotification.purchaseToken)
      return NextResponse.json({ ok: true, result })
    }
    if (notification.subscriptionNotification?.purchaseToken) {
      const result = await refreshGooglePlaySubscription(notification.subscriptionNotification.purchaseToken)
      return NextResponse.json({ ok: true, result })
    }
    // One-time products are granted when the app posts them (or on Restore);
    // a test notification only proves the wiring.
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof GooglePlayPurchaseError) {
      return NextResponse.json({ ok: true, ignored: error.message })
    }
    console.error("[google/notifications] processing failed", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Temporary failure" }, { status: 503 })
  }
}
