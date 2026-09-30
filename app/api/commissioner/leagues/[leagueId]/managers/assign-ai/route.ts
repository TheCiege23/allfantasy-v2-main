import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { updateDraftUISettings } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'

type SessionWithUser = { user?: { id?: string; email?: string | null } } | null

/**
 * POST: assign AI manager to a roster by orphaning roster ownership
 * and enabling orphan AI drafter mode for this league.
 * Body: { rosterId: string }
 */
export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as SessionWithUser
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const gate = await requireFeatureEntitlement({
    userId,
    userEmail: session?.user?.email,
    featureId: 'ai_team_managers',
  })
  if (!gate.ok) return gate.response

  const body = await req.json().catch(() => ({}))
  const rosterId = typeof body?.rosterId === 'string' ? body.rosterId.trim() : ''
  if (!rosterId) {
    return NextResponse.json({ error: 'rosterId is required' }, { status: 400 })
  }

  const roster = await prisma.roster.findFirst({
    where: { id: rosterId, leagueId: params.leagueId },
    select: { id: true, platformUserId: true },
  })
  if (!roster) {
    return NextResponse.json(
      { error: 'Roster not found or does not belong to this league' },
      { status: 404 }
    )
  }

  const orphanId = `orphan-${roster.id}`
  await prisma.roster.update({
    where: { id: roster.id },
    data: { platformUserId: orphanId },
  })
  await prisma.leagueTeam.updateMany({
    where: {
      leagueId: params.leagueId,
      OR: [{ externalId: roster.id }, { externalId: roster.platformUserId }],
    },
    data: {
      externalId: roster.id,
      ownerName: 'AI Manager',
    },
  })

  await updateDraftUISettings(params.leagueId, {
    orphanTeamAiManagerEnabled: true,
    orphanDrafterMode: 'ai',
  })

  return NextResponse.json({
    status: 'ok',
    rosterId: roster.id,
    orphanPlatformUserId: orphanId,
    aiManagerEnabled: true,
  })
}
