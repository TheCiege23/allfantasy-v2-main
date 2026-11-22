/**
 * One NFL player's fumble recoveries from a Rolling Insights season row (`regular_season` block),
 * read the one safe way (2026-11-20).
 *
 * The block can carry two fields for the same thing:
 *   - `fumbles_recoveries` — the documented PLAYER stat (ENDPOINTS.yaml live_player_stats);
 *   - `defense_fumble_recoveries` — documented as a TEAM stat (live_team.defense), yet present on
 *     player rows too.
 *
 * Measured on `player_season_stats` 2024–2026 (read-only):
 *   - when both are present they agree on the large majority of rows, so ADDING them double-counts
 *     every recovery — which is what IDP scoring did;
 *   - on 52 rows in 2024 and 61 in 2025 `defense_fumble_recoveries` is the player's GAMES PLAYED,
 *     always with zero defensive snaps and no `fumbles_recoveries` (one DE: 16 "recoveries" in a
 *     16-game season). Summed by team that made one defense look like it recovered 28 fumbles;
 *   - 2026 rows carry `defense_fumble_recoveries` only, so dropping it would lose every real value.
 *
 * So: prefer `fumbles_recoveries`; otherwise take `defense_fumble_recoveries` unless it is that
 * games-played echo; never add the two. With this rule every 2025 team totals 4–12 recoveries.
 * Recorded as `N-23` in contracts/rolling-insights/GAPS.md.
 */
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** True when `defense_fumble_recoveries` is the games-played echo rather than a real count. */
export function isGamesPlayedEcho(stats: Record<string, unknown>, gamesPlayed?: number | null): boolean {
  const value = finite(stats.defense_fumble_recoveries)
  const games = finite(gamesPlayed) ?? finite(stats.games_played)
  const defensiveSnaps = finite(stats.snap_count_defense) ?? 0
  return value != null && games != null && value === games && defensiveSnaps === 0
}

/** The player's fumble recoveries, or null when the row has no trustworthy value. */
export function playerFumbleRecoveries(stats: unknown, gamesPlayed?: number | null): number | null {
  if (!stats || typeof stats !== 'object') return null
  const s = stats as Record<string, unknown>
  const player = finite(s.fumbles_recoveries)
  if (player != null) return player
  const team = finite(s.defense_fumble_recoveries)
  if (team == null || isGamesPlayedEcho(s, gamesPlayed)) return null
  return team
}
