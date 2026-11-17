/**
 * worldCupMatchStatus.ts
 *
 * Pure helpers for displaying live World Cup match state.
 * No external dependencies — safe to import in server and client code.
 */
import type { WorldCupMatchView, WorldCupPickView } from "./types"

// ── Status display text ───────────────────────────────────────────────────────

/**
 * Returns a human-readable status label for display in cards and the ticker.
 *
 * Examples: "Scheduled", "Live", "1H 34′", "HT", "2H 67′", "ET", "PEN", "Final"
 */
export function formatWorldCupMatchStatus(match: WorldCupMatchView): string {
  const short = match.apiStatusShort?.toUpperCase()
  const status = match.status

  // Final states
  if (short === "FT" || short === "AET" || status === "final") return "Final"
  if (short === "PEN") return "Penalties"
  if (short === "FT_PEN") return "Final (Pens)"

  // Halftime
  if (short === "HT" || status === "halftime") return "HT"

  // Extra time
  if (short === "ET" || short === "E1" || short === "E2") {
    return match.elapsedMinute != null
      ? `ET ${match.elapsedMinute}${match.injuryTime ? `+${match.injuryTime}` : ""}′`
      : "ET"
  }

  // Second half
  if (short === "2H") {
    return match.elapsedMinute != null
      ? `2H ${match.elapsedMinute}${match.injuryTime ? `+${match.injuryTime}` : ""}′`
      : "2H"
  }

  // First half (live)
  if (short === "1H" || status === "live") {
    return match.elapsedMinute != null
      ? `${match.elapsedMinute}${match.injuryTime ? `+${match.injuryTime}` : ""}′`
      : "Live"
  }

  // Scheduled / upcoming
  if (status === "postponed") return "Postponed"
  if (status === "cancelled") return "Cancelled"

  if (match.startsAt) return "Scheduled"
  return "Time TBD"
}

// ── Boolean guards ────────────────────────────────────────────────────────────

/** True when the match is currently in progress (any live period). */
export function isWorldCupMatchLive(match: WorldCupMatchView): boolean {
  const short = match.apiStatusShort?.toUpperCase()
  if (match.status === "live" || match.status === "halftime") return true
  if (short && ["1H", "2H", "HT", "ET", "E1", "E2", "PEN"].includes(short)) return true
  return false
}

/** True when the match is completely finished. */
export function isWorldCupMatchFinal(match: WorldCupMatchView): boolean {
  const short = match.apiStatusShort?.toUpperCase()
  if (match.status === "final") return true
  if (short && ["FT", "AET", "FT_PEN"].includes(short)) return true
  return false
}

// ── Pick live state ───────────────────────────────────────────────────────────

type WorldCupPickLiveState =
  | "not_started"
  | "winning"
  | "drawing"
  | "losing"
  | "correct"
  | "incorrect"
  | "unknown"

/**
 * Returns the live/post-match state of a user's pick.
 *
 * - "correct" / "incorrect" when the match is final.
 * - "winning" / "losing" / "drawing" while live.
 * - "not_started" when the match hasn't begun.
 * - "unknown" when there's no pick.
 */
export function getWorldCupPickLiveState(
  match: WorldCupMatchView,
  pick: WorldCupPickView | null | undefined
): WorldCupPickLiveState {
  if (!pick) return "unknown"

  const isFinal = isWorldCupMatchFinal(match)
  const isLive = isWorldCupMatchLive(match)

  if (isFinal) {
    if (pick.isCorrect === true) return "correct"
    if (pick.isCorrect === false) return "incorrect"
    // isCorrect may not yet be scored — fall back to winnerTeamId check
    if (match.winnerTeamId && pick.selectedTeamId) {
      return match.winnerTeamId === pick.selectedTeamId ? "correct" : "incorrect"
    }
    return "unknown"
  }

  if (!isLive) return "not_started"

  // Determine which side the user picked
  const pickedHome =
    (pick.selectedTeamId && pick.selectedTeamId === match.homeTeamId) ||
    (pick.selectedSlotKey && pick.selectedSlotKey === match.homeSlotKey)

  const hs = match.homeScore ?? 0
  const as_ = match.awayScore ?? 0

  if (hs === as_) return "drawing"
  const pickedWinning = pickedHome ? hs > as_ : as_ > hs
  return pickedWinning ? "winning" : "losing"
}

// ── Score display ─────────────────────────────────────────────────────────────

/**
 * Returns a display string for the current or final score.
 *
 * Examples:
 *   "2 – 1"
 *   "1 – 1 (4–3 pens)"
 *   "—"
 */
export function getWorldCupMatchDisplayScore(match: WorldCupMatchView): string {
  const hs = match.homeScore
  const as_ = match.awayScore
  if (hs === null || as_ === null) return "—"

  let base = `${hs} – ${as_}`
  if (match.homePenaltyScore !== null && match.awayPenaltyScore !== null) {
    base += ` (${match.homePenaltyScore}–${match.awayPenaltyScore} pens)`
  }
  return base
}

// ── Kickoff format ────────────────────────────────────────────────────────────

/** Short kickoff — "Sat Jun 14, 9:00 AM" without timezone */
export function formatWorldCupKickoffShort(startsAt: string | null | undefined): string {
  if (!startsAt) return "TBD"
  try {
    return new Date(startsAt).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return "TBD"
  }
}
