import { NextResponse } from "next/server"

import { supportCheckoutState } from "@/lib/monetization/supportGuestAccount"

/**
 * GET ?session_id=cs_… — what the support thank-you page should do next
 * (lib/monetization/supportGuestAccount `supportCheckoutState`): "pending", "ready" or
 * "check_email". The Checkout Session id is the secret here; only Stripe and the paying
 * browser hold it, and the answer reveals nothing that browser did not just type.
 */
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get("session_id")?.trim() ?? ""
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 })
  }
  try {
    const state = await supportCheckoutState(sessionId)
    return NextResponse.json({ state }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    console.error("[support-guest] status error:", error instanceof Error ? error.message : "unknown")
    return NextResponse.json({ state: "pending" }, { headers: { "cache-control": "no-store" } })
  }
}
