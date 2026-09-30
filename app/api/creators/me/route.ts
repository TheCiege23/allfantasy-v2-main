import { getServedOrigin } from '@/lib/http/served-origin'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getCreatorLeagues,
  getCreatorBySlugOrId,
  upsertCreatorProfile,
} from '@/lib/creator-system'
import type { UpsertCreatorProfileInput } from '@/lib/creator-system/types'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function getBaseUrl(req: Request): string {
  // Config-derived, never the Host / X-Forwarded-Host header, which the caller
  // controls — see lib/http/served-origin.ts.
  return getServedOrigin(req)
}

async function requireUser() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string; email?: string | null }
  } | null
  const userId = session?.user?.id
  if (!userId) return null
  return {
    userId,
    email: session?.user?.email ?? null,
  }
}

export async function GET(req: NextRequest) {
  const viewer = await requireUser()
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profileRow = await prisma.creatorProfile.findUnique({
    where: { userId: viewer.userId },
    select: { id: true, slug: true },
  })
  if (!profileRow) return NextResponse.json({ creator: null, leagues: [] })

  const baseUrl = getBaseUrl(req)
  const creator = await getCreatorBySlugOrId(profileRow.slug, viewer.userId, viewer.email, baseUrl)
  if (!creator) return NextResponse.json({ creator: null, leagues: [] })

  const leagues = await getCreatorLeagues(profileRow.id, viewer.userId, baseUrl, viewer.email)
  return NextResponse.json({
    creator: { ...creator, isOwner: true },
    leagues,
  })
}

export async function POST(req: NextRequest) {
  const viewer = await requireUser()
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as UpsertCreatorProfileInput
  const creator = await upsertCreatorProfile(viewer.userId, viewer.email, body)
  if (!creator) return NextResponse.json({ error: 'Unable to save creator profile' }, { status: 400 })

  return NextResponse.json(creator)
}

export const PATCH = POST
