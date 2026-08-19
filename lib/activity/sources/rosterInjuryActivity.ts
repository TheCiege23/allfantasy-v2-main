import "server-only"

import { computeUserPlayerExposure } from "@/lib/shared-services/game-day/UserPlayerExposureService"
import { resolveInjuryContext } from "@/lib/decision-os/world/injuryEnrichedWorld"
import { resolvePlayerNamesForSport } from "@/lib/roster/resolvePlayerNames"
import type { ActivityFeedItem, ActivitySourceContext } from "@/lib/activity/types"

/**
 * The id-space that joins cleanly here is Sleeper/NFL: `computeUserPlayerExposure` returns raw
 * roster player ids, and `resolveInjuryContext` keys the cached SportsPlayer status on
 * externalId/sleeperId. (The raw SportsInjury/InjuryReportRecord tables use an API-Sports id space
 * that does NOT match roster ids — resolveInjuryContext is the seam built to route around that.)
 */
const INJURY_SPORT = "NFL"

/** Map a raw Sleeper-sourced status token to a readable label. Fixed mapping — never fabricated. */
function formatInjuryStatus(status: string | null): string {
  const key = String(status ?? "").trim().toLowerCase()
  switch (key) {
    case "q":
    case "questionable":
      return "Questionable"
    case "d":
    case "doubtful":
      return "Doubtful"
    case "o":
    case "out":
      return "Out"
    case "ir":
      return "on IR"
    case "pup":
      return "on PUP"
    case "sus":
    case "suspended":
      return "Suspended"
    case "na":
    case "inactive":
      return "Inactive"
    default:
      return status ? status.trim() : "Injured"
  }
}

/**
 * Source 3 — injuries hitting the viewer's rosters (the emotional hook). Reads the players the
 * viewer actually rosters across every league (one indexed `roster` query), intersects them with
 * the CACHED injury status (one indexed `sportsPlayer` query, no live provider hit), and emits an
 * `injury` item ONLY for a player the viewer truly owns whose availability is uncertain/unavailable
 * ("CMC (RB) → Questionable — on 2 of your rosters"). Returns [] (never throws); nothing is fabricated.
 */
export async function collectRosterInjuryActivity(ctx: ActivitySourceContext): Promise<ActivityFeedItem[]> {
  try {
    const { exposures } = await computeUserPlayerExposure({ userId: ctx.userId })
    if (exposures.length === 0) return []

    const playerIds = exposures.map((e) => e.playerId).filter(Boolean)
    if (playerIds.length === 0) return []

    const injury = await resolveInjuryContext(INJURY_SPORT, playerIds)

    // Fill in any names the exposure couldn't resolve, so we never show a raw player id.
    const missingNameIds = exposures.filter((e) => !e.playerName).map((e) => e.playerId)
    const fallbackNames = missingNameIds.length
      ? await resolvePlayerNamesForSport(missingNameIds, INJURY_SPORT)
      : new Map<string, string>()

    const items: ActivityFeedItem[] = []
    for (const exp of exposures) {
      const ctxRow = injury.byId.get(exp.playerId)
      if (!ctxRow) continue
      // Only surface genuinely roster-affecting statuses. 'available'/'unknown' aren't worth a ping.
      if (ctxRow.availabilityCategory !== "unavailable" && ctxRow.availabilityCategory !== "uncertain") continue

      const name = exp.playerName ?? fallbackNames.get(exp.playerId) ?? null
      if (!name) continue // no honest name → omit rather than surface a raw id

      const statusLabel = formatInjuryStatus(ctxRow.status)
      const rostersLabel = exp.leagueCount === 1 ? "1 of your rosters" : `${exp.leagueCount} of your rosters`
      const posLabel = exp.position ? ` (${exp.position})` : ""
      // Freshness timestamp = when we last learned this status, so a change re-sorts/re-animates.
      const learnedAt = ctxRow.freshness?.updatedAt ?? ctxRow.freshness?.fetchedAt ?? null

      items.push({
        // Include the status so a status change produces a new id (slides in as fresh).
        id: `injury:${exp.playerId}:${String(ctxRow.status ?? "").toLowerCase()}`,
        type: "injury",
        userId: "",
        userName: name,
        avatarUrl: null,
        description: `${name}${posLabel} → ${statusLabel} — on ${rostersLabel}`,
        timestamp: learnedAt ? new Date(learnedAt).toISOString() : new Date().toISOString(),
        leagueId: null,
        leagueName: null,
        href: "/my-players",
        source: "injury",
      })
    }

    return items
  } catch (err) {
    console.error("[api/shared/activity] injury source failed:", err)
    return []
  }
}
