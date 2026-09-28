import { toImageUrl } from '@/lib/media/imageUrl'
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

const EXCLUDED_POSITIONS = new Set([
  "DL", "DT", "DE", "NT", "EDGE",
  "LB", "ILB", "OLB", "MLB",
  "CB", "S", "SS", "FS", "DB", "NB", "NCB",
  "IDP",
  "OL", "OG", "OT", "C", "G", "T", "LG", "RG", "LT", "RT",
  "LS", "SN", "HOLDER",
  "UNK", "UNKNOWN",
])

const POSITION_PRIORITY: Record<string, number> = {
  "QB": 5,
  "RB": 4,
  "WR": 3,
  "TE": 2,
  "FLEX": 1,
  "K": 0,
  "PK": 0,
  "P": -1,
}

const GENERIC_HEADSHOT = "/images/player-placeholder.svg"

function normalizePosition(position: string | null | undefined): string {
  if (!position) return "N/A"
  const upper = position.toUpperCase().trim()
  if (["QB", "RB", "WR", "TE", "FLEX", "K", "PK", "P"].includes(upper)) return upper
  if (upper.includes("QUARTERBACK")) return "QB"
  if (upper.includes("RUNNING BACK") || upper.includes("RUNNINGBACK")) return "RB"
  if (upper.includes("WIDE RECEIVER") || upper.includes("WIDERECEIVER")) return "WR"
  if (upper.includes("TIGHT END")) return "TE"
  if (upper.includes("KICKER")) return "K"
  if (upper.includes("PUNTER")) return "P"
  const match = upper.match(/\(([A-Z]+)\)/)
  if (match) return match[1]
  return upper.substring(0, 3) || "N/A"
}

export async function GET(
  req: NextRequest,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const leagueId = params.leagueId

  // Check if user is in the league
  const [league, rosterAsMember] = await Promise.all([
    (prisma as any).league.findFirst({
      where: { id: leagueId },
      select: { id: true, sport: true, userId: true },
    }),
    (prisma as any).roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
  ])

  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })
  if (league.userId !== userId && !rosterAsMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  try {
    // Get all rostered player IDs
    const rosteredPlayers = await prisma.redraftRosterPlayer.findMany({
      where: {
        roster: {
          season: {
            leagueId: leagueId,
          },
        },
      },
      select: { playerId: true },
    })

    const rosteredPlayerIds = rosteredPlayers.map((rp: any) => rp.playerId)

    // Get available players
    let players = await prisma.sportsPlayer.findMany({
      where: {
        sport: league.sport,
        id: {
          notIn: rosteredPlayerIds.length > 0 ? rosteredPlayerIds : [],
        },
      },
      take: 200,
      select: {
        id: true,
        name: true,
        position: true,
        team: true,
        imageUrl: true,
      },
    })

    // Get player images from player_images table
    const playerIds = players.map((p: any) => p.id)
    let playerImages: Record<string, string> = {}
    if (playerIds.length > 0) {
      try {
        const images = await (prisma as any).playerImage.findMany({
          where: {
            playerId: { in: playerIds },
            isPrimary: true,
          },
          select: {
            playerId: true,
            url: true,
          },
        })
        images.forEach((img: any) => {
          playerImages[img.playerId] = img.url
        })
      } catch (e) {
        // Table might not exist yet
      }
    }

    // Filter and format
    const formattedPlayers = players
      .filter((p: any) => {
        const pos = (p.position || "").toUpperCase().trim()
        return !EXCLUDED_POSITIONS.has(pos)
      })
      .map((p: any) => {
        const normalizedPos = normalizePosition(p.position)
        return {
          id: p.id,
          name: p.name || "Unknown",
          position: normalizedPos,
          team: p.team || "FA",
          projectedPoints: 0,
          rostered: 0,
          trending: "neutral" as const,
          imageUrl: playerImages[p.id] || toImageUrl(p.imageUrl) || GENERIC_HEADSHOT,
        }
      })
      .sort((a: any, b: any) => {
        const pointsA = a.projectedPoints || 0
        const pointsB = b.projectedPoints || 0
        if (pointsA !== pointsB) return pointsB - pointsA
        const posA = POSITION_PRIORITY[a.position] ?? 0
        const posB = POSITION_PRIORITY[b.position] ?? 0
        return posB - posA
      })

    return NextResponse.json({ 
      players: formattedPlayers,
      rosteredCount: rosteredPlayerIds.length,
      totalFound: players.length,
    })
  } catch (error) {
    console.error("Failed to fetch players:", error)
    return NextResponse.json(
      { error: "Failed to fetch players" },
      { status: 500 }
    )
  }
}