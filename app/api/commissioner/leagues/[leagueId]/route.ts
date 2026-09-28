import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { leagueChatThreadLinkRefusal } from '@/lib/league/leagueChatThreadLink'

const ALLOWED_KEYS = ['name', 'scoring', 'status', 'avatarUrl', 'rosterSize', 'leagueSize', 'starters', 'sport', 'season'] as const
const SETTINGS_KEYS = ['description', 'lineupLockRule', 'publicDashboard', 'rankedVisibility', 'orphanSeeking', 'orphanDifficulty', 'leagueChatThreadId', 'tradeReviewType', 'vetoThreshold', 'benchSize', 'rosterPositions'] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = params.leagueId
  if (!leagueId) return NextResponse.json({ error: 'League ID required' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  // Only this league's own chat may be linked (lib/league/leagueChatThreadLink.ts).
  const chatLinkRefusal = leagueChatThreadLinkRefusal(leagueId, body?.leagueChatThreadId)
  if (chatLinkRefusal) return NextResponse.json({ error: chatLinkRefusal }, { status: 400 })
  const updates: Record<string, unknown> = {}
  for (const key of ALLOWED_KEYS) {
    if (body[key] !== undefined) updates[key] = body[key]
  }
  const settingsUpdates: Record<string, unknown> = {}
  for (const key of SETTINGS_KEYS) {
    if (body[key] !== undefined) settingsUpdates[key] = body[key]
  }

  if (Object.keys(settingsUpdates).length > 0) {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { settings: true },
    })
    const current = (league?.settings as Record<string, unknown>) || {}
    updates.settings = { ...current, ...settingsUpdates }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No allowed fields to update' }, { status: 400 })
  }

  const updated = await prisma.league.update({
    where: { id: leagueId },
    data: updates,
    select: { id: true, name: true, settings: true, updatedAt: true },
  })
  return NextResponse.json(updated)
}
