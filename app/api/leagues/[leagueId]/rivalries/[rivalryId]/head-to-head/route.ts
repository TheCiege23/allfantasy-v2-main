import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/rivalries/[rivalryId]/head-to-head
 * Query: season?
 * Returns direct matchup history between rivalry participants.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string; rivalryId: string }> }
) {
  try {
    const { leagueId, rivalryId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    // Membership gate. This route was reachable by anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response
    if (!rivalryId) return NextResponse.json({ error: 'Missing rivalryId' }, { status: 400 })

    const rivalry = await prisma.rivalryRecord.findFirst({
      where: { id: rivalryId, leagueId },
      select: { id: true, managerAId: true, managerBId: true },
    })
    if (!rivalry) return NextResponse.json({ error: 'Rivalry not found' }, { status: 404 })

    const url = new URL(req.url)
    const seasonParam = url.searchParams?.get('season')
    const season = seasonParam != null ? parseInt(seasonParam, 10) : null

    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, externalId: true, teamName: true, ownerName: true },
    })
    const teamByExternalId = new Map(teams.map((t) => [t.externalId, t]))

    const where: Prisma.MatchupFactWhereInput = {
      leagueId,
      ...(season != null && !Number.isNaN(season) ? { season } : {}),
      OR: [
        { teamA: rivalry.managerAId, teamB: rivalry.managerBId },
        { teamA: rivalry.managerBId, teamB: rivalry.managerAId },
      ],
    }

    const rows = await prisma.matchupFact.findMany({
      where,
      orderBy: [{ season: 'desc' }, { weekOrPeriod: 'desc' }],
    })

    const history = rows.map((m) => {
      const teamA = teamByExternalId.get(m.teamA)
      const teamB = teamByExternalId.get(m.teamB)
      return {
        matchupId: m.matchupId,
        season: m.season,
        weekOrPeriod: m.weekOrPeriod,
        teamAId: m.teamA,
        teamAName: teamA?.teamName ?? teamA?.ownerName ?? m.teamA,
        teamBId: m.teamB,
        teamBName: teamB?.teamName ?? teamB?.ownerName ?? m.teamB,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        winnerTeamId: m.winnerTeamId,
      }
    })

    return NextResponse.json({
      rivalryId,
      leagueId,
      managerAId: rivalry.managerAId,
      managerBId: rivalry.managerBId,
      history,
    })
  } catch (e) {
    console.error('[rivalries/[rivalryId]/head-to-head GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to get head-to-head history' },
      { status: 500 }
    )
  }
}
