import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { validateCanonicalRosterPayload } from '@/lib/roster-lineup-engine/rosterValidationService'
import type { LineupValidationContext } from '@/lib/roster-lineup-engine/types'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const playerData = body?.playerData ?? body?.rosterData

  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const isComm = league.userId === session.user.id
  const memberRoster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: session.user.id },
    select: { id: true },
  })
  if (!isComm && !memberRoster && !await acceptedCoOwnerRosterId(leagueId, session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sport = String(league.sport ?? 'NFL')
  const formatType = getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined)
  let template
  try {
    template = await getRosterTemplateForLeague(sport as never, formatType, leagueId)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Template resolution failed' },
      { status: 400 },
    )
  }

  const vctx: LineupValidationContext = {
    league: {
      id: league.id,
      sport: league.sport,
      leagueVariant: league.leagueVariant,
      settings: league.settings,
      lifecycleState: league.lifecycleState,
      lockAllMoves: league.lockAllMoves,
      irAllowOut: league.irAllowOut,
      irAllowCovid: league.irAllowCovid,
      irAllowSuspended: league.irAllowSuspended,
      irAllowNA: league.irAllowNA,
      irAllowDNR: league.irAllowDNR,
      irAllowDoubtful: league.irAllowDoubtful,
      taxiSlots: league.taxiSlots,
      taxiAllowNonRookies: league.taxiAllowNonRookies,
      taxiYearsLimit: league.taxiYearsLimit,
      guillotineMode: league.guillotineMode,
      bestBallMode: league.bestBallMode,
    },
    template,
    season: league.season,
    week: 1,
  }

  const result = validateCanonicalRosterPayload(playerData, vctx)
  return NextResponse.json({
    ok: result.ok,
    issues: result.issues,
  })
}
