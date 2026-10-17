import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { addToWatchlist, getWatchlistPlayerIds, mergeWatchlist, removeFromWatchlist } from "@/lib/waiver-wire/watchlist-service"

export const dynamic = "force-dynamic"

/** Confirm the caller belongs to the league (owner or rostered member). */
async function requireMember(leagueId: string, userId: string): Promise<boolean> {
  const [owner, roster] = await Promise.all([
    prisma.league.findFirst({ where: { id: leagueId, userId }, select: { id: true } }),
    prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
  ])
  return Boolean(owner || roster)
}

export async function GET(_req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await requireMember(params.leagueId, userId))) return NextResponse.json({ error: "League not found" }, { status: 404 })
  const playerIds = await getWatchlistPlayerIds(params.leagueId, userId)
  return NextResponse.json({ playerIds })
}

export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await requireMember(params.leagueId, userId))) return NextResponse.json({ error: "League not found" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const sport = typeof body.sport === "string" ? body.sport : null

  // One-time migration of a client's localStorage watchlist.
  if (Array.isArray(body.playerIds)) {
    const merged = await mergeWatchlist(params.leagueId, userId, body.playerIds.map(String), sport)
    const playerIds = await getWatchlistPlayerIds(params.leagueId, userId)
    return NextResponse.json({ ok: true, merged, playerIds })
  }

  const playerId = body.playerId ?? body.player_id
  if (!playerId) return NextResponse.json({ error: "playerId required" }, { status: 400 })
  await addToWatchlist(params.leagueId, userId, String(playerId), sport)
  const playerIds = await getWatchlistPlayerIds(params.leagueId, userId)
  return NextResponse.json({ ok: true, playerIds })
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await requireMember(params.leagueId, userId))) return NextResponse.json({ error: "League not found" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const playerId = body.playerId ?? body.player_id ?? req.nextUrl.searchParams.get("playerId")
  if (!playerId) return NextResponse.json({ error: "playerId required" }, { status: 400 })
  await removeFromWatchlist(params.leagueId, userId, String(playerId))
  const playerIds = await getWatchlistPlayerIds(params.leagueId, userId)
  return NextResponse.json({ ok: true, playerIds })
}