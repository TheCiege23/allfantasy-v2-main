import { NextResponse } from "next/server"
import { authenticatePlayPush, applyPlayNotification } from "@/lib/google-play/billingNotifications"
import { PlayBillingError } from "@/lib/google-play/billingConfig"
export const runtime = "nodejs"
export async function POST(request: Request) {
  try {
    await authenticatePlayPush(request)
    if (Number(request.headers.get("content-length")) > 40_000) throw new PlayBillingError("Notification too large.", 413)
    const text = await request.text()
    if (text.length > 40_000) throw new PlayBillingError("Notification too large.", 413)
    await applyPlayNotification(JSON.parse(text))
    return NextResponse.json({ ok: true })
  } catch (error) {
    // A non-2xx tells Pub/Sub to retry; no receipt or provider response is logged.
    return NextResponse.json({ error: error instanceof PlayBillingError ? error.message : "Unable to process notification." }, { status: error instanceof PlayBillingError ? error.status : 503 })
  }
}
