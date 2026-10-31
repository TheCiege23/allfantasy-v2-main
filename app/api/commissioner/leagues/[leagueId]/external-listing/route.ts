import { NextRequest, NextResponse } from "next/server"
import { ownerCommissions } from "@/lib/public-discovery/ownerCommissionerTeams"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { createPlatformNotification } from "@/lib/platform/notification-service"
import {
  EXTERNAL_LISTING_KEY,
  EXTERNAL_LISTING_MAX_SPOTS,
  EXTERNAL_LISTING_NOTE_MAX,
  isNativePlatform,
  listingVerification,
  platformLabel,
  readExternalListing,
} from "@/lib/public-discovery/externalListing"

export const dynamic = "force-dynamic"

/**
 * /api/commissioner/leagues/[leagueId]/external-listing
 *
 * List a league that plays on another platform in Find a League, and answer the players who ask
 * for a spot. Native leagues use /league-finder instead.
 *
 * Only the importer of THIS copy may act, and only when the import showed them to be the
 * commissioner (externalListing.ts). Anyone can import a league they play in; that alone must
 * never let them advertise it.
 *
 *   GET    → { verification, platform, listing, leagueSize, requests[] }
 *   POST   { listed, openSpots, note } → saves the listing
 *   PATCH  { requestId, action: "accept" | "decline", note } → answers a request, tells the player
 */

type Ctx = { params: Promise<{ leagueId: string }> }

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function loadOwnedImportedLeague(leagueId: string) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: "Sign in first." }, { status: 401 }) }
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, userId: true, platform: true, isCommissioner: true, settings: true, leagueSize: true },
  })
  if (!league || league.userId !== userId) {
    return { error: NextResponse.json({ error: "League not found." }, { status: 404 }) }
  }
  if (isNativePlatform(league.platform)) {
    return { error: NextResponse.json({ error: "This league is on AllFantasy; list it from the league finder." }, { status: 400 }) }
  }
  const ownerCommissionsTeam = await ownerCommissions(league)
  return { league, userId, verification: listingVerification({ ...league, ownerCommissionsTeam }) }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const loaded = await loadOwnedImportedLeague(leagueId)
  if ("error" in loaded) return loaded.error
  const { league, verification } = loaded

  const requests = await prisma.findLeagueSpotRequest.findMany({
    where: { leagueId, status: { in: ["pending", "accepted"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      message: true,
      responseNote: true,
      createdAt: true,
      requester: { select: { username: true, displayName: true, avatarUrl: true } },
    },
  })

  return NextResponse.json({
    verification,
    platform: platformLabel(league.platform),
    listing: readExternalListing(league.settings),
    leagueSize: league.leagueSize ?? null,
    requests: requests.map((r) => ({
      id: r.id,
      status: r.status,
      message: r.message,
      responseNote: r.responseNote,
      createdAt: r.createdAt.toISOString(),
      name: r.requester.displayName ?? r.requester.username ?? "A player",
      username: r.requester.username ?? null,
      avatarUrl: r.requester.avatarUrl ?? null,
    })),
  })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const loaded = await loadOwnedImportedLeague(leagueId)
  if ("error" in loaded) return loaded.error
  const { league, verification } = loaded

  const body = toRecord(await req.json().catch(() => null))
  const listed = body.listed === true
  if (listed && !verification) {
    return NextResponse.json(
      {
        error: `Only the league's commissioner can list it, and your import didn't show that you are. Re-import it from your ${platformLabel(league.platform)} commissioner account.`,
      },
      { status: 403 }
    )
  }
  const openSpots = Math.floor(Number(body.openSpots))
  if (listed && (!Number.isFinite(openSpots) || openSpots < 1 || openSpots > EXTERNAL_LISTING_MAX_SPOTS)) {
    return NextResponse.json({ error: `Say how many spots are open (1–${EXTERNAL_LISTING_MAX_SPOTS}).` }, { status: 400 })
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, EXTERNAL_LISTING_NOTE_MAX) : ""
  const previous = readExternalListing(league.settings)

  const settings = toRecord(league.settings)
  const nextSettings = {
    ...settings,
    [EXTERNAL_LISTING_KEY]: listed
      ? { listed: true, openSpots, note: note || null, listedAt: previous.listedAt ?? new Date().toISOString() }
      : { ...toRecord(settings[EXTERNAL_LISTING_KEY]), listed: false, delistedAt: new Date().toISOString() },
  }
  await prisma.league.update({ where: { id: leagueId }, data: { settings: nextSettings as never } })
  return NextResponse.json({ ok: true, listing: readExternalListing(nextSettings) })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const loaded = await loadOwnedImportedLeague(leagueId)
  if ("error" in loaded) return loaded.error
  const { league } = loaded

  const body = toRecord(await req.json().catch(() => null))
  const action = body.action === "accept" ? "accepted" : body.action === "decline" ? "declined" : null
  const requestId = typeof body.requestId === "string" ? body.requestId : ""
  if (!action || !requestId) return NextResponse.json({ error: "Choose accept or decline." }, { status: 400 })
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : ""
  if (action === "accepted" && !note) {
    return NextResponse.json(
      { error: `Add your ${platformLabel(league.platform)} invite link or how to join, so they can take the spot.` },
      { status: 400 }
    )
  }

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
      type: action === "accepted" ? "find_league_spot_accepted" : "find_league_spot_declined",
      title: action === "accepted" ? `You're in: ${leagueName}` : `${leagueName} is full for now`,
      body:
        action === "accepted"
          ? `The commissioner accepted your request. To join on ${platformLabel(league.platform)}: ${note}`
          : note || "The commissioner passed on this one. There are more leagues in Find a League.",
      severity: action === "accepted" ? "high" : "low",
      meta: { actionHref: "/find-league", leagueId },
      sourceKey: `find-league-spot:${requestId}:${action}`,
    }).catch(() => false)
  }
  return NextResponse.json({ ok: true, status: action })
}
