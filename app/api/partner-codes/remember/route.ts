import { NextResponse } from 'next/server'
import { isPartnerCodesEnabled, PARTNER_CODE_COOKIE, partnerCodeCookieOptions } from '@/lib/partner-codes/flags'
import { findPartnerCode } from '@/lib/partner-codes/service'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST { code } — a Partner Code typed on /signup, checked and remembered BEFORE the visitor
 * presses Apple or Google. Those sign-ups never reach /api/auth/register; the account is created
 * in lib/auth/SocialAccountLinkingService, which reads this same cookie (the one /with/CODE sets).
 * Public on purpose: the visitor has no account yet. It says only whether a code is usable, so it
 * is rate limited like any lookup that could be used to guess codes.
 */
export async function POST(req: Request) {
  if (!isPartnerCodesEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!rateLimit(`partner-remember:${getClientIp(req)}`, 20, 600_000).success) {
    return NextResponse.json({ error: 'Too many tries. Please wait a few minutes.' }, { status: 429 })
  }
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null
  const raw = typeof body?.code === 'string' ? body.code.replace(/[^A-Za-z0-9]/g, '').slice(0, 20) : ''
  if (!raw) return NextResponse.json({ error: 'Enter a partner code.' }, { status: 400 })
  const code = await findPartnerCode(raw).catch(() => null)
  if (!code || code.status !== 'active') {
    return NextResponse.json({ error: "We don't recognize that partner code. Check it, or leave the box empty." }, { status: 400 })
  }
  const res = NextResponse.json({ ok: true, code: code.code })
  const secure = new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https'
  res.cookies.set(PARTNER_CODE_COOKIE, code.code, partnerCodeCookieOptions(secure))
  return res
}
