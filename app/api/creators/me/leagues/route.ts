import { getServedOrigin } from '@/lib/http/served-origin'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createCreatorLeague, getCreatorLeagues } from '@/lib/creator-system'
import type { UpsertCreatorLeagueInput } from '@/lib/creator-system/types'
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

  const creator = await prisma.creatorProfile.findUnique({
    where: { userId: viewer.userId },
    select: { id: true },
  })
  if (!creator) return NextResponse.json([])

  const leagues = await getCreatorLeagues(creator.id, viewer.userId, getBaseUrl(req), viewer.email)
  return NextResponse.json(leagues)
}

export async function POST(req: NextRequest) {
  const viewer = await requireUser()
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creatorProfile.findUnique({
    where: { userId: viewer.userId },
    select: { id: true },
  })
  if (!creator) {
    return NextResponse.json({ error: 'Create your creator profile first' }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as UpsertCreatorLeagueInput
  if (!body?.name || !body?.sport) {
    return NextResponse.json({ error: 'League name and sport are required' }, { status: 400 })
  }

  const league = await createCreatorLeague(
    creator.id,
    viewer.userId,
    body,
    getBaseUrl(req),
    viewer.email
  )
  if (!league) return NextResponse.json({ error: 'Unable to create creator league' }, { status: 400 })

  return NextResponse.json(league, { status: 201 })
}
