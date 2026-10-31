import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { createPlatformNotification } from "@/lib/platform/notification-service"
import { isPaidLeagueSettings } from "@/lib/league/paidLeague"
import { paidLeagueGeoMessage, paidLeagueGeoVerdict } from "@/lib/geo/paidLeagueGeo"
import {
  isNativePlatform,
  listingVerification,
  platformLabel,
  readExternalListing,
} from "@/lib/public-discovery/externalListing"

export const dynamic = "force-dynamic"

/** Spot requests one player may send in a day, across every league. */
const SPOT_REQUESTS_PER_DAY = 10

type Ctx = { params: Promise<{ leagueId: string }> }

/**
 * POST /api/find-league/leagues/[leagueId]/request  { message? }
 *
 * "Request a spot" in a league that plays on another platform (externalListing.ts). It writes
 * one FindLeagueSpotRequest per player per league and tells the commissioner, who answers from
 * the Commissioner Hub with their platform invite.
 *
 * The same rules discovery applies are re-checked here, since anyone can POST: the league must
 * still be listed by a verified commissioner, and a paid league is refused where paid leagues
 * are restricted.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Sign in to ask for a spot." }, { status: 401 })

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, userId: true, platform: true, isCommissioner: true, settings: true },
  })
  const listing = league ? readExternalListing(league.settings) : null
  if (!league || isNativePlatform(league.platform) || !listing?.listed || listing.openSpots < 1 || !listingVerification(league)) {
    return NextResponse.json({ error: "This league isn't taking requests right now." }, { status: 404 })
  }
  if (league.userId === userId) return NextResponse.json({ error: "This is your league." }, { status: 400 })

  if (isPaidLeagueSettings(league.settings)) {
    const paidGeo = await paidLeagueGeoVerdict(req, userId)
    if (paidGeo.blocked) {
      return NextResponse.json({ error: paidLeagueGeoMessage(paidGeo, "join"), code: "PAID_GEO_BLOCKED" }, { status: 451 })
    }
  }

  const body = (await req.json().catch(() => null)) as { message?: unknown } | null
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 500) : ""

  const existing = await prisma.findLeagueSpotRequest.findUnique({
    where: { leagueId_requesterUserId: { leagueId, requesterUserId: userId } },
    select: { id: true, status: true },
  })
  if (existing && (existing.status === "pending" || existing.status === "accepted")) {
    return NextResponse.json({ ok: true, status: existing.status, alreadyRequested: true })
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recent = await prisma.findLeagueSpotRequest.count({
    where: { requesterUserId: userId, updatedAt: { gte: since } },
  })
  if (recent >= SPOT_REQUESTS_PER_DAY) {
    return NextResponse.json(
      { error: `That's ${SPOT_REQUESTS_PER_DAY} requests today. Give the commissioners a day to answer.` },
      { status: 429 }
    )
  }

  // Asking again after a decline or withdrawal reopens the same row (one per player per league).
  const request = existing
    ? await prisma.findLeagueSpotRequest.update({
        where: { id: existing.id },
        data: { status: "pending", message: message || null, responseNote: null, respondedAt: null },
        select: { id: true },
      })
    : await prisma.findLeagueSpotRequest.create({
        data: { leagueId, requesterUserId: userId, message: message || null },
        select: { id: true },
      })

  const requester = await prisma.appUser.findUnique({ where: { id: userId }, select: { displayName: true, username: true } })
  const who = requester?.displayName ?? requester?.username ?? "A player"
  await createPlatformNotification({
    userId: league.userId,
    leagueId,
    type: "find_league_spot_request",
    title: `${who} wants a spot in ${league.name?.trim() || "your league"}`,
    body: message || `They found it in Find a League. Answer from the Commissioner Hub with your ${platformLabel(league.platform)} invite.`,
    severity: "medium",
    meta: { actionHref: `/league/${leagueId}`, requestId: request.id },
    sourceKey: `find-league-spot:${request.id}:${Date.now()}`,
  }).catch(() => false)

  return NextResponse.json({ ok: true, status: "pending" })
}
