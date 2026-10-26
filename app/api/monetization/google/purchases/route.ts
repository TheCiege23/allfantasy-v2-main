import { getServerSession } from "next-auth"
import { NextResponse } from "next/server"
import { authOptions } from "@/lib/auth"
import { PlayApiError, playBillingConfigured } from "@/lib/google-play/playDeveloperApi"
import { GooglePlayPurchaseError, applyGooglePlayPurchase } from "@/lib/monetization/googlePlayPurchases"

export const runtime = "nodejs"

/**
 * The Android app (TWA) posts each Play purchase here right after the payment
 * sheet closes, and again from Restore. The token is verified with Google
 * before anything is granted; see lib/monetization/googlePlayPurchases.ts.
 */
export async function POST(request: Request) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!playBillingConfigured()) {
    return NextResponse.json({ error: "Google Play purchases are not configured" }, { status: 503 })
  }
  let body: { sku?: unknown; purchaseToken?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const sku = typeof body.sku === "string" ? body.sku.trim() : ""
  const purchaseToken = typeof body.purchaseToken === "string" ? body.purchaseToken.trim() : ""
  if (!sku || sku.length > 64 || !purchaseToken || purchaseToken.length > 4_096) {
    return NextResponse.json({ error: "Missing Google Play purchase" }, { status: 400 })
  }
  try {
    const result = await applyGooglePlayPurchase({ userId: session.user.id, sku, purchaseToken })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof GooglePlayPurchaseError) {
      return NextResponse.json({ error: error.message, pending: error.status === 202 }, { status: error.status })
    }
    if (error instanceof PlayApiError && (error.status === 404 || error.status === 410)) {
      return NextResponse.json({ error: "Google Play does not recognise this purchase" }, { status: 400 })
    }
    console.error("[google/purchases] verification failed", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Unable to verify your Google Play purchase" }, { status: 502 })
  }
}
