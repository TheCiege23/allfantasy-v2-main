import { hasTrustedPlayOrigin } from "@/lib/google-play/billingRequest"
import { getServerSession } from "next-auth"
import { NextResponse } from "next/server"
import { authOptions } from "@/lib/auth"
import { PlayBillingError, playServerConfigured } from "@/lib/google-play/billingConfig"
import { syncGooglePlayPurchase } from "@/lib/google-play/billingPurchases"
export const runtime = "nodejs"
export async function POST(request: Request) {
  const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!playServerConfigured()) return NextResponse.json({ error: "Google Play verification is not configured." }, { status: 503 })
  if (!hasTrustedPlayOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
  try {
    const body = await request.json() as { purchaseToken?: string; productId?: string; intentId?: string }
    if (typeof body.productId !== "string" || typeof body.purchaseToken !== "string" || (body.intentId && !/^[a-f0-9-]{36}$/i.test(body.intentId))) throw new PlayBillingError("Invalid purchase receipt.")
    return NextResponse.json(await syncGooglePlayPurchase({ token: body.purchaseToken, productId: body.productId, intentId: body.intentId, userId: session.user.id }), { headers: { "cache-control": "no-store" } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof PlayBillingError ? error.message : "Unable to verify your purchase. Retry Restore Purchases after signing in." }, { status: error instanceof PlayBillingError ? error.status : 502 })
  }
}
