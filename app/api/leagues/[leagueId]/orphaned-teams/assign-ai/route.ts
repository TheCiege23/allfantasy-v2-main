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

  const aiPlatformUserId = `ai-manager-${rosterId}`

  await prisma.roster.update({
    where: { id: rosterId },
    data: {
      platformUserId: aiPlatformUserId,
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
      /*
       * 🛑 AN AI-MANAGED SEAT IS NOT AN EMPTY ONE, AND `isOrphan: false` WAS THE ONLY WAY THIS
       * WRITER COULD SAY SO. Clearing the flag made an AI seat indistinguishable from a
       * human-claimed one — `claimedByUserId` stays null here, so every recipient set built on
       * the claim already excluded it, but nothing could tell "run by a bot" from "run by a
       * person who has not linked an account". `managerKind` is that distinction.
       */
      isOrphan: false,
      lifecycleState: 'CURRENT',
      managerKind: 'AI',
    },
  })

  await prisma.findLeagueListing.updateMany({
    where: { leagueId, rosterId },
    data: { isActive: false },
  })

  return NextResponse.json({ updated: true })
}
