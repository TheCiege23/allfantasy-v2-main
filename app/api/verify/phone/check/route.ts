import { NextResponse } from "next/server"
import { getSessionAndProfile } from "@/lib/auth-guard"
import { prisma } from "@/lib/prisma"
import { getClientIp, rateLimit } from "@/lib/rate-limit"
import { normalizePhoneE164 } from "@/lib/phone/e164"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const { userId, profile } = await getSessionAndProfile()
  if (!userId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  const ip = getClientIp(req)
  const rl = rateLimit(`phone-check:${userId}:${ip}`, 5, 300_000)
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED", message: "Too many attempts. Please wait." }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const code = String(body?.code || "").trim()
  // Normalize phone to E.164 exactly as /start does — the same function, so the key Twilio holds
  // the pending verification under and the key stored on the profile cannot diverge.
  // Without this, Twilio can't find the pending verification and returns 500 → VERIFY_FAILED.
  const phone = normalizePhoneE164(String(body?.phone || profile?.phone || ""))

  if (!phone) return NextResponse.json({ error: "MISSING_PHONE" }, { status: 400 })
  if (!code) return NextResponse.json({ error: "MISSING_CODE" }, { status: 400 })

  if (!/^\+\d{10,15}$/.test(phone)) {
    return NextResponse.json({ error: "INVALID_PHONE", message: "Please enter a valid phone number with country code." }, { status: 400 })
  }

  try {
    const { getTwilioClient } = await import("@/lib/twilio-client")
    const client = await getTwilioClient()

    const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID
    if (!verifySid) {
      return NextResponse.json({ error: "PHONE_VERIFY_NOT_CONFIGURED" }, { status: 500 })
    }

    const check = await client.verify.v2.services(verifySid).verificationChecks.create({
      to: phone,
      code,
    })

    if (check.status !== "approved") {
      return NextResponse.json({ error: "INVALID_CODE" }, { status: 400 })
    }

    await (prisma as any).userProfile.update({
      where: { userId },
      data: { phoneVerifiedAt: new Date(), phone },
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[phone/check] error:", err?.message || err)
    return NextResponse.json({ error: "VERIFY_FAILED", message: "Verification failed." }, { status: 500 })
  }
}
