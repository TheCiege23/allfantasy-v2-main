import { NextResponse } from "next/server"
import { getClientIp, rateLimit } from "@/lib/rate-limit"
import { normalizePhoneE164 } from "@/lib/phone/e164"

export const runtime = "nodejs"

const normalizePhone = normalizePhoneE164

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const phone = normalizePhone(String(body?.phone || ""))
  if (!phone) {
    return NextResponse.json({ error: "MISSING_PHONE" }, { status: 400 })
  }
  if (!/^\+\d{10,15}$/.test(phone)) {
    return NextResponse.json({ error: "INVALID_PHONE" }, { status: 400 })
  }

  const ip = getClientIp(req)
  // ⚠ SMS PUMPING. Keyed on ip+phone alone, rotating the NUMBER made sends from
  // one IP unlimited — each text is billed to us. Three buckets now: the
  // original per-pair resend throttle, a per-IP ceiling across all numbers,
  // and a per-number ceiling across all IPs.
  const rl = rateLimit(`signup-phone-start:${ip}:${phone}`, 3, 120_000)
  const perIp = rl.success ? rateLimit(`signup-phone-start-ip:${ip}`, 10, 60 * 60 * 1000) : rl
  const perPhone = perIp.success ? rateLimit(`signup-phone-start-num:${phone}`, 5, 60 * 60 * 1000) : perIp
  if (!perPhone.success) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: "Please wait before requesting another code.",
      },
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

    await client.verify.v2.services(verifySid).verifications.create({
      to: phone,
      channel: "sms",
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[auth/phone/signup/start] error:", err?.message || err)
    return NextResponse.json(
      { error: "SEND_FAILED", message: "Failed to send verification code." },
      { status: 500 }
    )
  }
}
