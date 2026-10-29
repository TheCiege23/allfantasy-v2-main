import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { submitJuryVote } from '@/lib/survivor/SurvivorFinaleEngine'
import { resolveSurvivorCurrentWeek } from '@/lib/survivor/SurvivorTimelineResolver'
import { queueLeagueEventVideo } from '@/lib/fantasy-media/EventVideoAutomation'
import { prisma } from '@/lib/prisma'
import { getRosterTeamMap } from '@/lib/zombie/rosterTeamMap'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'

export const dynamic = 'force-dynamic'

function normalizeRequestedWeek(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.floor(value))
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(1, parsed)
    }
  }
  return null
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const jurorRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  if (!jurorRosterId) return NextResponse.json({ error: 'You have no roster in this league' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const finalistRosterId = typeof body.finalistRosterId === 'string' ? body.finalistRosterId.trim() : ''
  if (!finalistRosterId) {
    return NextResponse.json({ error: 'finalistRosterId is required' }, { status: 400 })
  }

  const requestedWeek = normalizeRequestedWeek(body.week)
  const week = await resolveSurvivorCurrentWeek(leagueId, requestedWeek)

  const result = await submitJuryVote({
    leagueId,
    jurorRosterId,
    finalistRosterId,
    week,
    source: 'survivor-ui',
    command: `jury_vote:${finalistRosterId}`,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Failed to submit jury vote' }, { status: 400 })
  }

  if (result.state?.closed && result.state?.winnerRosterId) {
    const uiSettings = await getDraftUISettingsForLeague(leagueId).catch(() => null)
    if (!(uiSettings?.survivorFinaleAutoHeyGenEnabled ?? true)) {
      return NextResponse.json({
        ok: true,
        winnerRosterId: result.state?.winnerRosterId ?? null,
        closed: result.state?.closed ?? false,
        votesSubmitted: result.state?.votesSubmitted ?? null,
        votesRequired: result.state?.votesRequired ?? null,
      })
    }

    const winnerRosterId = result.state.winnerRosterId
    const [league, map] = await Promise.all([
      prisma.league.findUnique({
        where: { id: leagueId },
        select: { name: true, sport: true },
      }),
      getRosterTeamMap(leagueId),
    ])

    const teamId = map.rosterIdToTeamId.get(winnerRosterId)
    const winnerTeam = teamId
      ? await prisma.leagueTeam.findUnique({
          where: { id: teamId },
          select: { teamName: true, ownerName: true },
        })
      : null

    const winnerLabel =
      winnerTeam?.teamName?.trim() ||
      winnerTeam?.ownerName?.trim() ||
      `Roster ${winnerRosterId.slice(0, 8)}`

    const leagueName = league?.name?.trim() || 'Survivor League'
    const script = [
      `Survivor finale results for ${leagueName}.`,
      `The jury vote is final. ${winnerLabel} is the last one standing.`,
      `Votes submitted: ${result.state.votesSubmitted ?? 0} of ${result.state.votesRequired ?? 0}.`,
    ].join(' ')

    await queueLeagueEventVideo({
      userId,
      leagueId,
      leagueName,
      sport: String(league?.sport ?? 'nfl'),
      title: `${leagueName} · Survivor Winner Reveal`,
      script,
      contentType: 'championship_recap',
      eventType: 'survivor_winner_reveal',
      eventPayload: {
        week,
        winnerRosterId,
        winnerLabel,
        votesSubmitted: result.state.votesSubmitted,
        votesRequired: result.state.votesRequired,
      },
    })
  }

  return NextResponse.json({
    ok: true,
    winnerRosterId: result.state?.winnerRosterId ?? null,
    closed: result.state?.closed ?? false,
    votesSubmitted: result.state?.votesSubmitted ?? null,
    votesRequired: result.state?.votesRequired ?? null,
  })
}
