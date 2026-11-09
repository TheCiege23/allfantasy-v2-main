import { NextRequest, NextResponse } from "next/server"
import { listingAccountId, ownerCommissions } from "@/lib/public-discovery/ownerCommissionerTeams"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { createPlatformNotification } from "@/lib/platform/notification-service"
import { isPaidLeagueSettings } from "@/lib/league/paidLeague"
import { countSeatsHeldByPeople } from "@/lib/league/leagueSeats"
import { getLeagueRole } from "@/lib/league/permissions"
import { CURRENT_DRAFT_SESSION_ORDER } from "@/lib/draft-room/currentDraftSession"
import { leagueAudience } from "@/lib/league-privacy/leagueAudience"
import { isPrivateListingOpen, isPrivateRequestableLeague } from "@/lib/public-discovery/privateLeagueRequests"
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
 * Two kinds of league are asked into here, and they share the FindLeagueSpotRequest row and the
 * commissioner notification:
 *
 *   - a PRIVATE AllFantasy league (lib/public-discovery/privateLeagueRequests.ts): "Ask to join".
 *     The commissioner approves or declines here (GET / PATCH below, Commissioner Hub card), and an
 *     approved player takes the seat through POST /api/leagues/join { action: "join_approved_request" }.
 *   - a league on another platform, below.
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
    select: { id: true, name: true, userId: true, platform: true, isCommissioner: true, settings: true, leagueSize: true },
  })
  if (league && isNativePlatform(league.platform)) return requestPrivateLeague(req, league, userId)

  const listing = league ? readExternalListing(league.settings) : null
  const ownerCommissionsTeam = league && listing?.listed ? await ownerCommissions(league) : false
  if (
    !league ||
    isNativePlatform(league.platform) ||
    !listing?.listed ||
    listing.openSpots < 1 ||
    !listingVerification({ ...league, ownerCommissionsTeam })
  ) {
    return NextResponse.json({ error: "This league isn't taking requests right now." }, { status: 404 })
  }
  // Whose listing it is: the owner, or the proven commissioner of a system-owned ESPN league. The
  // request and its notification go to them, never to the system account.
  const commissionerId = await listingAccountId(league)
  if (!commissionerId) {
    return NextResponse.json({ error: "This league isn't taking requests right now." }, { status: 404 })
  }
  if (commissionerId === userId) return NextResponse.json({ error: "This is your league." }, { status: 400 })

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
    userId: commissionerId,
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

/* ─────────────────────────── private AllFantasy leagues ─────────────────────────── */

type NativeLeague = {
  id: string
  name: string | null
  userId: string
  platform: string
  settings: unknown
  leagueSize: number | null
}

const NOT_TAKING = "This league isn't taking requests right now."

async function isLeagueMember(leagueId: string, userId: string): Promise<boolean> {
  const [roster, member] = await Promise.all([
    prisma.roster.findUnique({
      where: { leagueId_platformUserId: { leagueId, platformUserId: userId } },
      select: { id: true },
    }),
    prisma.redraftLeagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId } },
      select: { id: true },
    }),
  ])
  return Boolean(roster || member)
}

/**
 * "Ask to join" a private AllFantasy league. Every answer is one the card can act on: already in
 * (open the league), already approved (take the seat), pending (wait), full or drafted (no seat to
 * ask for). Nothing about the league beyond what its card already shows is returned.
 */
async function requestPrivateLeague(req: NextRequest, league: NativeLeague, userId: string) {
  if (leagueAudience(league.settings) === "public") {
    return NextResponse.json(
      { error: "This league is open — join it straight from Find a League.", code: "PUBLIC_LEAGUE" },
      { status: 400 }
    )
  }
  if (!isPrivateRequestableLeague(league)) return NextResponse.json({ error: NOT_TAKING }, { status: 404 })
  if (league.userId === userId) return NextResponse.json({ error: "This is your league." }, { status: 400 })

  if (await isLeagueMember(league.id, userId)) {
    return NextResponse.json({ ok: true, status: "member", alreadyMember: true, leagueId: league.id })
  }

  const existing = await prisma.findLeagueSpotRequest.findUnique({
    where: { leagueId_requesterUserId: { leagueId: league.id, requesterUserId: userId } },
    select: { id: true, status: true },
  })
  // Approved already: the seat is theirs to take; the join route re-checks capacity and the draft.
  if (existing?.status === "accepted") {
    return NextResponse.json({ ok: true, status: "accepted", alreadyRequested: true, leagueId: league.id })
  }

  const [seatsHeld, draftSession] = await Promise.all([
    countSeatsHeldByPeople(prisma as never, league.id),
    prisma.draftSession.findFirst({
      where: { leagueId: league.id },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { status: true },
    }),
  ])
  if (!isPrivateListingOpen({ seatsHeld, leagueSize: league.leagueSize, draftStatus: draftSession?.status ?? null })) {
    const full = league.leagueSize != null && seatsHeld >= league.leagueSize
    return NextResponse.json(
      full
        ? { error: "This league is full.", code: "LEAGUE_FULL" }
        : { error: "This league has already drafted, so it isn't adding teams.", code: "DRAFT_STARTED" },
      { status: 409 }
    )
  }

  if (isPaidLeagueSettings(league.settings)) {
    const paidGeo = await paidLeagueGeoVerdict(req, userId)
    if (paidGeo.blocked) {
      return NextResponse.json({ error: paidLeagueGeoMessage(paidGeo, "join"), code: "PAID_GEO_BLOCKED" }, { status: 451 })
    }
  }

  if (existing?.status === "pending") {
    return NextResponse.json({ ok: true, status: "pending", alreadyRequested: true })
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

  const body = (await req.json().catch(() => null)) as { message?: unknown } | null
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 500) : ""

  // Asking again after a decline or withdrawal reopens the same row (one per player per league).
  const request = existing
    ? await prisma.findLeagueSpotRequest.update({
        where: { id: existing.id },
        data: { status: "pending", message: message || null, responseNote: null, respondedAt: null },
        select: { id: true },
      })
    : await prisma.findLeagueSpotRequest.create({
        data: { leagueId: league.id, requesterUserId: userId, message: message || null },
        select: { id: true },
      })

  const requester = await prisma.appUser.findUnique({ where: { id: userId }, select: { displayName: true, username: true } })
  const who = requester?.displayName ?? requester?.username ?? "A player"
  await createPlatformNotification({
    userId: league.userId,
    leagueId: league.id,
    type: "find_league_join_request",
    title: `${who} asked to join ${league.name?.trim() || "your league"}`,
    body: message || "They found it in Find a League. Approve or decline from your Commissioner Hub.",
    severity: "medium",
    meta: { actionHref: `/league/${league.id}`, requestId: request.id },
    sourceKey: `find-league-join:${request.id}:${Date.now()}`,
  }).catch(() => false)

  return NextResponse.json({ ok: true, status: "pending" })
}

