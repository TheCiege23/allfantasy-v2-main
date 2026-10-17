import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

/**
 * GET: Returns the current user's roster players for this league.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const leagueId = params.leagueId

  // Check if user is in the league
  const [leagueAsOwner, rosterAsMember] = await Promise.all([
    (prisma as any).league.findFirst({ where: { id: leagueId, userId } }),
    (prisma as any).roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { id: true, playerData: true }
    }),
  ])

  if (!leagueAsOwner && !rosterAsMember) {
    return NextResponse.json({ error: "League not found" }, { status: 404 })
  }

  // Get the roster with player data
  const roster = await (prisma as any).redraftRoster.findFirst({
    where: {
      season: {
        leagueId: leagueId,
      },
      ownerId: userId,
    },
    select: {
      id: true,
    },
  })

  if (!roster) {
    return NextResponse.json({ players: [], rosterId: null })
  }

  // Get roster players
  const rosterPlayers = await (prisma as any).redraftRosterPlayer.findMany({
    where: {
      rosterId: roster.id,
    },
    select: {
      playerId: true,
      playerName: true,
      position: true,
      team: true,
    },
  })

  const playerIds = rosterPlayers.map((p: any) => p.playerId)

  return NextResponse.json({
    players: playerIds,
    rosterId: roster.id,
    playerDetails: rosterPlayers.map((p: any) => ({
      id: p.playerId,
      name: p.playerName || p.playerId,
      position: p.position || 'N/A',
      team: p.team || 'FA',
    })),
  })
}