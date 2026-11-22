/**
 * POST: commissioner — mark orphan rosters as advertised + Find a League listings + optional league chat line.
 */

import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
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
    await assertCommissionerAccess(leagueId, userId, 'league')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { rosterIds?: string[] }
  const rosterIds = Array.isArray(body.rosterIds) ? body.rosterIds.map(String) : []
  if (rosterIds.length === 0) {
    return NextResponse.json({ error: 'rosterIds required' }, { status: 400 })
  }

  const validOrphans = new Set(await getOrphanRosterIdsForLeague(leagueId))
  const targetIds = rosterIds.filter((id) => validOrphans.has(id))
  if (targetIds.length === 0) {
    return NextResponse.json({ error: 'No valid orphan rosters' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { id: true, name: true, sport: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  let advertised = 0
  for (const rosterId of targetIds) {
    const roster = await prisma.roster.findFirst({
      where: { id: rosterId, leagueId },
      select: { settings: true },
    })
    if (!roster) continue

    await prisma.roster.update({
      where: { id: rosterId },
      data: {
        settings: mergeRosterSettings(roster.settings, {
          isAdvertised: true,
          advertisedAt: new Date().toISOString(),
        }),
      },
    })

    await prisma.findLeagueListing.upsert({
      where: { leagueId_rosterId: { leagueId, rosterId } },
      create: {
        leagueId,
        rosterId,
        headline: league.name ? `Open spot — ${league.name}` : 'Open manager spot',
        body: 'This team is open. Claim it from Find a League.',
        sport: league.sport,
        isActive: true,
      },
      update: {
        isActive: true,
        headline: league.name ? `Open spot — ${league.name}` : 'Open manager spot',
      },
    })
    advertised += 1
  }

  await prisma.leagueChatMessage.create({
    data: {
      leagueId,
      userId,
      message: `Commissioner advertised ${advertised} open team(s) on Find a League.`,
      type: 'system',
      metadata: { isSystem: true, orphanAdvertised: true },
    },
  })

  return NextResponse.json({
    advertised,
    message: 'Teams advertised to Find a League',
  })
}
