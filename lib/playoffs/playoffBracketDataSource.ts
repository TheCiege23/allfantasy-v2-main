/**
 * Playoff bracket data — official vs lab/template
 *
 * **Official/provider-backed bracket (planned):** Rows keyed by league + season/year and populated from a
 * sports integration that returns postseason *matchup structure* (team A vs B per series). AllFantasy must
 * never scrape publisher bracket HTML.
 *
 * **Template / lab bracket (current default):** `buildPlayoffTemplate()` emits deterministic tree shape and
 * illustrative team names. Pairings are **not** the official live NHL/NBA postseason field until a provider
 * sync merges real seeds into `PlayoffBracketSeries` for pools built from `buildPlayoffTemplate`.
 *
 * Today, `lib/sports-live-scores-service.ts` exposes **scoreboard-style** data (games/results), not an
 * ingestible postseason *bracket seeding* API for pool creation — so pool creation stays template-led
 * unless/until provider ingest ships and env flags flip (`NEXT_PUBLIC_PLAYOFF_NHL_OFFICIAL_SYNC`,
 * `NEXT_PUBLIC_PLAYOFF_NBA_OFFICIAL_SYNC`).
 */

export type OfficialNhlPlayoffUiPresentationMode = "lab_template" | "official_sync_live"

export function officialNhlPlayoffUiPresentation(): OfficialNhlPlayoffUiPresentationMode {
  try {
    return process.env.NEXT_PUBLIC_PLAYOFF_NHL_OFFICIAL_SYNC === "true" ? "official_sync_live" : "lab_template"
  } catch {
    return "lab_template"
  }
}

export type OfficialNbaPlayoffUiPresentationMode = "lab_template" | "official_sync_live"

export function officialNbaPlayoffUiPresentation(): OfficialNbaPlayoffUiPresentationMode {
  try {
    return process.env.NEXT_PUBLIC_PLAYOFF_NBA_OFFICIAL_SYNC === "true" ? "official_sync_live" : "lab_template"
  } catch {
    return "lab_template"
  }
}

/** Canonical anchor for dashboard leaderboard navigation (hash + element id). */
export const PLAYOFF_DASHBOARD_LEADERBOARD_DOM_ID = "playoff-dashboard-leaderboard"

export function playoffChallengeLeaderboardHref(challengeId: string): string {
  return `/brackets/leagues/${challengeId}?tab=leaderboard#${PLAYOFF_DASHBOARD_LEADERBOARD_DOM_ID}`
}
