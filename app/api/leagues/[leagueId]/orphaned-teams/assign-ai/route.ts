/**
 * POST: commissioner — assign AI manager to an orphan roster slot.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { applyChimmyAutopilot } from '@/lib/inactive-manager/inactiveManagerService'

export const dynamic = 'force-dynamic'

function mergeRosterSettings(existing: unknown, patch: Record<string, unknown>): Prisma.InputJsonValue {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}
  return { ...base, ...patch } as Prisma.InputJsonValue
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    rosterId?: string
    aiManagerType?: 'season_long' | 'until_claimed'
  }
  const rosterId = typeof body.rosterId === 'string' ? body.rosterId.trim() : ''
  const aiManagerType = body.aiManagerType === 'until_claimed' ? 'until_claimed' : 'season_long'
  if (!rosterId) return NextResponse.json({ error: 'rosterId required' }, { status: 400 })

  const orphans = await getOrphanRosterIdsForLeague(leagueId)
  if (!orphans.includes(rosterId)) {
    return NextResponse.json({ error: 'Roster is not an orphan in this league' }, { status: 400 })
  }

  const roster = await prisma.roster.findFirst({
    where: { id: rosterId, leagueId },
    select: { settings: true, platformUserId: true },
  })
  if (!roster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })

  /*
   * Chimmy as a manager (2026-10-31). The seat stays an ordinary empty seat (`orphan-…`) and Chimmy is
   * handed it through the one switch every engine reads (lib/inactive-manager): the draft picks for it,
   * the hourly runs set its lineup and fill its starters, and it ends when a real manager takes the team.
   * This used to rewrite the owner to `ai-manager-…`, which the draft no longer recognised as an empty
   * seat — so Chimmy stopped drafting for exactly the teams assigned to it here.
   */
  const chimmy = await applyChimmyAutopilot(leagueId, userId, rosterId, undefined)
  if (!chimmy.ok) return NextResponse.json({ error: chimmy.error }, { status: chimmy.status })

  await prisma.roster.update({
    where: { id: rosterId },
    data: {
      settings: mergeRosterSettings(roster.settings, {
        aiManaged: true,
        aiManagerType,
        isAdvertised: false,
      }),
    },
  })

  await prisma.leagueTeam.updateMany({
    where: {
      leagueId,
      OR: [{ externalId: rosterId }, { externalId: roster.platformUserId }],
    },
    data: {
      externalId: rosterId,
      ownerName: 'AI Manager',
      isOrphan: false,
    },
  })

  await prisma.findLeagueListing.updateMany({
    where: { leagueId, rosterId },
    data: { isActive: false },
  })

  return NextResponse.json({ updated: true, chimmyManages: true })
}
