import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getRosterPlayerIds } from "@/lib/waiver-wire/roster-utils"
import { loadLeagueWaiverPlayerPool } from "@/lib/waiver-wire/current-nba-player-pool"
import { normalizePoolRowToUnified } from "@/lib/player-data/normalizeProviderPlayer"
import { serializeUnifiedPlayerForApi } from "@/lib/player-data/serializeUnifiedPlayerForApi"
import { loadWaiverPoolEnrichment, type WaiverPoolEnrichment } from "@/lib/waiver-wire/waiverPoolEnrichment"
import { getEffectiveLeagueWaiverSettings } from "@/lib/waiver-wire/settings-service"
import {
  droppedPlayerHoldPolicy,
  loadDroppedPlayerHolds,
  type DroppedPlayerHold,
} from "@/lib/waiver-wire/dropped-player-waivers"
import { isDailyFormSport } from "@/lib/projections/dailySportForm"
import { applyDailySportOutlook, loadDailySportOutlook } from "@/lib/projections/dailySportOutlook"

export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
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
      select: { id: true, sport: true, userId: true, isDynasty: true, leagueVariant: true, waiverHours: true, season: true, settings: true },
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

    const pool = await loadLeagueWaiverPlayerPool(league, {
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

    // Photo, crest and season stats, from Postgres (see waiverPoolEnrichment for why this is not
    // an id join: a pool row's `player_id` is a SportsPlayer UUID that no sports_players row has).
    const enrichment = await loadWaiverPoolEnrichment(String(league.sport), available).catch(
      () => new Map<string, WaiverPoolEnrichment>(),
    )

    // Recently dropped players are on waivers until they clear (dropped-player-waivers.ts); the
    // screen shows "On waivers until …" and routes them to a claim. A failed read shows none.
    const holds = await getEffectiveLeagueWaiverSettings(leagueId)
      .then((eff) => {
        const policy = droppedPlayerHoldPolicy({
          normalizedWaiverType: eff.normalizedWaiverType,
          waiverHours: league.waiverHours,
          waiverEngineConfig: eff.waiverEngineConfig,
          sport: league.sport ? String(league.sport) : null,
        })
        return loadDroppedPlayerHolds(leagueId, policy)
      })
      .catch(() => new Map<string, DroppedPlayerHold>())

    const players = available.map((p: any) => {
      const extra = p.player_id == null ? undefined : enrichment.get(String(p.player_id))
      const row = extra ? { ...p, metadata: { ...(p.metadata ?? {}), ...extra.metadata } } : p
      const dto = serializeUnifiedPlayerForApi(
        normalizePoolRowToUnified(row, league.sport, {
          augment: { sportsPlayerRecord: extra?.sportsPlayerRecord },
        }),
      )
      // A roster stores whichever id the player was added by — the pool id or the source id.
      const hold =
        (p.player_id != null ? holds.get(String(p.player_id)) : undefined) ??
        (p.external_source_id != null ? holds.get(String(p.external_source_id)) : undefined) ??
        holds.get(dto.id)
      return hold ? { ...dto, onWaiversUntil: hold.until.toISOString() } : dto
    })

    // NBA / NHL / MLB: AF projection for this period + position rank, under this league's scoring.
    // Looked up by the pool row's external id — the id a drafted player carries on a roster — so a
    // waiver row and the same player on a lineup resolve identically (lib/projections/dailySportOutlook.ts).
    let priced = players
    if (isDailyFormSport(String(league.sport))) {
      try {
        const outlook = await loadDailySportOutlook(prisma, {
          league: { sport: String(league.sport), season: league.season ?? null, settings: league.settings },
          // Keyed by position: `players[i]` is serialized from `available[i]`, whatever id it ends up with.
          players: available.map((p: any, i: number) => ({
            key: String(i),
            lookupId: p.external_source_id != null ? String(p.external_source_id) : p.player_id != null ? String(p.player_id) : null,
            team: p.team_abbreviation ?? p.team ?? null,
            injuryStatus: p.injury_status ?? null,
          })),
        })
        priced = applyDailySportOutlook(players, outlook, (_row, i) => String(i))
      } catch (error) {
        console.warn("[waiver-wire/players] daily-sport outlook failed", error instanceof Error ? error.message : String(error))
      }
    }

    return NextResponse.json({ players: priced, rosteredCount: rosteredIds.size })
  } catch (error) {
    console.error("Failed to fetch waiver wire players:", error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }
}
