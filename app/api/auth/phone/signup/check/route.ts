import { NextResponse } from "next/server"
import { getClientIp, rateLimit } from "@/lib/rate-limit"
import { normalizePhoneE164 } from "@/lib/phone/e164"

export const runtime = "nodejs"

const normalizePhone = normalizePhoneE164

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const phone = normalizePhone(String(body?.phone || ""))
  const code = String(body?.code || "").trim()
  if (!phone) {
    return NextResponse.json({ error: "MISSING_PHONE" }, { status: 400 })
  }
  if (!code) {
    return NextResponse.json({ error: "MISSING_CODE" }, { status: 400 })
  }
  if (!/^\+\d{10,15}$/.test(phone)) {
    return NextResponse.json({ error: "INVALID_PHONE" }, { status: 400 })
  }

  const ip = getClientIp(req)
  const rl = rateLimit(`signup-phone-check:${ip}:${phone}`, 5, 300_000)
  if (!rl.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many attempts. Please wait." },
      { status: 429 }
    )
  }

  try {
    const { getTwilioClient } = await import("@/lib/twilio-client")
    const client = await getTwilioClient()
    const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID
    if (!verifySid) {
      return NextResponse.json(
        { error: "PHONE_VERIFY_NOT_CONFIGURED" },
        { status: 500 }
      )
    }
    const check = await client.verify.v2.services(verifySid).verificationChecks.create(
      {
        to: phone,
        code,
      }
    )
    if (check.status !== "approved") {
      return NextResponse.json({ error: "INVALID_CODE" }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[auth/phone/signup/check] error:", err?.message || err)
    return NextResponse.json(
      { error: "VERIFY_FAILED", message: "Verification failed." },
      { status: 500 }
    )
  }
}
