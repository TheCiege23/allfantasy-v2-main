import { notFound } from 'next/navigation'
import sharp from 'sharp'
import { renderShareCard } from '@/lib/partner-codes/shareCard'
import { isShareFormat, isShareLook } from '@/lib/partner-codes/shareLooks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** A stand-in commissioner logo for the harness: a shield with "TC", drawn locally. */
async function sampleLogoPng(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="#0b1f3a"/>
    <path d="M256 48 L432 112 V256 C432 368 352 440 256 472 C160 440 80 368 80 256 V112 Z" fill="#e11d48" stroke="#fde047" stroke-width="18"/>
    <text x="256" y="320" font-family="Arial, sans-serif" font-size="170" font-weight="900" fill="#ffffff" text-anchor="middle">TC</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/**
 * Harness twin of /api/partner-codes/image with a fixed code and no database or sign-in.
 *   ?sampleLogo=1           the stand-in uploaded logo itself
 *   ?logo=upload            a share image using it (as if an admin approved it)
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') notFound()
  const q = new URL(req.url).searchParams
  if (q.get('sampleLogo') === '1') {
    return new Response(new Uint8Array(await sampleLogoPng()), { headers: { 'content-type': 'image/png' } })
  }
  const format = q.get('format') ?? 'story'
  const look = q.get('look') ?? 'midnight'
  const logo = q.get('logo') === 'af' || q.get('logo') === 'upload' ? (q.get('logo') as 'af' | 'upload') : 'initials'
  const logoUrl = logo === 'upload' && q.get('approved') !== '0' ? `data:image/png;base64,${(await sampleLogoPng()).toString('base64')}` : null
  return renderShareCard({
    code: 'TheCiege',
    name: (q.get('name') ?? 'TheCiege').slice(0, 24),
    look: isShareLook(look) ? look : 'midnight',
    format: isShareFormat(format) ? format : 'story',
    logo,
    logoUrl,
    discountPercent: 10,
    discountMonths: 3,
  })
}
