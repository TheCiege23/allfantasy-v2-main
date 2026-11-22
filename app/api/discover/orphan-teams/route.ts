/**
 * Orphan Team Marketplace cards for /orphan-teams.
 * Lists orphan roster slots with roster preview and deterministic AI evaluation preview.
 */

import { getServerSession } from "next-auth"
import { NextRequest, NextResponse } from "next/server"
import { authOptions } from "@/lib/auth"
import { parseOffsetPageParams, cacheControlHeaders } from "@/lib/api-performance"
import { prisma } from "@/lib/prisma"
import { isSupportedSport } from "@/lib/sport-scope"
import {
  buildOrphanTeamEvaluationPreview,
  getOrphanAdoptionRequests,
} from "@/lib/orphan-marketplace"
import { publicReputationForLeagues } from "@/lib/commish-reputation/reputationService"

export const dynamic = "force-dynamic"

type SessionWithUser = { user?: { id?: string } } | null

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function normalizeLeagueType(isDynasty: boolean, settings: Record<string, unknown>): string {
  const raw =
    (typeof settings.league_type === "string" && settings.league_type.trim()) ||
    (typeof settings.leagueType === "string" && settings.leagueType.trim()) ||
    (typeof settings.league_variant === "string" && settings.league_variant.trim()) ||
    (typeof settings.leagueVariant === "string" && settings.leagueVariant.trim()) ||
    ""
  if (raw) return raw
  return isDynasty ? "Dynasty" : "Redraft"
}

function normalizeScoringFormat(fallback: string | null | undefined, settings: Record<string, unknown>): string {
  const raw =
    (typeof settings.scoring_format === "string" && settings.scoring_format.trim()) ||
    (typeof settings.scoringPreset === "string" && settings.scoringPreset.trim()) ||
    (typeof settings.scoringType === "string" && settings.scoringType.trim()) ||
    (typeof fallback === "string" && fallback.trim()) ||
    ""
  return raw || "Standard"
}

function toDisplayName(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  const looksLikeUuid = /^[a-f0-9-]{20,}$/i.test(v)
  const looksLikeId = /^[a-z0-9_:-]{8,}$/i.test(v) && !/\s/.test(v)
  if (looksLikeUuid || looksLikeId) return null
  if (!/[a-z]/i.test(v)) return null
  return v
}

function collectRosterPreview(playerData: unknown): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const pushName = (raw: string) => {
    const name = toDisplayName(raw)
    if (!name) return
    const key = name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(name)
  }

  const visit = (value: unknown) => {
    if (!value || out.length >= 8) return
    if (typeof value === "string") {
      pushName(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item)
        if (out.length >= 8) return
      }
      return
    }
    if (typeof value === "object") {
      const row = value as Record<string, unknown>
      const direct =
        (typeof row.playerName === "string" && row.playerName) ||
        (typeof row.name === "string" && row.name) ||
        (typeof row.fullName === "string" && row.fullName) ||
        (typeof row.full_name === "string" && row.full_name) ||
        null
      if (direct) pushName(direct)

      visit(row.players)
      visit(row.starters)
      visit(row.bench)
      visit(row.roster)
      visit(row.lineup)
      visit(row.assets)
      visit(row.keepers)
    }
  }

  visit(playerData)
  return out.slice(0, 5)
}

function collectDraftPicksOwned(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== "object" || Array.isArray(playerData)) return []
  const row = playerData as Record<string, unknown>
  if (!Array.isArray(row.draftPicks)) return []

  const out: string[] = []
  for (const pick of row.draftPicks) {
    if (!pick || typeof pick !== "object" || Array.isArray(pick)) continue
    const p = pick as Record<string, unknown>
    const season =
      typeof p.season === "number" ? p.season : typeof p.season === "string" ? Number.parseInt(p.season, 10) : null
    const round =
      typeof p.round === "number" ? p.round : typeof p.round === "string" ? Number.parseInt(p.round, 10) : null
    const isValid = Number.isFinite(season) && Number.isFinite(round)
    if (!isValid) continue
    out.push(`${season} R${round}`)
    if (out.length >= 6) break
  }
  return out
}

