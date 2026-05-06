/**
 * NFL Sleeper ↔ Rolling Insights identity backlog (no runtime wiring here).
 *
 * - Prefer deterministic Sleeper `player_id` for fantasy UX; pair RI `providerPlayerId` via ingestion metadata.
 * - Rookie fallback stays Sleeper `years_exp` only when RI/imported rookie signals absent (`draftPlayerRookie`, `nflRookieSourcePolicy`).
 * - Next steps: stable crosswalk table or metadata twin-keys on `sports_players` cache rows; verify on ingest reconciliation jobs.
 */

export const SLEEPER_RI_NFL_CROSSWALK_BACKLOG = [
  'Populate dual IDs on enriched rows: sleeperPlayerId + rollingInsightsPlayerId.',
  'Add ingest reconciliation job to warn when RI roster churn diverges from Sleeper roster snapshots.',
  'Keep NFL field maps canonical in rollingInsightsNflFieldMap — avoid duplicating undocumented RI keys.',
] as const
