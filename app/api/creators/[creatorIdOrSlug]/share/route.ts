import { getServedOrigin } from '@/lib/http/served-origin'
import { NextRequest, NextResponse } from 'next/server'
import { buildShareUrl, logAnalytics } from '@/lib/creator-system'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function getBaseUrl(req: Request): string {
  // Config-derived, never the Host / X-Forwarded-Host header, which the caller
  // controls — see lib/http/served-origin.ts.
  return getServedOrigin(req)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ creatorIdOrSlug: string }> }
) {
  try {
    const { creatorIdOrSlug } = await params
    const profile = await prisma.creatorProfile.findFirst({
      where: {
        OR: [{ id: creatorIdOrSlug }, { slug: creatorIdOrSlug }],
      },
      select: { id: true, slug: true },
    })
    if (!profile) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    const channel = typeof body.channel === 'string' ? body.channel : 'direct'
    const source = typeof body.source === 'string' ? body.source : 'share_button'

    await logAnalytics(profile.id, 'invite_share', null, { channel, source })
    return NextResponse.json({
      url: buildShareUrl(profile.slug, getBaseUrl(req)),
    })
  } catch (error) {
    console.error('[api/creators/.../share]', error)
    return NextResponse.json({ error: 'Failed to get share URL' }, { status: 500 })
  }
}
