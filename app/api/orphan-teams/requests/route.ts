import { managedRosterWhere } from '@/lib/league/rosterManager'
import { randomUUID } from "crypto"
import { getServerSession } from "next-auth"
import { NextRequest, NextResponse } from "next/server"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  buildOrphanTeamEvaluationPreview,
  getOrphanAdoptionRequests,
  withOrphanAdoptionRequests,
  type OrphanAdoptionRequest,
} from "@/lib/orphan-marketplace"

type SessionWithUser = { user?: { id?: string } } | null

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function collectDraftPicksOwned(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== "object" || Array.isArray(playerData)) return []
  const row = playerData as Record<string, unknown>
  if (!Array.isArray(row.draftPicks)) return []
  const picks: string[] = []
  for (const pick of row.draftPicks) {
    if (!pick || typeof pick !== "object" || Array.isArray(pick)) continue
    const p = pick as Record<string, unknown>
    const season =
      typeof p.season === "number" ? p.season : typeof p.season === "string" ? Number.parseInt(p.season, 10) : null
    const round =
      typeof p.round === "number" ? p.round : typeof p.round === "string" ? Number.parseInt(p.round, 10) : null
    if (!Number.isFinite(season) || !Number.isFinite(round)) continue
    picks.push(`${season} R${round}`)
  }
  return picks
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as SessionWithUser
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const leagueId = typeof body?.leagueId === "string" ? body.leagueId.trim() : ""
  const rosterId = typeof body?.rosterId === "string" ? body.rosterId.trim() : ""
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 500) : ""
  if (!leagueId || !rosterId) {
    return NextResponse.json({ error: "leagueId and rosterId are required" }, { status: 400 })
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      userId: true,
      isDynasty: true,
      scoring: true,
      settings: true,
      rosters: {
        where: { id: rosterId },
        select: { id: true, platformUserId: true, playerData: true },
        take: 1,
      },
      teams: {
        where: { OR: [{ externalId: rosterId }] },
        select: { wins: true, losses: true, ties: true },
        take: 1,
      },
    },
  })
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })
  if (league.userId === userId) {
    return NextResponse.json({ error: "Commissioner cannot request their own orphan listing." }, { status: 400 })
  }

  const roster = league.rosters[0] ?? null
  if (!roster) return NextResponse.json({ error: "Roster not found" }, { status: 404 })
  if (!String(roster.platformUserId || "").startsWith("orphan-")) {
    return NextResponse.json({ error: "Roster is not orphaned." }, { status: 400 })
  }

  const settings = toRecord(league.settings)
  if (settings.orphanSeeking !== true) {
    return NextResponse.json({ error: "This league is not currently accepting orphan adoption requests." }, { status: 400 })
  }

  // TODO: enforce tier when League.requiredTier is added. This request flow is the right
  // place for the 1-tier join gate; invite-code joins stay exempt because they are explicit invites.

  const alreadyInLeague = await prisma.roster.findFirst({
    where: managedRosterWhere(leagueId, userId),
    select: { id: true },
  })
  if (alreadyInLeague) {
    return NextResponse.json({ error: "You already manage a team in this league." }, { status: 409 })
  }

  const [profile, appUser] = await Promise.all([
    prisma.userProfile.findFirst({
      where: { userId },
      select: { displayName: true, sleeperUsername: true },
    }),
    prisma.appUser.findUnique({
      where: { id: userId },
      select: { username: true, displayName: true },
    }),
  ])
  const requesterName =
    profile?.displayName?.trim() ||
    appUser?.displayName?.trim() ||
    appUser?.username?.trim() ||
    profile?.sleeperUsername?.trim() ||
    userId

  const requests = getOrphanAdoptionRequests(league.settings)
  const duplicate = requests.find(
    (request) => request.rosterId === rosterId && request.userId === userId && request.status === "pending"
  )
  if (duplicate) {
    return NextResponse.json(
      { error: "You already have a pending request for this team.", request: duplicate },
      { status: 409 }
    )
  }

  const teamRecord = league.teams[0]
  const wins = Number(teamRecord?.wins ?? 0)
  const losses = Number(teamRecord?.losses ?? 0)
  const ties = Number(teamRecord?.ties ?? 0)
  const draftPicksOwned = collectDraftPicksOwned(roster.playerData)

  const request: OrphanAdoptionRequest = {
    id: randomUUID(),
    leagueId,
    rosterId,
    userId,
    requesterName,
    message: message.length > 0 ? message : null,
    status: "pending",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    commissionerNote: null,
    aiEvaluationSummary: buildOrphanTeamEvaluationPreview({
      wins,
      losses,
      ties,
      rosterPreviewCount: 5,
      draftPicksOwned: draftPicksOwned.length,
      leagueTypeLabel: league.isDynasty ? "Dynasty" : "Redraft",
      scoringFormat: league.scoring ?? "Standard",
    }),
  }

  const nextRequests = [...requests, request]
  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: withOrphanAdoptionRequests(league.settings, nextRequests) as any,
    },
  })

  return NextResponse.json({
    ok: true,
    request,
  })
}

