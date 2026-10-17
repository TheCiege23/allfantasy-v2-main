import "server-only"

import { prisma } from "@/lib/prisma"
import { computeUserPlayerExposure } from "@/lib/shared-services/game-day/UserPlayerExposureService"
import { resolveCurrentInjuryDesignations } from "@/lib/injuries/currentInjuryDesignations"
import { indexBySleeperId, sleeperIdWhere } from "@/lib/player-identity/externalIdNamespace"
import { resolvePlayerNamesForSport } from "@/lib/roster/resolvePlayerNames"
import type { ActivityFeedItem, ActivitySourceContext } from "@/lib/activity/types"
import type { UserPlayerExposure } from "@/lib/shared-services/game-day/types"
import { loadEspnToSleeperMap } from "@/lib/core-app/rosterIdSpace"

/**
 * The id-space that joins cleanly here is Sleeper/NFL: `computeUserPlayerExposure` returns raw
 * roster player ids — narrowed to NFL Sleeper ids by `sleeperNflExposures` below — and the player's
 * name, team and position are read from his `SportsPlayer` row BY SLEEPER ID.
 *
 * 🛑 THE DESIGNATION COMES FROM THE INJURY FEED, BY VERIFIED NAME — NEVER FROM `SportsPlayer.status`
 * (2026-10-11). This read `resolveInjuryContext`, i.e. `SportsPlayer.status`, which on Sleeper's row is
 * Sleeper's ROSTER status ("Active", "Injured Reserve"), not `injury_status` — so an Out, Doubtful or
 * Questionable starter read "Active" and the feed never announced him. And `SportsInjury.playerId` is
 * each provider's own id, so no roster id is ever joined onto it (Sleeper 8394 is Percy Butler; Rolling
 * Insights 8394 is Rome Odunze). See `lib/injuries/currentInjuryDesignations.ts`.
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
    case "suspension":
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


type SleeperIdentity = { name: string | null; team: string | null; position: string | null; rosterStatus: string | null }

/** Name, team, position and roster status for NFL Sleeper ids — Sleeper's own row preferred. */
async function loadSleeperIdentity(ids: string[]): Promise<Map<string, SleeperIdentity>> {
  const rows = await prisma.sportsPlayer.findMany({
    where: sleeperIdWhere(ids, INJURY_SPORT),
    orderBy: { fetchedAt: "desc" },
    select: { sleeperId: true, source: true, name: true, team: true, position: true, status: true },
  })
  const out = new Map<string, SleeperIdentity>()
  for (const [sleeperId, r] of indexBySleeperId(rows)) {
    out.set(sleeperId, {
      name: r.name ?? null,
      team: r.team ?? null,
      position: r.position ?? null,
      // Only Sleeper's own row holds a roster status; another provider's `status` is its own vocabulary.
      rosterStatus: r.source === "sleeper" ? r.status ?? null : null,
    })
  }
  return out
}

/**
 * Source 3 — injuries hitting the viewer's rosters (the emotional hook). Reads the players the
 * viewer actually rosters across every league (one indexed `roster` query), resolves each one's
 * CURRENT designation from the injury feed (live rows, newest claim, namesakes refused, stale
 * game-day words suppressed — no live provider hit), and emits an `injury` item ONLY for a player
 * the viewer truly owns who carries one ("CMC (RB) → Questionable — on 2 of your rosters").
 * Returns [] (never throws); nothing is fabricated.
 */
export async function collectRosterInjuryActivity(ctx: ActivitySourceContext): Promise<ActivityFeedItem[]> {
  try {
    const { exposures: allExposures } = await computeUserPlayerExposure({ userId: ctx.userId })
    const exposures = await sleeperNflExposures(allExposures)
    if (exposures.length === 0) return []

    const playerIds = exposures.map((e) => e.playerId).filter(Boolean)
    if (playerIds.length === 0) return []

    const identity = await loadSleeperIdentity(playerIds)

    // Fill in any names neither the exposure nor the row could, so we never show a raw player id.
    const missingNameIds = exposures.filter((e) => !e.playerName && !identity.get(e.playerId)?.name).map((e) => e.playerId)
    const fallbackNames = missingNameIds.length
      ? await resolvePlayerNamesForSport(missingNameIds, INJURY_SPORT, "sleeper")
      : new Map<string, string>()
    const nameOf = (e: UserPlayerExposure) =>
      e.playerName ?? identity.get(e.playerId)?.name ?? fallbackNames.get(e.playerId) ?? null

    const designations = await resolveCurrentInjuryDesignations({
      sport: INJURY_SPORT,
      players: exposures.map((e) => {
        const row = identity.get(e.playerId)
        return {
          key: e.playerId,
          name: nameOf(e),
          team: row?.team ?? null,
          position: e.position ?? row?.position ?? null,
          rosterStatus: row?.rosterStatus ?? null,
        }
      }),
    })

    const items: ActivityFeedItem[] = []
    for (const exp of exposures) {
      const current = designations.get(exp.playerId)
      if (!current) continue
      // "Probable" says he is expected to play — not a roster-affecting status.
      if (/\bprobable\b/i.test(current.status)) continue

      const name = nameOf(exp)
      if (!name) continue // no honest name → omit rather than surface a raw id

      const statusLabel = formatInjuryStatus(current.status)
      const rostersLabel = exp.leagueCount === 1 ? "1 of your rosters" : `${exp.leagueCount} of your rosters`
      const posLabel = exp.position ? ` (${exp.position})` : ""
      // When the provider REPORTED it, so a change re-sorts/re-animates — not when we last re-pulled it.
      const learnedAt = current.fact?.reportedAt ?? null

      items.push({
        // Include the status so a status change produces a new id (slides in as fresh).
        id: `injury:${exp.playerId}:${String(current.status).toLowerCase()}`,
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
