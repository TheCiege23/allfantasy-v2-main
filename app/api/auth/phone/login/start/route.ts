import { NextResponse } from "next/server"
import { getClientIp, rateLimit } from "@/lib/rate-limit"
import { normalizePhoneE164 } from "@/lib/phone/e164"
import { startPhoneCodeSignIn } from "@/lib/auth/phoneCodeSignIn"

export const runtime = "nodejs"

/**
 * Step one of "sign in with a text code". Texts a code only to a number on a verified
 * account, and answers `{ ok: true }` either way so the response never says whether a
 * number is registered. Step two is the `phone-code` next-auth provider.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const phone = normalizePhoneE164(String(body?.phone || ""))
  if (!phone) {
    return NextResponse.json({ error: "MISSING_PHONE", message: "Enter your phone number." }, { status: 400 })
  }

  // ⚠ SMS PUMPING. The same three buckets as the signup sender: a per-pair resend
  // throttle, a per-IP ceiling across numbers, and a per-number ceiling across IPs.
  // Spent before the account lookup, so an unknown number is throttled exactly like a
  // known one and the timing of a 429 reveals nothing.
  const ip = getClientIp(req)
  const rl = rateLimit(`signin-phone-start:${ip}:${phone}`, 3, 120_000)
  const perIp = rl.success ? rateLimit(`signin-phone-start-ip:${ip}`, 10, 60 * 60 * 1000) : rl
  const perPhone = perIp.success ? rateLimit(`signin-phone-start-num:${phone}`, 5, 60 * 60 * 1000) : perIp
  if (!perPhone.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Please wait a couple of minutes before asking for another code." },
      { status: 429 }
    )
  }

  const result = await startPhoneCodeSignIn(phone)
  if (result.ok) return NextResponse.json({ ok: true })

  const status = result.error === "INVALID_PHONE" ? 400 : 503
  const message =
    result.error === "INVALID_PHONE"
      ? "Enter a valid phone number, including the area code."
      : "Text codes aren't available right now. Sign in with your password instead."
  return NextResponse.json({ error: result.error, message }, { status })
}
