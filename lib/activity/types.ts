// Shared shape for the League Buzz activity feed (`/api/shared/activity`).
//
// This was formerly `lib/activity/placeholder.ts` — a misleading name left over from when the
// feed shipped fabricated sample data. That generator is long gone; the feed is a real,
// multi-source aggregator (Sleeper transactions + native AF league DB events + injuries on the
// viewer's rosters). The honest rule holds: every item traces to a real source, and sources with
// no real feed are omitted — never synthesized.

export type ActivityFeedItemType =
  | "trade"
  | "waiver"
  | "lineup"
  | "message"
  | "announcement"
  | "injury"
  | "standings"

/** Which real source produced an item (provenance — never a fabricated value). */
export type ActivityFeedItemSource = "sleeper" | "native" | "injury"

export type ActivityFeedItem = {
  id: string
  type: ActivityFeedItemType
  userId: string
  userName: string
  avatarUrl?: string | null
  description: string
  timestamp: string
  leagueId: string | null
  leagueName: string | null
  /** Deep link to the underlying event (the trade in that league, the player, the announcement). */
  href?: string | null
  /** Provenance of the item — for ordering/debugging; each value maps to a real source. */
  source?: ActivityFeedItemSource
  /**
   * A trade's grade (2026-09-27), from `lib/activity/tradeGrades.ts`. Absent: not graded (a non-trade
   * item, or a trade past the per-request bound). `graded: false` carries the reason instead.
   */
  tradeGrade?: ActivityTradeGrade | null
}

/**
 * THE grade for a feed trade, one letter per team. `basis` says which grade it is: `today` is the
 * one grade on this league's values now (Sleeper trades); `at-proposal` is the letter frozen into a
 * native trade's receipt when it was offered.
 */
export type ActivityTradeGrade =
  | { graded: true; basis: 'today' | 'at-proposal'; sides: Array<{ name: string; letter: 'A' | 'B' | 'C' | 'D' | 'F' }> }
  | { graded: false; reason: string }

/** Minimal league shape the activity sources need — a slice of the dashboard league list. */
export type ActivityLeagueEntry = {
  id?: string
  name?: string
  platform?: string
  platformLeagueId?: string | null
  season?: number | string | null
  status?: string | null
  sport?: string | null
}

/** Shared context handed to every activity source so leagues are resolved once per request. */
export type ActivitySourceContext = {
  userId: string
  leagues: ActivityLeagueEntry[]
  leagueIdFilter?: string
  limit: number
}