export async function GET(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as SessionWithUser
    const viewerId = session?.user?.id ?? null

    const sport = req.nextUrl.searchParams?.get("sport")?.trim().toUpperCase() || ""
    const q = req.nextUrl.searchParams?.get("q")?.trim().toLowerCase() || ""
    const leagueTypeFilter = req.nextUrl.searchParams?.get("leagueType")?.trim().toLowerCase() || ""
    const { page, limit, skip } = parseOffsetPageParams(req, 30)

    const rows = await prisma.roster.findMany({
      where: {
        platformUserId: { startsWith: "orphan-" },
        league: sport && isSupportedSport(sport) ? { sport: sport as any } : undefined,
      },
      select: {
        id: true,
        leagueId: true,
        platformUserId: true,
        playerData: true,
        updatedAt: true,
        league: {
          select: {
            id: true,
            name: true,
            sport: true,
            isDynasty: true,
            scoring: true,
            settings: true,
            user: {
              select: { id: true, username: true, displayName: true },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 360,
    })

    const rosterIds = rows.map((row) => row.id)
    const orphanIds = rows.map((row) => row.platformUserId).filter((id): id is string => Boolean(id))
    const leagueIds = Array.from(new Set(rows.map((row) => row.leagueId)))

    const [teamRows, leagueMemberCounts] = await Promise.all([
      rosterIds.length === 0
        ? []
        : prisma.leagueTeam.findMany({
            where: {
              leagueId: { in: leagueIds },
              OR: [{ externalId: { in: rosterIds } }, { externalId: { in: orphanIds } }],
            },
            select: {
              leagueId: true,
              externalId: true,
              teamName: true,
              ownerName: true,
              wins: true,
              losses: true,
              ties: true,
            },
          }),
      leagueIds.length === 0
        ? []
        : prisma.roster.groupBy({
            by: ["leagueId"],
            where: { leagueId: { in: leagueIds } },
            _count: { _all: true },
          }),
    ])

    const teamByLookup = new Map<string, (typeof teamRows)[number]>()
    for (const team of teamRows) {
      teamByLookup.set(`${team.leagueId}:${team.externalId}`, team)
    }
    const memberCountByLeagueId = new Map<string, number>()
    for (const row of leagueMemberCounts) {
      memberCountByLeagueId.set(row.leagueId, row._count._all)
    }

    const cards = rows
      .map((row) => {
        const settings = toRecord(row.league.settings)
        if (settings.orphanSeeking !== true) return null

        const leagueType = normalizeLeagueType(!!row.league.isDynasty, settings)
        const scoringFormat = normalizeScoringFormat(row.league.scoring, settings)
        const team =
          teamByLookup.get(`${row.leagueId}:${row.id}`) ||
          teamByLookup.get(`${row.leagueId}:${row.platformUserId}`) ||
          null
        const wins = Number(team?.wins ?? 0)
        const losses = Number(team?.losses ?? 0)
        const ties = Number(team?.ties ?? 0)
        const rosterPreview = collectRosterPreview(row.playerData)
        const draftPicksOwned = collectDraftPicksOwned(row.playerData)
        const requests = getOrphanAdoptionRequests(row.league.settings)
        const myRequest =
          viewerId != null
            ? requests
                .filter((request) => request.userId === viewerId && request.rosterId === row.id)
                .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null
            : null
        const commissionerName =
          row.league.user.displayName?.trim() ||
          row.league.user.username?.trim() ||
          "Commissioner"

        return {
          id: `${row.leagueId}:${row.id}`,
          leagueId: row.leagueId,
          rosterId: row.id,
          teamName: team?.teamName?.trim() || team?.ownerName?.trim() || "Orphan roster",
          leagueName: row.league.name?.trim() || "Unnamed league",
          leagueType,
          sport: String(row.league.sport),
          record: { wins, losses, ties },
          scoringFormat,
          rosterPreview,
          draftPicksOwned,
          commissionerApprovalRequired: true,
          commissionerName,
          memberCount: memberCountByLeagueId.get(row.leagueId) ?? 0,
          aiEvaluationPreview: buildOrphanTeamEvaluationPreview({
            wins,
            losses,
            ties,
            rosterPreviewCount: rosterPreview.length,
            draftPicksOwned: draftPicksOwned.length,
            leagueTypeLabel: leagueType,
            scoringFormat,
          }),
          myRequestStatus: myRequest?.status ?? null,
          myRequestId: myRequest?.id ?? null,
        }
      })
      .filter((card): card is NonNullable<typeof card> => card != null)
      .filter((card) => {
        if (leagueTypeFilter && !card.leagueType.toLowerCase().includes(leagueTypeFilter)) return false
        if (!q) return true
        return (
          card.leagueName.toLowerCase().includes(q) ||
          card.teamName.toLowerCase().includes(q) ||
          card.sport.toLowerCase().includes(q)
        )
      })

    const total = cards.length
    // Commish reputation badge for commissioners who made it public on that league; a failed read
    // drops the badge, never the card.
    const page_ = cards.slice(skip, skip + limit)
    const reputations = await publicReputationForLeagues(page_.map((c) => c.leagueId)).catch(() => new Map())
    const paginated = page_.map((c) => ({ ...c, commissionerReputation: reputations.get(c.leagueId) ?? null }))

    return NextResponse.json(
      {
        ok: true,
        cards: paginated,
        pagination: {
          page,
          limit,
          total,
          hasMore: skip + paginated.length < total,
        },
      },
      { headers: cacheControlHeaders("medium") }
    )
  } catch (error) {
    console.error("[discover/orphan-teams]", error)
    return NextResponse.json({ error: "Failed to load orphan teams" }, { status: 500 })
  }
}

