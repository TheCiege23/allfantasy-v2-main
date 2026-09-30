import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import {
  autoCorrectPlayerDataToTemplate,
  validateRosterSectionsAgainstTemplate,
} from '@/lib/roster/LineupTemplateValidation'

async function resolveLeagueRosterTemplate(
  leagueId: string,
  sport: string | null | undefined,
  variant: string | null | undefined
) {
  const formatType = getFormatTypeForVariant(String(sport ?? 'NFL'), variant ?? undefined)
  return getRosterTemplateForLeague(String(sport ?? 'NFL') as any, formatType, leagueId)
}

/** GET: list rosters invalid under the resolved sport/variant roster template.
 * POST: set lineup lock rules or force-correct one roster using template validation/correction.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: {
      settings: true,
      sport: true,
      leagueVariant: true,
      rosters: { select: { id: true, platformUserId: true, playerData: true } },
    },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const settings = (league.settings as Record<string, unknown>) || {}
  const lineupLockRule = settings.lineupLockRule ?? null
  let invalidRosters: Array<{ rosterId: string; platformUserId: string | null; reason: string }> = []
  let message =
    'Roster validity is checked against the league sport/variant template. Use force-correct to normalize a roster.'

  try {
    const template = await resolveLeagueRosterTemplate(
      params.leagueId,
      league.sport as string | null | undefined,
      league.leagueVariant as string | null | undefined
    )
    invalidRosters = league.rosters
      .map((roster) => {
        const reason = validateRosterSectionsAgainstTemplate(roster.playerData, template)
        if (!reason) return null
        return {
          rosterId: roster.id,
          platformUserId: (roster.platformUserId as string | null) ?? null,
          reason,
        }
      })
      .filter(Boolean) as Array<{ rosterId: string; platformUserId: string | null; reason: string }>
    if (invalidRosters.length === 0) {
      message = 'All roster lineups currently match this league template.'
    }
  } catch {
    message =
      'Unable to resolve roster template for validity checks right now. Try again after roster template hydration.'
  }

  return NextResponse.json({
    lineupLockRule,
    invalidRosters,
    message,
  })
}

export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const lineupLockRule = body.lineupLockRule
  const forceCorrectRosterId = body.forceCorrectRosterId
  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { id: true, settings: true, sport: true, leagueVariant: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  if (forceCorrectRosterId) {
    const roster = await (prisma as any).roster.findFirst({
      where: { id: forceCorrectRosterId, leagueId: params.leagueId },
      select: { id: true, playerData: true },
    })
    if (!roster) {
      return NextResponse.json({ error: 'Roster not found or does not belong to this league' }, { status: 404 })
    }

    const template = await resolveLeagueRosterTemplate(
      params.leagueId,
      league.sport as string | null | undefined,
      league.leagueVariant as string | null | undefined
    )
    const initialError = validateRosterSectionsAgainstTemplate(roster.playerData, template)
    if (!initialError) {
      return NextResponse.json({
        status: 'ok',
        message: 'Roster already matches the active sport template; no change made.',
        rosterId: forceCorrectRosterId,
      })
    }

    const { correctedPlayerData, droppedPlayerIds } = autoCorrectPlayerDataToTemplate(
      roster.playerData,
      template
    )
    const postError = validateRosterSectionsAgainstTemplate(correctedPlayerData, template)
    if (postError) {
      return NextResponse.json(
        {
          error: `Unable to auto-correct roster: ${postError}`,
          rosterId: forceCorrectRosterId,
          initialIssue: initialError,
        },
        { status: 400 }
      )
    }

    await (prisma as any).roster.update({
      where: { id: forceCorrectRosterId },
      data: { playerData: correctedPlayerData },
    })
    const remainingPlayers = getRosterPlayerIds(correctedPlayerData)

    return NextResponse.json({
      status: 'ok',
      message: `Roster corrected to match template. Removed ${droppedPlayerIds.length} overflow/ineligible player(s).`,
      rosterId: forceCorrectRosterId,
      removedPlayerIds: droppedPlayerIds,
      remainingPlayerCount: remainingPlayers.length,
    })
  }

  const settings = (league.settings as Record<string, unknown>) || {}
  const updated = await prisma.league.update({
    where: { id: params.leagueId },
    data: {
      settings: { ...settings, ...(lineupLockRule !== undefined && { lineupLockRule }) },
    },
    select: { id: true, settings: true },
  })
  return NextResponse.json(updated)
}
