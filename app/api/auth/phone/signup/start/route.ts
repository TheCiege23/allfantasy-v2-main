import { NextResponse } from "next/server"
import { getClientIp } from "@/lib/rate-limit"
import { consumeSharedRateLimit } from "@/lib/security/sharedRateLimit"
import { normalizePhoneE164 } from "@/lib/phone/e164"
import { maskPhonesInText } from "@/lib/sms/maskPhone"

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
  // Bound SMS spend across app replicas and across rotated numbers.
  const [pair, perIp, perPhone] = await Promise.all([
    consumeSharedRateLimit(`signup-phone-start:${ip}:${phone}`, 3, 2 * 60),
    consumeSharedRateLimit(`signup-phone-start-ip:${ip}`, 10, 60 * 60),
    consumeSharedRateLimit(`signup-phone-start-num:${phone}`, 5, 60 * 60),
  ])
  if (!pair.success || !perIp.success || !perPhone.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Please wait before requesting another code." },
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
    // Masked: Twilio's error messages quote the full number.
    console.error("[auth/phone/signup/start] error:", maskPhonesInText(String(err?.message || err)))
    return NextResponse.json(
      { error: "SEND_FAILED", message: "Failed to send verification code." },
      { status: 500 }
    )
  }
}
