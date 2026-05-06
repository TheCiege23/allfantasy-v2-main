/**
 * Backlog: deeper Rolling Insights payload verification for non-football sports.
 * Compare live samples against `ROLLING_INSIGHTS_FIELD_MAPS` before extending maps.
 * (Euro/soccer parity intentionally excluded from this backlog export.)
 */

export const RI_PAYLOAD_VERIFICATION_NBA = [
  'Confirm live box keys mirror uploads: points, assists, total_rebounds, three_points_made, minutes.',
  'Verify schedule rows expose game_ID / team IDs consistent with `NBA_SCHEDULE` map.',
] as const

export const RI_PAYLOAD_VERIFICATION_MLB = [
  'Confirm batting vs pitching shells (live_batting / live_pitching) match documented POS/POS_category.',
  'Validate pitcher/hitter schedule augmentations (away_pitcher.player_id) if feeds differ by venue.',
] as const

export const RI_PAYLOAD_VERIFICATION_NHL = [
  'Confirm skater vs goalie shells — shots_on_goal, saves, goals_allowed alignment.',
  'Cross-check schedule parity with NFL-shaped schedule map where RI reuses fields.',
] as const

export const RI_PAYLOAD_VERIFICATION_NCAABB = [
  'When RI exposes `class` on player-info, mirror NCAAFB college-class ingestion — maps live in `collegeClass.ts`.',
  'Bracket schedule extras (region/seed) — validate optional keys still present on tournament payloads.',
] as const
