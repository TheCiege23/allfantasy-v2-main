import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getRosterPlayerIds } from "@/lib/waiver-wire/roster-utils"
import { getPlayerPoolForLeague } from "@/lib/sport-teams/SportPlayerPoolResolver"
import { normalizePoolRowToUnified } from "@/lib/player-data/normalizeProviderPlayer"
import { serializeUnifiedPlayerForApi } from "@/lib/player-data/serializeUnifiedPlayerForApi"

export async function GET(req: NextRequest, { params }: { params: { leagueId: string } }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const leagueId = params.leagueId
  const searchParams = req.nextUrl.searchParams
  const querySport = searchParams.get("sport")?.toUpperCase() ?? undefined
  const position = searchParams.get("position") ?? undefined
  const teamId = searchParams.get("teamId") ?? undefined

  const [league, rosterAsMember] = await Promise.all([
    (prisma as any).league.findFirst({
      where: { id: leagueId },
      select: { id: true, sport: true, userId: true },
    }),
    (prisma as any).roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { id: true },
    }),
  ])

  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })
  if (league.userId !== userId && !rosterAsMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (querySport && querySport !== String(league.sport).toUpperCase()) {
    return NextResponse.json(
      { error: `Sport mismatch: league is ${league.sport}, query requested ${querySport}` },
      { status: 400 }
    )
  }

  try {
    const allRosters = await (prisma as any).roster.findMany({
      where: { leagueId },
      select: { playerData: true },
    })

    const rosteredIds = new Set<string>()
    for (const roster of allRosters) {
      for (const id of getRosterPlayerIds(roster.playerData)) {
        rosteredIds.add(id)
      }
    }

    const pool = await getPlayerPoolForLeague(leagueId, league.sport, {
      limit: 800,
      position,
      teamId,
    })

    const available = pool.filter((p: any) => {
      const playerId = p.player_id == null ? null : String(p.player_id)
      const externalSourceId = p.external_source_id == null ? null : String(p.external_source_id)
      return !(
        (playerId && rosteredIds.has(playerId)) ||
        (externalSourceId && rosteredIds.has(externalSourceId))
      )
    })

    const availablePlayerIds = available
      .map((p: any) => (p.player_id == null ? null : String(p.player_id)))
      .filter((id: string | null): id is string => Boolean(id))
    const sportsPlayerRows =
      availablePlayerIds.length > 0
        ? await (prisma as any).sportsPlayerRecord
            .findMany({
              where: {
                id: { in: availablePlayerIds },
                sport: String(league.sport).toUpperCase(),
              },
              select: {
                id: true,
                stats: true,
                projections: true,
                dataSource: true,
                headshotSource: true,
                adp: true,
              },
            })
            .catch(() => [])
        : []
    const sportsPlayerById = new Map<string, any>(
      sportsPlayerRows.map((row: any) => [String(row.id), row]),
    )

    const players = available.map((p: any) =>
      serializeUnifiedPlayerForApi(
        normalizePoolRowToUnified(p, league.sport, {
          augment: {
            sportsPlayerRecord:
              p.player_id == null ? undefined : sportsPlayerById.get(String(p.player_id)),
          },
        }),
      ),
    )

    return NextResponse.json({ players, rosteredCount: rosteredIds.size })
  } catch (error) {
    console.error("Failed to fetch waiver wire players:", error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }
}
