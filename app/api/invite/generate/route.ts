import { getServedOrigin } from '@/lib/http/served-origin'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isAdminEmailAllowed } from '@/lib/adminAuth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { createInviteLink } from '@/lib/invite-engine'
import type { InviteType } from '@/lib/invite-engine/types'

export const dynamic = 'force-dynamic'

function getBaseUrl(req: NextRequest): string {
  // Config-derived, never the Host / X-Forwarded-Host header, which the caller
  // controls — see lib/http/served-origin.ts.
  return getServedOrigin(req)
}

function clampMaxUses(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(5000, Math.floor(value)))
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as
    | { user?: { id?: string; email?: string | null } }
    | null
  const userId = session?.user?.id
  const viewerEmail = session?.user?.email ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const type = (body.type as InviteType) ?? 'referral'
  const targetId = typeof body.targetId === 'string' && body.targetId.trim() ? body.targetId.trim() : null
  const expiresInDays = typeof body.expiresInDays === 'number' ? body.expiresInDays : null
  const maxUses = clampMaxUses(body.maxUses)

  const validTypes: InviteType[] = [
    'league',
    'bracket',
    'creator_league',
    'referral',
    'reactivation',
    'waitlist',
  ]
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: 'Invalid invite type' }, { status: 400 })
  }

  if (type === 'league') {
    if (!targetId) {
      return NextResponse.json({ error: 'targetId (leagueId) required for league invite' }, { status: 400 })
    }
    try {
      await assertCommissioner(targetId, userId)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  if (type === 'bracket') {
    if (!targetId) {
      return NextResponse.json({ error: 'targetId (bracket league id) required for bracket invite' }, { status: 400 })
    }
    const bracketLeague = await prisma.bracketLeague.findUnique({
      where: { id: targetId },
      select: { ownerId: true },
    })
    if (!bracketLeague) {
      return NextResponse.json({ error: 'Bracket league not found' }, { status: 404 })
    }
    if (bracketLeague.ownerId !== userId && !isAdminEmailAllowed(viewerEmail)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  if (type === 'creator_league') {
    if (!targetId) {
      return NextResponse.json({ error: 'targetId (creator league id) required for creator league invite' }, { status: 400 })
    }
    const creatorLeague = await prisma.creatorLeague.findUnique({
      where: { id: targetId },
      select: {
        creator: {
          select: { userId: true },
        },
      },
    })
    if (!creatorLeague) {
      return NextResponse.json({ error: 'Creator league not found' }, { status: 404 })
    }
    if (creatorLeague.creator.userId !== userId && !isAdminEmailAllowed(viewerEmail)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  let expiresAt: Date | null = null
  if (expiresInDays && expiresInDays > 0) {
    expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)
  }

  const result = await createInviteLink(userId, type, {
    targetId,
    expiresAt,
    maxUses,
    metadata:
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata
        : undefined,
    baseUrl: getBaseUrl(req),
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, inviteLink: result.inviteLink })
}
