import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireVerifiedUser } from "@/lib/auth-guard"

export const runtime = "nodejs"

function confidenceFromSeeds(seedA: number | null, seedB: number | null) {
  if (seedA == null || seedB == null) return 55
  const diff = Math.abs(seedA - seedB)
  return Math.max(52, Math.min(82, 55 + diff * 3))
}

export async function POST(req: Request) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({} as any))
  const entryId = String(body?.entryId || "")
  if (!entryId) return NextResponse.json({ error: "MISSING_ENTRY_ID" }, { status: 400 })

  const entry = await prisma.bracketEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      userId: true,
      league: {
        select: {
          tournamentId: true,
          tournament: { select: { lockAt: true } },
        },
      },
    },
  })

  if (!entry || entry.userId !== auth.userId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
  }

  const tournamentLockAt = entry.league.tournament?.lockAt
  const advisoryOnly = Boolean(tournamentLockAt && new Date(tournamentLockAt) <= new Date())

  const [nodes, picks] = await Promise.all([
    prisma.bracketNode.findMany({
      where: { tournamentId: entry.league.tournamentId },
      orderBy: [{ round: "asc" }, { slot: "asc" }],
    }),
    prisma.bracketPick.findMany({ where: { entryId }, select: { nodeId: true } }),
  ])

  const gameIds = nodes.map((n) => n.sportsGameId).filter(Boolean) as string[]
  const games = gameIds.length
    ? await prisma.sportsGame.findMany({ where: { id: { in: gameIds } }, select: { id: true, startTime: true } })
    : []
  const gameById = new Map(games.map((g) => [g.id, g]))

  const picked = new Set(picks.map((p) => p.nodeId))
  const now = Date.now()

  const recommendations = nodes
    .filter((n) => !picked.has(n.id))
    .filter((n) => {
      const game = n.sportsGameId ? gameById.get(n.sportsGameId) : null
      if (!game?.startTime) return true
      return new Date(game.startTime).getTime() > now
    })
    .slice(0, 6)
    .map((n) => {
      const homeSeed = n.seedHome ?? null
      const awaySeed = n.seedAway ?? null
      const safePick = homeSeed != null && awaySeed != null && homeSeed <= awaySeed ? n.homeTeamName : n.awayTeamName
      const upsetPick = homeSeed != null && awaySeed != null && homeSeed > awaySeed ? n.homeTeamName : n.awayTeamName

      return {
        nodeId: n.id,
        matchup: `${n.homeTeamName || "TBD"} vs ${n.awayTeamName || "TBD"}`,
        round: n.round,
        safePick,
        upsetPick,
        safeConfidence: confidenceFromSeeds(homeSeed, awaySeed),
        insight:
          n.round >= 4
            ? "Late rounds are high leverage. Favor teams with healthier rotations and recent momentum."
            : "Early rounds: balance one upset dart with mostly value-preserving picks.",
      }
    })

  return NextResponse.json({
    ok: true,
    advisoryOnly,
    recommendations,
    note: advisoryOnly ? "Tournament is locked. Chimmy output is advisory-only." : undefined,
  })
}
