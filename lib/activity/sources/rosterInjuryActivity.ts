import "server-only"

import { computeUserPlayerExposure } from "@/lib/shared-services/game-day/UserPlayerExposureService"
import { resolveInjuryContext } from "@/lib/decision-os/world/injuryEnrichedWorld"
import { resolvePlayerNamesForSport } from "@/lib/roster/resolvePlayerNames"
import type { ActivityFeedItem, ActivitySourceContext } from "@/lib/activity/types"
import type { UserPlayerExposure } from "@/lib/shared-services/game-day/types"
import { loadEspnToSleeperMap } from "@/lib/core-app/rosterIdSpace"

/**
 * The id-space that joins cleanly here is Sleeper/NFL: `computeUserPlayerExposure` returns raw
 * roster player ids — narrowed to NFL Sleeper ids by `sleeperNflExposures` below — and `resolveInjuryContext` keys the cached SportsPlayer status on
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
 * The viewer's exposures as NFL Sleeper ids — the only space the injury context and name reads below
 * are keyed on.
 *
 * 🛑 `computeUserPlayerExposure` READS EVERY LEAGUE THE VIEWER PLAYS IN, AND THEIR IDS ARE NOT ALL
 * SLEEPER'S. Passed through raw, a native NHL roster's Rolling Insights ids were read as NFL Sleeper
 * ids — 13 of the 18 on the one reachable production NHL roster ARE NFL Sleeper ids for somebody else
 * (2026-09-29) — and a Fleaflicker/Fantrax id collides the same way, so the feed could announce a
 * stranger as injured "on 1 of your rosters". So:
 *   - Sleeper-space NFL (Sleeper and native NFL leagues): as is.
 *   - ESPN: translated through `PlayerIdentityMap.espnId`. An id with no Sleeper identity is DROPPED —
 *     kept, it is a number that may be somebody's Sleeper id. Translated, the same person on a Sleeper
 *     and an ESPN roster is one player "on 2 of your rosters", not two items.
 *   - any other platform, or any other sport: dropped. There is no Sleeper id to ask about.
 */
async function sleeperNflExposures(exposures: readonly UserPlayerExposure[]): Promise<UserPlayerExposure[]> {
  const nfl = exposures.filter((e) => e.sport === INJURY_SPORT)
  const espnIds = nfl.filter((e) => e.idSpace === "espn").map((e) => e.playerId)
  const espnToSleeper = espnIds.length > 0 ? await loadEspnToSleeperMap(espnIds) : new Map<string, string>()

  const bySleeperId = new Map<string, UserPlayerExposure>()
  for (const e of nfl) {
    const sleeperId = e.idSpace === "sleeper" ? e.playerId : e.idSpace === "espn" ? espnToSleeper.get(e.playerId) : undefined
    if (!sleeperId) continue
    const held = bySleeperId.get(sleeperId)
    if (!held) {
      bySleeperId.set(sleeperId, { ...e, playerId: sleeperId, idSpace: "sleeper" })
      continue
    }
    held.leagueCount += e.leagueCount
    held.playerName = held.playerName ?? e.playerName
    held.position = held.position ?? e.position
  }
  return [...bySleeperId.values()]
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
    const { exposures: allExposures } = await computeUserPlayerExposure({ userId: ctx.userId })
    const exposures = await sleeperNflExposures(allExposures)
    if (exposures.length === 0) return []

    const playerIds = exposures.map((e) => e.playerId).filter(Boolean)
    if (playerIds.length === 0) return []

    const injury = await resolveInjuryContext(INJURY_SPORT, playerIds)

    // Fill in any names the exposure couldn't resolve, so we never show a raw player id.
    const missingNameIds = exposures.filter((e) => !e.playerName).map((e) => e.playerId)
    const fallbackNames = missingNameIds.length
      ? await resolvePlayerNamesForSport(missingNameIds, INJURY_SPORT, "sleeper")
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
