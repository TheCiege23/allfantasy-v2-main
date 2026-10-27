import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { playServerConfigured } from "@/lib/google-play/billingConfig"
import { reconcileGooglePlayBilling } from "@/lib/google-play/billingReconciliation"
export const runtime = "nodejs"
export const maxDuration = 300
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim() || "", supplied = request.headers.get("authorization") || ""
  const a = Buffer.from(supplied), b = Buffer.from(`Bearer ${expected}`)
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!playServerConfigured()) return NextResponse.json({ skipped: true, reason: "Play billing is not configured." })
  try {
    const result = await reconcileGooglePlayBilling()
    return NextResponse.json(result, { status: result.failures ? 503 : 200 })
  } catch { return NextResponse.json({ error: "Google Play reconciliation needs a retry." }, { status: 503 }) }
}
