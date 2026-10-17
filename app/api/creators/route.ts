import { getServedOrigin } from '@/lib/http/served-origin'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCreators, getCreatorsLeaderboard } from '@/lib/creator-system'
import { prisma } from '@/lib/prisma'
import { resolveUserCareerTier } from '@/lib/ranking/tier-visibility'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    const viewerUserId = session?.user?.id ?? null
    const viewerTier = await resolveUserCareerTier(prisma as any, viewerUserId, 1)
    const { searchParams } = new URL(req.url)
    const visibility = (searchParams?.get('visibility') as 'public' | 'unlisted' | 'all') || 'public'
    const sport = searchParams?.get('sport') || undefined
    const limit = Math.min(Number(searchParams?.get('limit')) || 24, 48)
    const sort = searchParams?.get('sort') as 'members' | 'leagues' | null
    const cursor = searchParams?.get('cursor') || undefined
    const baseUrl = getServedOrigin(req)

    if (sort === 'members' || sort === 'leagues') {
      const creators = await getCreatorsLeaderboard({
        limit,
        sort,
      })
      return NextResponse.json({ ok: true, creators })
    }

    const result = await getCreators({
      visibility,
      sport,
      limit,
      cursor,
      baseUrl,
      viewerTier,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[api/creators]', e)
    return NextResponse.json({ error: 'Failed to list creators' }, { status: 500 })
  }
}

