import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getClientIp } from "@/lib/rate-limit"
import { consumeSharedRateLimit } from "@/lib/security/sharedRateLimit"
import { normalizePhoneE164, isValidPhoneE164 } from "@/lib/phone/e164"

export const runtime = "nodejs"

const GENERIC_RESPONSE = {
  ok: true,
  message: "If this number is linked to a verified account, we sent a code.",
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const phone = normalizePhoneE164(String(body?.phone ?? ""))
  if (!isValidPhoneE164(phone)) {
    return NextResponse.json({ error: "Enter a valid phone number with country code." }, { status: 400 })
  }

  const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID
  if (!verifySid) {
    return NextResponse.json({ error: "Text sign-in is temporarily unavailable." }, { status: 503 })
  }

  const ip = getClientIp(req)
  // Charge all buckets even for unknown numbers; replies never disclose account existence.
  const [pair, perIp, perPhone] = await Promise.all([
    consumeSharedRateLimit(`signin-phone-start:${ip}:${phone}`, 3, 2 * 60),
    consumeSharedRateLimit(`signin-phone-start-ip:${ip}`, 10, 60 * 60),
    consumeSharedRateLimit(`signin-phone-start-number:${phone}`, 5, 60 * 60),
  ])
  if (!pair.success || !perIp.success || !perPhone.success) {
    return NextResponse.json(GENERIC_RESPONSE)
  }

  try {
    const profile = await prisma.userProfile.findUnique({
      where: { phone },
      select: { phoneVerifiedAt: true },
    })
    if (!profile?.phoneVerifiedAt) return NextResponse.json(GENERIC_RESPONSE)

    const { getTwilioClient } = await import("@/lib/twilio-client")
    const client = await getTwilioClient()
    await client.verify.v2.services(verifySid).verifications.create({
      to: phone,
      channel: "sms",
    })
  } catch {
    // Twilio errors may include the full destination; do not log them here.
    return NextResponse.json(GENERIC_RESPONSE)
  }

  return NextResponse.json(GENERIC_RESPONSE)
}
