import { getServedOrigin } from '@/lib/http/served-origin'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCreatorBySlugOrId, logAnalytics, upsertCreatorProfile } from '@/lib/creator-system'
import type { UpsertCreatorProfileInput } from '@/lib/creator-system/types'
import { prisma } from '@/lib/prisma'
import { isAdminEmailAllowed } from '@/lib/adminAuth'
import { resolveUserCareerTier } from '@/lib/ranking/tier-visibility'

export const dynamic = 'force-dynamic'

function getBaseUrl(req: Request): string {
  // Config-derived, never the Host / X-Forwarded-Host header, which the caller
  // controls — see lib/http/served-origin.ts.
  return getServedOrigin(req)
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ creatorIdOrSlug: string }> }
) {
  try {
    const { creatorIdOrSlug } = await params
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    const viewerUserId = session?.user?.id ?? null
    const viewerEmail = session?.user?.email ?? null
    const viewerTier = await resolveUserCareerTier(prisma as any, viewerUserId, 1)

    const creator = await getCreatorBySlugOrId(
      creatorIdOrSlug,
      viewerUserId,
      viewerEmail,
      getBaseUrl(req),
      viewerTier
    )
    if (!creator) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })

    await logAnalytics(creator.id, 'profile_view', null, { source: 'profile_page' })
    const isOwner = !!viewerUserId && creator.userId === viewerUserId
    return NextResponse.json({ ...creator, isOwner })
  } catch (error) {
    console.error('[api/creators/[creatorIdOrSlug]]', error)
    return NextResponse.json({ error: 'Failed to load creator' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ creatorIdOrSlug: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    const userId = session?.user?.id
    const viewerEmail = session?.user?.email ?? null
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { creatorIdOrSlug } = await params
    const creator = await prisma.creatorProfile.findFirst({
      where: {
        OR: [{ id: creatorIdOrSlug }, { slug: creatorIdOrSlug }],
      },
      select: { userId: true },
    })
    if (!creator || (creator.userId !== userId && !isAdminEmailAllowed(viewerEmail))) {
      return NextResponse.json({ error: 'Creator not found or access denied' }, { status: 404 })
    }

    const body = (await req.json().catch(() => ({}))) as UpsertCreatorProfileInput
    const updated = await upsertCreatorProfile(creator.userId, viewerEmail, body)
    if (!updated) return NextResponse.json({ error: 'Failed to update creator' }, { status: 400 })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('[api/creators/[creatorIdOrSlug]] PATCH', error)
    return NextResponse.json({ error: 'Failed to update creator' }, { status: 500 })
  }
}
