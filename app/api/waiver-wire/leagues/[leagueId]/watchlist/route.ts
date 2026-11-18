import { watchlistKeyForUser } from '@/lib/league/teamScopedKey'
import { requestedRosterIdFrom } from '@/lib/league/viewerTeams'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
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
  return Boolean(owner || roster || await acceptedCoOwnerRosterId(leagueId, userId))
}

export async function GET(_req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await requireMember(params.leagueId, userId))) return NextResponse.json({ error: "League not found" }, { status: 404 })
  // Each team has its own watchlist: the team named, else the team this manager switched to.
  const watchKey = await watchlistKeyForUser(params.leagueId, userId, requestedRosterIdFrom(_req))
  const playerIds = await getWatchlistPlayerIds(params.leagueId, watchKey)
  return NextResponse.json({ playerIds })
}

export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await requireMember(params.leagueId, userId))) return NextResponse.json({ error: "League not found" }, { status: 404 })
  // Each team has its own watchlist: the team named, else the team this manager switched to.
  const watchKey = await watchlistKeyForUser(params.leagueId, userId, requestedRosterIdFrom(req))

  const body = await req.json().catch(() => ({}))
  const sport = typeof body.sport === "string" ? body.sport : null

  // One-time migration of a client's localStorage watchlist.
  if (Array.isArray(body.playerIds)) {
    const merged = await mergeWatchlist(params.leagueId, watchKey, body.playerIds.map(String), sport)
    const playerIds = await getWatchlistPlayerIds(params.leagueId, watchKey)
    return NextResponse.json({ ok: true, merged, playerIds })
  }

  const playerId = body.playerId ?? body.player_id
  if (!playerId) return NextResponse.json({ error: "playerId required" }, { status: 400 })
  await addToWatchlist(params.leagueId, watchKey, String(playerId), sport)
  const playerIds = await getWatchlistPlayerIds(params.leagueId, watchKey)
  return NextResponse.json({ ok: true, playerIds })
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await requireMember(params.leagueId, userId))) return NextResponse.json({ error: "League not found" }, { status: 404 })
  // Each team has its own watchlist: the team named, else the team this manager switched to.
  const watchKey = await watchlistKeyForUser(params.leagueId, userId, requestedRosterIdFrom(req))

  const body = await req.json().catch(() => ({}))
  const playerId = body.playerId ?? body.player_id ?? req.nextUrl.searchParams.get("playerId")
  if (!playerId) return NextResponse.json({ error: "playerId required" }, { status: 400 })
  await removeFromWatchlist(params.leagueId, watchKey, String(playerId))
  const playerIds = await getWatchlistPlayerIds(params.leagueId, watchKey)
  return NextResponse.json({ ok: true, playerIds })
}