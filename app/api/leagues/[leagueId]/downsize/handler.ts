/**
 * POST: commissioner — league downsizing prep (merge rosters / mark dissolved for dispersal draft).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { requireEntitlement } from '@/lib/subscription/requireEntitlement'
import { isLeagueEligibleForDispersalDraft } from '@/lib/league/dispersal-draft-eligibility'
import { isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

function asArrayJson(pd: unknown): unknown[] {
  return Array.isArray(pd) ? [...pd] : []
}

function mergeLeagueSettings(existing: unknown, patch: Record<string, unknown>): Prisma.InputJsonValue {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}
  return { ...base, ...patch } as Prisma.InputJsonValue
}

/**
 * Commissioner-only: current size + roster rows with display names for downsizing UI.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
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

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      leagueSize: true,
      isDynasty: true,
      leagueType: true,
      leagueVariant: true,
    },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const eligible = isLeagueEligibleForDispersalDraft(league)
  const [rosters, teams] = await Promise.all([
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true },
      orderBy: { id: 'asc' },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { externalId: true, teamName: true, ownerName: true },
    }),
  ])

  const nameByExternal = new Map(teams.map((t) => [t.externalId, t.teamName?.trim() || t.ownerName?.trim() || 'Team']))
  const rosterRows = rosters.map((r) => ({
    rosterId: r.id,
    teamName: nameByExternal.get(r.id) ?? nameByExternal.get(r.platformUserId) ?? 'Team',
    isOrphan: isOrphanPlatformUserId(r.platformUserId),
  }))

  const rosterCount = rosters.length
  const currentSize = Math.max(league.leagueSize ?? 0, rosterCount)

  return NextResponse.json({
    eligible,
    currentSize,
    leagueSize: league.leagueSize ?? currentSize,
    rosters: rosterRows,
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const ent = await requireEntitlement('commissioner_dispersal_draft')
  if (ent instanceof NextResponse) return ent
  const userId = ent

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      id: true,
      leagueSize: true,
      settings: true,
      isDynasty: true,
      leagueType: true,
      leagueVariant: true,
    },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  if (!isLeagueEligibleForDispersalDraft(league)) {
    return NextResponse.json(
      { error: 'Downsize tooling applies to dynasty / devy / C2C / salary-style leagues.' },
      { status: 400 }
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    newTeamCount?: number
    teamReassignments?: { fromRosterId: string; toRosterId: string | null }[]
  }

  const newTeamCount = typeof body.newTeamCount === 'number' ? body.newTeamCount : NaN
  if (!Number.isFinite(newTeamCount) || newTeamCount < 2) {
    return NextResponse.json({ error: 'newTeamCount must be a number ≥ 2' }, { status: 400 })
  }

  const rosterCount = await prisma.roster.count({ where: { leagueId } })
  const currentSize = Math.max(league.leagueSize ?? 0, rosterCount)
  if (currentSize < 2) {
    return NextResponse.json({ error: 'League size could not be determined.' }, { status: 400 })
  }
  if (newTeamCount >= currentSize) {
    return NextResponse.json(
      { error: 'newTeamCount must be less than the current league size.' },
      { status: 400 }
    )
  }

  const rows = Array.isArray(body.teamReassignments) ? body.teamReassignments : []
  const sourceRosterIds: string[] = []
  let dissolved = 0

  for (const row of rows) {
    const fromId = typeof row.fromRosterId === 'string' ? row.fromRosterId.trim() : ''
    if (!fromId) continue
    const toId = row.toRosterId === null || row.toRosterId === undefined ? null : String(row.toRosterId).trim()

    const fromRoster = await prisma.roster.findFirst({
      where: { id: fromId, leagueId },
      select: { id: true, playerData: true, settings: true },
    })
    if (!fromRoster) continue

    if (toId) {
      const toRoster = await prisma.roster.findFirst({
        where: { id: toId, leagueId },
        select: { id: true, playerData: true },
      })
      if (!toRoster) {
        return NextResponse.json({ error: `Target roster ${toId} not found in league.` }, { status: 400 })
      }
      const merged = [...asArrayJson(toRoster.playerData), ...asArrayJson(fromRoster.playerData)]
      await prisma.$transaction([
        prisma.roster.update({
          where: { id: toId },
          data: { playerData: toPrismaJsonInput(merged) },
        }),
        prisma.roster.update({
          where: { id: fromId },
          data: {
            playerData: toPrismaJsonInput([]),
            platformUserId: `orphan-${fromId}`,
            settings: mergeLeagueSettings(fromRoster.settings, {
              dissolvedForDownsize: true,
              mergedIntoRosterId: toId,
            }),
          },
        }),
      ])
      sourceRosterIds.push(fromId)
      dissolved += 1
    } else {
      await prisma.roster.update({
        where: { id: fromId },
        data: {
          platformUserId: `orphan-${fromId}`,
          settings: mergeLeagueSettings(fromRoster.settings, {
            dissolvedForDownsize: true,
            pendingDispersalPool: true,
          }),
        },
      })
      sourceRosterIds.push(fromId)
      dissolved += 1
    }
  }

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      leagueSize: newTeamCount,
      settings: mergeLeagueSettings(league.settings, {
        lastDownsizeAt: new Date().toISOString(),
        lastDownsizeSourceRosterIds: sourceRosterIds,
      }),
    },
  })

  return NextResponse.json({
    dissolved,
    readyForSuppDraft: sourceRosterIds.length > 0,
    sourceRosterIds,
  })
}
