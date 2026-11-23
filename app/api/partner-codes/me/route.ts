import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { partnerApiUser } from '@/lib/partner-codes/http'
import { getPartnerDashboard } from '@/lib/partner-codes/dashboard'
import { checkCodeAvailability, claimPartnerCode } from '@/lib/partner-codes/service'
import { CODE_REASON_COPY } from '@/lib/partner-codes/code'
import { SHARE_LOGOS, isShareLook } from '@/lib/partner-codes/shareLooks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The signed-in commissioner's Partner Code. One route on purpose (the repo
 * keeps its route count down):
 *   GET                → dashboard
 *   GET ?check=CODE    → live availability while typing
 *   POST { code }      → claim, or change your code
 *   PATCH { look, logo } → share-image choices
 */
export async function GET(req: Request) {
  const auth = await partnerApiUser()
  if (!auth.ok) return auth.res
  const check = new URL(req.url).searchParams.get('check')
  if (check !== null) {
    const res = await checkCodeAvailability(check, auth.userId)
    if (!res.ok) return NextResponse.json({ available: false, message: CODE_REASON_COPY[res.reason] })
    return NextResponse.json({ available: true, code: res.display, message: `${res.normalized} is available` })
  }
  return NextResponse.json(await getPartnerDashboard(auth.userId))
}

export async function POST(req: Request) {
  const auth = await partnerApiUser()
  if (!auth.ok) return auth.res
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null
  const res = await claimPartnerCode(auth.userId, typeof body?.code === 'string' ? body.code : '')
  if (!res.ok) return NextResponse.json({ error: CODE_REASON_COPY[res.reason], reason: res.reason }, { status: res.reason === 'taken' ? 409 : 400 })
  return NextResponse.json({ ok: true, code: res.code, created: res.created })
}

export async function PATCH(req: Request) {
  const auth = await partnerApiUser()
  if (!auth.ok) return auth.res
  const body = (await req.json().catch(() => null)) as { look?: unknown; logo?: unknown } | null
  const look = typeof body?.look === 'string' && isShareLook(body.look) ? body.look : null
  const logo = typeof body?.logo === 'string' && (SHARE_LOGOS as readonly string[]).includes(body.logo) ? body.logo : null
  if (!look && !logo) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
  const res = await prisma.partnerCode.updateMany({
    where: { ownerUserId: auth.userId },
    data: { ...(look ? { shareLook: look } : {}), ...(logo ? { shareLogo: logo } : {}) },
  })
  if (!res.count) return NextResponse.json({ error: 'Claim a code first' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
