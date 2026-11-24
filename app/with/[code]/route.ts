import { NextResponse } from 'next/server'
import { isPartnerCodesEnabled, PARTNER_CODE_COOKIE, PARTNER_CODE_COOKIE_MAX_AGE } from '@/lib/partner-codes/flags'
import { findPartnerCode } from '@/lib/partner-codes/service'
import { getBaseUrl } from '@/lib/get-base-url'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * allfantasy.ai/with/TheCiege — the link a commissioner shares.
 * Remembers the code for 30 days, then sends the friend to sign up. Signup ties
 * them to the commissioner; checkout applies the friend discount.
 * (`/join/…` was already league invites.)
 */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const base = getBaseUrl()
  if (!isPartnerCodesEnabled()) return NextResponse.redirect(`${base}/`)
  const { code: raw } = await ctx.params
  const code = await findPartnerCode(decodeURIComponent(raw ?? '')).catch(() => null)
  if (!code || code.status !== 'active') return NextResponse.redirect(`${base}/signup`)
  const res = NextResponse.redirect(`${base}/signup?code=${encodeURIComponent(code.code)}`)
  res.cookies.set(PARTNER_CODE_COOKIE, code.code, {
    maxAge: PARTNER_CODE_COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    secure: base.startsWith('https://'),
    httpOnly: true,
  })
  return res
}
