import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { partnerApiUser } from '@/lib/partner-codes/http'
import { isPartnerDemoEnabled } from '@/lib/partner-codes/flags'
import { loadPartnerSettings } from '@/lib/partner-codes/service'
import { isShareFormat, isShareLook } from '@/lib/partner-codes/shareLooks'
import { renderShareCard } from '@/lib/partner-codes/shareCard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The commissioner's share image, rendered on the server so every download is
 * the same quality and the looks can change without breaking anyone's.
 *   GET ?format=story|square|banner&look=midnight|gridiron|trophy|clean&name=TheCiege
 * The look defaults to the saved choice. An uploaded logo is used only once an
 * admin has approved it.
 */
export async function GET(req: Request) {
  const auth = await partnerApiUser()
  if (!auth.ok) return auth.res
  const q = new URL(req.url).searchParams
  const code =
    q.get('demo') === '1' && isPartnerDemoEnabled()
      ? await prisma.partnerCode.findFirst({ where: { isDemo: true } })
      : await prisma.partnerCode.findUnique({ where: { ownerUserId: auth.userId } })
  if (!code) return NextResponse.json({ error: 'Claim a code first' }, { status: 404 })

  const formatKey = q.get('format') ?? 'story'
  const lookKey = q.get('look') ?? code.shareLook
  const s = await loadPartnerSettings()
  const name = (q.get('name') ?? code.code).replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 24) || code.code
  const logo = code.shareLogo === 'af' || code.shareLogo === 'upload' ? code.shareLogo : 'initials'
  return renderShareCard({
    code: code.code,
    name,
    look: isShareLook(lookKey) ? lookKey : 'midnight',
    format: isShareFormat(formatKey) ? formatKey : 'story',
    logo,
    logoUrl: code.logoStatus === 'approved' ? code.logoUrl : null,
    discountPercent: s.discountPercent,
    discountMonths: s.discountMonths,
  })
}
