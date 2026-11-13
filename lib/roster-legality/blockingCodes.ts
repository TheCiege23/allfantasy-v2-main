/**
 * Machine-readable roster / lineup blocking codes for notifications, UI, and analytics.
 * Align with product spec; extend as new rules are implemented.
 */
const ROSTER_LEGALITY_CODES = [
  'ROSTER_OVER_LIMIT',
  'SECTION_OVERFLOW',
  'IR_PLAYER_NO_LONGER_ELIGIBLE',
  'TAXI_PLAYER_TOO_EXPERIENCED',
  'TAXI_DEADLINE_PASSED',
  'DEVY_PLAYER_NO_LONGER_DEVY_ELIGIBLE',
  'INVALID_POSITION_ASSIGNMENT',
  'SLOT_LOCKED_BY_GAME_START',
  'LEAGUE_LINEUP_LOCK_ACTIVE',
  'BENCH_SPACE_REQUIRED',
  'STARTER_SLOT_EMPTY_WHEN_REQUIRED',
  'DUPLICATE_ASSIGNMENT',
  'TAXI_DISABLED_WITH_PLAYERS',
  'CONCEPT_LINEUP_FROZEN',
  'LEAGUE_LOCK_ALL',
  'LIFECYCLE_LOCKED',
  'UNKNOWN',
] as const

export type RosterLegalityBlockingCode = (typeof ROSTER_LEGALITY_CODES)[number]

export function mapIssueCodeToBlockingCode(code: string): RosterLegalityBlockingCode {
  const c = String(code || '').toLowerCase()
  switch (c) {
    case 'ir_ineligible_status':
      return 'IR_PLAYER_NO_LONGER_ELIGIBLE'
    case 'section_overflow':
    case 'roster_total_over_limit':
      return 'ROSTER_OVER_LIMIT'
    case 'starter_position_ineligible':
      return 'INVALID_POSITION_ASSIGNMENT'
    case 'duplicate_player':
      return 'DUPLICATE_ASSIGNMENT'
    case 'taxi_disabled':
      return 'TAXI_DISABLED_WITH_PLAYERS'
    case 'taxi_too_experienced':
      return 'TAXI_PLAYER_TOO_EXPERIENCED'
    case 'taxi_non_rookie_disallowed':
      return 'TAXI_PLAYER_TOO_EXPERIENCED'
    case 'devy_ineligible':
      return 'DEVY_PLAYER_NO_LONGER_DEVY_ELIGIBLE'
    case 'concept_lineup_frozen':
      return 'CONCEPT_LINEUP_FROZEN'
    case 'league_lock_all':
      return 'LEAGUE_LOCK_ALL'
    case 'lifecycle_locked':
      return 'LIFECYCLE_LOCKED'
    case 'slot_locked_by_game_start':
      return 'SLOT_LOCKED_BY_GAME_START'
    default:
      return 'UNKNOWN'
  }
}