/** Head or co-commissioner of a league made on AllFantasy; anything else gets a 404, not a hint. */
async function loadCommissionedNativeLeague(leagueId: string) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: "Sign in first." }, { status: 401 }) }
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, platform: true, settings: true },
  })
  if (!league || !isNativePlatform(league.platform)) {
    return { error: NextResponse.json({ error: "League not found." }, { status: 404 }) }
  }
  const role = await getLeagueRole(leagueId, userId)
  if (role !== "commissioner" && role !== "co_commissioner") {
    return { error: NextResponse.json({ error: "League not found." }, { status: 404 }) }
  }
  return { league, userId }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** GET → the commissioner's queue of "Ask to join" requests for their private league. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const loaded = await loadCommissionedNativeLeague(leagueId)
  if ("error" in loaded) return loaded.error

  const requests = await prisma.findLeagueSpotRequest.findMany({
    where: { leagueId, status: { in: ["pending", "accepted"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      message: true,
      createdAt: true,
      requester: { select: { username: true, displayName: true, avatarUrl: true } },
    },
  })
  return NextResponse.json({
    // Is this league on Find a League as "Ask to join" right now (seats and draft aside)?
    listed: isPrivateRequestableLeague(loaded.league),
    hidden: Boolean(toRecord(loaded.league.settings).leagueFinderDelistedAt),
    requests: requests.map((r) => ({
      id: r.id,
      status: r.status,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
      name: r.requester.displayName ?? r.requester.username ?? "A player",
      username: r.requester.username ?? null,
      avatarUrl: r.requester.avatarUrl ?? null,
    })),
  })
}

/**
 * PATCH { requestId, action: "approve" | "decline", note? } → answers one request and tells the
 * player. Approving lets them take a seat (POST /api/leagues/join, `join_approved_request`); it
 * does not seat them, because the seat is gated on where THEY are (paid leagues) and on capacity
 * at the moment they take it.
 *
 * PATCH { listing: "hide" | "show" } → takes a private league off Find a League (or puts it back).
 * "Hide" writes the same `leagueFinderDelistedAt` the League finder's "Remove" writes, under the
 * league row lock, because `settings` is one JSON column many routes read-modify-write.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const loaded = await loadCommissionedNativeLeague(leagueId)
  if ("error" in loaded) return loaded.error
  const { league } = loaded

  const body = (await req.json().catch(() => null)) as { requestId?: unknown; action?: unknown; note?: unknown; listing?: unknown } | null
  if (body?.listing === "hide" || body?.listing === "show") {
    const hide = body.listing === "hide"
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
      const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
      const settings = { ...toRecord(row?.settings) }
      if (hide) settings.leagueFinderDelistedAt = new Date().toISOString()
      else delete settings.leagueFinderDelistedAt
      await tx.league.update({ where: { id: leagueId }, data: { settings: settings as never } })
    })
    return NextResponse.json({ ok: true, hidden: hide })
  }
  const action = body?.action === "approve" ? "accepted" : body?.action === "decline" ? "declined" : null
  const requestId = typeof body?.requestId === "string" ? body.requestId : ""
  if (!action || !requestId) return NextResponse.json({ error: "Choose approve or decline." }, { status: 400 })
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : ""

  const updated = await prisma.findLeagueSpotRequest.updateMany({
    where: { id: requestId, leagueId, status: "pending" },
    data: { status: action, responseNote: note || null, respondedAt: new Date() },
  })
  if (updated.count === 0) return NextResponse.json({ error: "That request was already answered." }, { status: 409 })

  const request = await prisma.findLeagueSpotRequest.findUnique({ where: { id: requestId }, select: { requesterUserId: true } })
  if (request) {
    const leagueName = league.name?.trim() || "the league"
    await createPlatformNotification({
      userId: request.requesterUserId,
      type: action === "accepted" ? "find_league_join_approved" : "find_league_join_declined",
      title: action === "accepted" ? `You're approved: ${leagueName}` : `${leagueName} passed for now`,
      body:
        action === "accepted"
          ? note || "The commissioner approved your request. Take your seat before it fills."
          : note || "The commissioner passed on this one. There are more leagues in Find a League.",
      severity: action === "accepted" ? "high" : "low",
      meta: { actionHref: action === "accepted" ? `/join?approved=${encodeURIComponent(leagueId)}` : "/find-league", leagueId },
      sourceKey: `find-league-join:${requestId}:${action}`,
    }).catch(() => false)
  }
  return NextResponse.json({ ok: true, status: action })
}
