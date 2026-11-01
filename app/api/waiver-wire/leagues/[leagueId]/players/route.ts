import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
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
import { identityNameKey } from "@/lib/redraft/rosterGameLogIdBridge"
import {
  linkedRosteredProspectIds,
  loadNhlProspectFreeAgents,
  NHL_PROSPECT_FA_LIST_LIMIT,
  NHL_PROSPECT_FA_SEARCH_LIMIT,
  NHL_PROSPECT_WIRE_SOURCE,
  nhlProspectPoolRow,
  offersNhlProspectFreeAgency,
} from "@/lib/waiver-wire/nhlProspectFreeAgency"

export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const leagueId = params.leagueId
  const coOwnerRosterId = await acceptedCoOwnerRosterId(leagueId, userId)
  const searchParams = req.nextUrl.searchParams
  const querySport = searchParams.get("sport")?.toUpperCase() ?? undefined
  const position = searchParams.get("position") ?? undefined
  const teamId = searchParams.get("teamId") ?? undefined
  // NHL dynasty: `prospectsOnly=1&q=<name>` searches the Fantrax prospects beyond the listed cap.
  const prospectsOnly = searchParams.get("prospectsOnly") === "1"
  const prospectQuery = searchParams.get("q")?.trim() ?? ""

  const [league, rosterAsMember] = await Promise.all([
    (prisma as any).league.findFirst({
      where: { id: leagueId },
      select: { id: true, sport: true, userId: true, isDynasty: true, leagueType: true, leagueVariant: true, waiverHours: true, season: true, settings: true },
    }),
    (prisma as any).roster.findFirst({
      where: coOwnerRosterId ? { leagueId, id: coOwnerRosterId } : { leagueId, platformUserId: userId },
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

    // NHL dynasty only (lib/waiver-wire/nhlProspectFreeAgency.ts). Everywhere else this is false and
    // the route below is exactly what it was.
    const offerProspects = offersNhlProspectFreeAgency(league)
    if (prospectsOnly) {
      if (!offerProspects || prospectQuery.length < 2) return NextResponse.json({ players: [], rosteredCount: rosteredIds.size })
      const found = await loadNhlProspectFreeAgents(prisma as never, {
        rosteredIds,
        query: prospectQuery,
        limit: NHL_PROSPECT_FA_SEARCH_LIMIT,
      }).catch(() => null)
      const players = (found?.prospects ?? []).map((p) => prospectWireRow(p, String(league.sport)))
      return NextResponse.json({ players, rosteredCount: rosteredIds.size })
    }

    const pool = await loadLeagueWaiverPlayerPool(league, {
      position,
      teamId,
    })

    // A rostered `fantrax:X` the weekly link has since attached to an NHL identity: that identity's pro
    // row is the same man, so it is rostered too. A failed read changes nothing.
    const linkedProspectIds = offerProspects
      ? await linkedRosteredProspectIds(prisma as never, rosteredIds).catch(() => new Set<string>())
      : new Set<string>()

    const available = pool.filter((p: any) => {
      const playerId = p.player_id == null ? null : String(p.player_id)
      const externalSourceId = p.external_source_id == null ? null : String(p.external_source_id)
      return !(
        (playerId && (rosteredIds.has(playerId) || linkedProspectIds.has(playerId))) ||
        (externalSourceId && (rosteredIds.has(externalSourceId) || linkedProspectIds.has(externalSourceId)))
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

    // Prospects go AFTER every pool player: no projection, ADP or rank exists for them. A failed
    // universe read leaves the list as it was. Position / team filters apply to them as to the pool.
    if (offerProspects) {
      const poolNames = new Set<string>()
      for (const p of pool as any[]) {
        const k = identityNameKey(p.full_name)
        if (k) poolNames.add(k)
      }
      const loaded = await loadNhlProspectFreeAgents(prisma as never, { rosteredIds, poolNames, limit: NHL_PROSPECT_FA_LIST_LIMIT }).catch((err) => {
        console.warn("[waiver-wire/players] NHL Fantrax prospects unavailable", err instanceof Error ? err.message : String(err))
        return null
      })
      if (loaded) {
        const pos = position?.trim().toUpperCase()
        const team = teamId?.trim().toUpperCase()
        const rows = loaded.prospects
          .filter((p) => (!pos || pos === "ALL" || p.position === pos) && (!team || (p.orgTeam ?? "") === team))
          .map((p) => {
            const dto = prospectWireRow(p, String(league.sport))
            const hold = holds.get(p.playerId)
            return hold ? { ...dto, onWaiversUntil: hold.until.toISOString() } : dto
          })
        return NextResponse.json({
          players: [...priced, ...rows],
          rosteredCount: rosteredIds.size,
          nhlProspects: { total: loaded.total, listed: loaded.prospects.length },
        })
      }
    }

    return NextResponse.json({ players: priced, rosteredCount: rosteredIds.size })
  } catch (error) {
    console.error("Failed to fetch waiver wire players:", error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }
}

/** A Fantrax prospect serialized like any pool player, marked so the screens badge him. */
function prospectWireRow(p: Parameters<typeof nhlProspectPoolRow>[0], sport: string) {
  const dto = serializeUnifiedPlayerForApi(normalizePoolRowToUnified(nhlProspectPoolRow(p) as never, sport))
  return { ...dto, id: p.playerId, team: p.orgTeam, prospectSource: NHL_PROSPECT_WIRE_SOURCE }
}
