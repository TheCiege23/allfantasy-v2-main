import { NextResponse } from "next/server"
import { getSessionAndProfile } from "@/lib/auth-guard"
import { prisma } from "@/lib/prisma"
import { getClientIp, rateLimit } from "@/lib/rate-limit"
import { SMS_CONSENT_TEXT, SMS_CONSENT_VERSION } from "@/lib/legal/smsProgram"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const { userId, profile } = await getSessionAndProfile()
  if (!userId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  const ip = getClientIp(req)
  const rl = rateLimit(`phone-start:${userId}:${ip}`, 3, 120_000)
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED", message: "Please wait before requesting another code." }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  let phone = String(body?.phone || profile?.phone || "").trim()
  if (!phone) return NextResponse.json({ error: "MISSING_PHONE" }, { status: 400 })

  phone = phone.replace(/[\s()-]/g, "")
  if (!phone.startsWith("+")) phone = "+1" + phone
  if (!/^\+\d{10,15}$/.test(phone)) {
    return NextResponse.json({ error: "INVALID_PHONE", message: "Please enter a valid phone number with country code." }, { status: 400 })
  }

  // Guard: reject if the normalised phone already belongs to a *different* user.
  // (The @unique constraint would catch it later, but only as an opaque 500.)
  const existingProfile = await (prisma as any).userProfile.findUnique({
    where: { phone },
    select: { userId: true },
  }).catch(() => null)
  if (existingProfile && existingProfile.userId !== userId) {
    return NextResponse.json(
      { error: "PHONE_ALREADY_IN_USE", message: "This phone number is already linked to another account." },
      { status: 409 }
    )
  }

  await (prisma as any).userProfile.update({
    where: { userId },
    data: { phone },
  }).catch(() => null)

  // SMS opt-in record for A2P 10DLC. The web UIs only enable "send code" once the
  // unchecked-by-default consent box is ticked, and send smsConsent: true. Stored in
  // the notificationPreferences JSON (merged, never overwritten) so no migration is
  // needed; keeps who/when/which-number/which-wording as proof of consent.
  // Not enforced as a hard 400 here: /api/shared/verification/phone/send proxies to
  // this route for other clients that do not send the flag yet.
  if (body?.smsConsent === true) {
    try {
      const current = await (prisma as any).userProfile.findUnique({
        where: { userId },
        select: { notificationPreferences: true },
      })
      const prev = (current?.notificationPreferences ?? {}) as Record<string, unknown>
      await (prisma as any).userProfile.update({
        where: { userId },
        data: {
          notificationPreferences: {
            ...prev,
            smsConsent: {
              consentedAt: new Date().toISOString(),
              phone,
              ip,
              source: typeof body?.consentSource === "string" ? body.consentSource.slice(0, 64) : "web",
              version: SMS_CONSENT_VERSION,
              text: SMS_CONSENT_TEXT,
            },
          },
        },
      })
    } catch (err: any) {
      console.error("[phone/start] failed to record SMS consent:", err?.message || err)
    }
  }

  try {
    const { getTwilioClient } = await import("@/lib/twilio-client")
    const client = await getTwilioClient()

    const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID
    if (!verifySid) {
      return NextResponse.json({ error: "PHONE_VERIFY_NOT_CONFIGURED" }, { status: 500 })
    }

    await client.verify.v2.services(verifySid).verifications.create({
      to: phone,
      channel: "sms",
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[phone/start] error:", err?.message || err)
    return NextResponse.json({ error: "SEND_FAILED", message: "Failed to send verification code." }, { status: 500 })
  }
}
