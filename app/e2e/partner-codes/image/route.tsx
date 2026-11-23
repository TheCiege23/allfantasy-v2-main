import { notFound } from 'next/navigation'
import { renderShareCard } from '@/lib/partner-codes/shareCard'
import { isShareFormat, isShareLook } from '@/lib/partner-codes/shareLooks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Harness twin of /api/partner-codes/image with a fixed code and no database or sign-in. */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') notFound()
  const q = new URL(req.url).searchParams
  const format = q.get('format') ?? 'story'
  const look = q.get('look') ?? 'midnight'
  return renderShareCard({
    code: 'TheCiege',
    name: (q.get('name') ?? 'TheCiege').slice(0, 24),
    look: isShareLook(look) ? look : 'midnight',
    format: isShareFormat(format) ? format : 'story',
    logo: 'initials',
    logoUrl: null,
    discountPercent: 10,
    discountMonths: 3,
  })
}
