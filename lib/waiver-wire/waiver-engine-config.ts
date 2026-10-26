/**
 * Normalized waiver engine rules from `LeagueWaiverSettings.waiverEngineConfig` JSON
 * plus column fallbacks. Keeps add/drop / FAAB / processing behavior settings-driven.
 */

export type WaiverEngineConfigJson = {
  waiver_type?: string
  waiver_days?: number[]
  waiver_process_time?: string
  custom_daily_waivers?: boolean
  after_game_waivers?: boolean
  lock_dropped_players_until?: string
  waivers_after_add_drop?: boolean
  same_day_add_drop_allowed?: boolean
  can_drop_bench_after_lock?: boolean
  can_drop_starters_after_game_start?: boolean
  minimum_waiver_time_hours?: number
  faab_min_bid?: number
  faab_tiebreaker?: string
  faab_reset_date?: string
  max_claims_per_period?: number
  max_adds_per_week?: number
  /** When set, limits drop actions per roster per UTC week (transactions + pending claims with a drop). */
  max_drops_per_week?: number
  commissioner_can_override?: boolean
  offseason_waiver_rules?: string
  playoff_waiver_rules?: string
  undroppable_player_ids?: string[]
  allow_zero_faab_bid?: boolean
  /** `standard` | `after_run` (Sleeper-style, lib/waiver-wire/after-run-free-agency.ts). */
  free_agency_mode?: string
  /** `reset` | `carry_over` at season rollover (lib/waiver-wire/faab-rollover.ts); unset = per-family default. */
  faab_rollover_rule?: string
}

export function parseWaiverEngineConfig(raw: unknown): WaiverEngineConfigJson {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as WaiverEngineConfigJson
}

/**
 * Map commissioner / import aliases to engine waiver types used by process-engine + UI.
 */
export function normalizeWaiverTypeForEngine(waiverType: string | null | undefined): string {
  const t = (waiverType ?? 'standard').trim().toLowerCase().replace(/-/g, '_')
  switch (t) {
    case 'rolling_priority':
    case 'rolling_waiver':
      return 'rolling'
    case 'reverse_order':
      return 'reverse_standings'
    case 'continual_waivers':
    case 'continual':
    case 'free_for_all':
      return 'fcfs'
    case 'free_agent_after_clear':
    case 'faa':
      return 'standard'
    case 'faab':
    case 'rolling':
    case 'reverse_standings':
    case 'fcfs':
    case 'standard':
      return t
    default:
      return t || 'standard'
  }
}

export function isFcfsStyleEngineType(waiverType: string | null | undefined): boolean {
  const n = normalizeWaiverTypeForEngine(waiverType)
  return n === 'fcfs'
}
