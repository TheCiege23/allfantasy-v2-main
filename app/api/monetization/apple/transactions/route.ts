import { getServerSession } from "next-auth"
import { NextResponse } from "next/server"
import { Environment } from "@apple/app-store-server-library"
import { authOptions } from "@/lib/auth"
import { ApplePurchaseError, applyApplePurchase } from "@/lib/monetization/applePurchases"
import { appleIapConfigured, getCurrentAppleTransaction, verifyAppleTransaction } from "@/lib/monetization/appleStore"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!appleIapConfigured()) {
    return NextResponse.json({ error: "Apple purchases are not configured" }, { status: 503 })
  }
  let body: { signedTransactionInfo?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const signedTransactionInfo = body.signedTransactionInfo
  if (typeof signedTransactionInfo !== "string" || signedTransactionInfo.length > 20_000) {
    return NextResponse.json({ error: "Missing Apple signed transaction" }, { status: 400 })
  }
  try {
    const submitted = await verifyAppleTransaction(signedTransactionInfo)
    if (!submitted.transactionId) throw new ApplePurchaseError("Missing Apple transaction ID")
    const environment = submitted.environment === Environment.SANDBOX ? Environment.SANDBOX : Environment.PRODUCTION
    // Fetch current state from Apple. A valid but old JWS must not restore a refunded purchase.
    const current = await getCurrentAppleTransaction(submitted.transactionId, environment)
    if (current.transactionId !== submitted.transactionId) {
      throw new ApplePurchaseError("Apple transaction mismatch")
    }
    const result = await applyApplePurchase(current, session.user.id)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof ApplePurchaseError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[apple/transactions] Purchase verification failed", error)
    return NextResponse.json({ error: "Unable to verify Apple purchase" }, { status: 502 })
  }
}
