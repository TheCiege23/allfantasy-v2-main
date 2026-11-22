import { NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { sendNotificationEmail } from '@/lib/resend-client'
import { OWNER_EMAIL } from '@/lib/notifications/notifyOwnerOfNewSignup'
import { inquiryEmail, parsePartnerInquiry, PARTNER_FALLBACK_EMAIL } from '@/lib/partner-portal/inquiry'

/**
 * POST /api/partners/inquiry — the /partners contact form (lib/partner-portal/inquiry.ts).
 *
 * Public and unauthenticated, so three cheap defences, none of which reads the database:
 *   - JSON only. A cross-site page cannot send `application/json` without a CORS preflight, which this
 *     route never answers, so a third-party form cannot post here from a visitor's browser.
 *   - Per-address limit: 3 per 10 minutes. A real prospect sends one.
 *   - A honeypot field. A script that fills it is told "sent" and nothing is sent.
 *
 * 🛑 "SENT" MEANS THE EMAIL PROVIDER ACCEPTED IT. There is no lead table (that is a migration for the owner),
 * so a failed send must not read as success — the visitor gets the address to write to instead.
 */

export const dynamic = 'force-dynamic'

const SENT = { ok: true, message: "Thanks — we've got it. We reply within one business day." } as const

export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return NextResponse.json({ ok: false, message: 'Send the form as JSON.' }, { status: 415 })
  }

  const ip = getClientIp(req)
  if (!rateLimit(`partner-inquiry:${ip}`, 3, 600_000).success) {
    return NextResponse.json(
      { ok: false, message: `You've sent a few already. Give it a few minutes, or email ${PARTNER_FALLBACK_EMAIL}.` },
      { status: 429 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'That form did not arrive intact. Try again.' }, { status: 400 })
  }

  const parsed = parsePartnerInquiry(body)
  if (!parsed.ok && parsed.bot) return NextResponse.json(SENT)
  if (!parsed.ok) return NextResponse.json({ ok: false, message: 'Check the highlighted fields.', errors: parsed.errors }, { status: 400 })

  const { subject, body: text } = inquiryEmail(parsed.value, new Date())
  let delivered = false
  try {
    const sent = await sendNotificationEmail({ to: OWNER_EMAIL, subject, bodyHtml: text })
    delivered = sent.ok
    if (!sent.ok) console.error('[partner-inquiry] email not accepted:', sent.error ?? 'unknown')
  } catch (error) {
    console.error('[partner-inquiry] email send threw:', error instanceof Error ? error.message : error)
  }

  if (!delivered) {
    return NextResponse.json(
      { ok: false, message: `We couldn't send that just now. Email ${PARTNER_FALLBACK_EMAIL} instead — your message is still in the form to copy.` },
      { status: 503 },
    )
  }
  return NextResponse.json(SENT)
}
