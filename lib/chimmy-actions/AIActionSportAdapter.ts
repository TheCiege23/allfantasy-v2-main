/**
 * AI Action Sport Adapter
 * Resolves which AIActionTypes are valid for a given sport and league format.
 * Each sport has format-specific nuances (IR vs IL, categories vs H2H,
 * daily vs weekly, formation-aware, etc.) that gate certain actions.
 */

import type { AIActionType } from './AIActionModel'

// ─── Sport/Format Matrix ────────────────────────────────────────────────────────

type Sport =
  | 'NFL'
  | 'NCAAF'
  | 'NBA'
  | 'NCAAB'
  | 'MLB'
  | 'NHL'
  | 'Soccer'
  | string

type LeagueFormat =
  | 'redraft'
  | 'keeper'
  | 'dynasty'
  | 'best-ball'
  | 'tournament'
  | 'seasonal'
  | 'devy'
  | string

/**
 * Actions that are universally available across all sports and formats
 * (unless league state blocks them).
 */
const UNIVERSAL_ACTIONS: AIActionType[] = [
  'open_deep_dive',
  'save_recommendation',
  'schedule_reminder',
  'compare_alternatives',
  'post_to_league_chat',
  'start_simulation',
  'bookmark_player',
  'compare_draft_options',
  'add_to_watchlist',
  'compare_claims',
  'analyze_trade',
  'compare_replacement',
  'flag_trade_block',
  'save_future_move',
  'simulate_matchup',
  'try_alternate_starter',
  'save_matchup_strategy',
  'save_waiver_plan',
  'save_counter_draft',
  'ai_trade_review',
]

// ─── Sport-Specific Inclusions ──────────────────────────────────────────────────

/**
 * Actions that are valid for NFL / NCAAF
 */
const NFL_ACTIONS: AIActionType[] = [
  ...UNIVERSAL_ACTIONS,
  // Draft
  'queue_player', 'auto_queue_best_3', 'draft_player', 'set_auction_bid',
  // Waiver
  'claim_player', 'set_faab_bid', 'drop_player_for_claim',
  // Lineup (weekly lock, weather swap relevant)
  'start_player', 'bench_player', 'optimize_lineup', 'optimize_bench', 'swap_players', 'save_lineup',
  // Trade
  'propose_trade', 'generate_counter', 'share_trade_summary',
  // Roster — IR standard in NFL
  'drop_player', 'move_to_bench', 'move_to_ir',
  // Matchup
  'optimize_ceiling', 'optimize_floor',
]

/**
 * Actions that are valid for NBA / NCAAB
 * Key differences: IL instead of IR, categories mode, daily lineup changes
 */
const NBA_ACTIONS: AIActionType[] = [
  ...UNIVERSAL_ACTIONS,
  // Draft
  'queue_player', 'auto_queue_best_3', 'draft_player', 'set_auction_bid',
  // Waiver
  'claim_player', 'set_faab_bid', 'drop_player_for_claim',
  // Lineup — daily format, no lineup lock outside game window
  'start_player', 'bench_player', 'optimize_lineup', 'optimize_bench', 'swap_players', 'save_lineup',
  // Trade
  'propose_trade', 'generate_counter', 'share_trade_summary',
  // Roster — IL for NBA
  'drop_player', 'move_to_bench', 'move_to_il',
  // Matchup — categories optimization core feature for NBA
  'optimize_categories', 'optimize_ceiling', 'optimize_floor',
]

/**
 * Actions that are valid for MLB
 * Key differences: daily/weekly lineup, DL (use IL slot), streaming pitchers
 */
const MLB_ACTIONS: AIActionType[] = [
  ...UNIVERSAL_ACTIONS,
  // Draft
  'queue_player', 'auto_queue_best_3', 'draft_player', 'set_auction_bid',
  // Waiver
  'claim_player', 'set_faab_bid', 'drop_player_for_claim',
  // Lineup — both daily and weekly modes
  'start_player', 'bench_player', 'optimize_lineup', 'optimize_bench', 'swap_players', 'save_lineup',
  // Trade
  'propose_trade', 'generate_counter', 'share_trade_summary',
  // Roster — 10-day/60-day IL
  'drop_player', 'move_to_bench', 'move_to_il',
  // Matchup
  'optimize_categories', 'optimize_ceiling', 'optimize_floor',
]

/**
 * Actions that are valid for NHL
 * Key differences: IL for LTIR, goalie protection via bench/swap
 */
const NHL_ACTIONS: AIActionType[] = [
  ...UNIVERSAL_ACTIONS,
  // Draft
  'queue_player', 'auto_queue_best_3', 'draft_player', 'set_auction_bid',
  // Waiver
  'claim_player', 'set_faab_bid', 'drop_player_for_claim',
  // Lineup
  'start_player', 'bench_player', 'optimize_lineup', 'optimize_bench', 'swap_players', 'save_lineup',
  // Trade
  'propose_trade', 'generate_counter', 'share_trade_summary',
  // Roster — LTIR
  'drop_player', 'move_to_bench', 'move_to_il',
  // Matchup
  'optimize_categories', 'optimize_ceiling', 'optimize_floor',
]

/**
 * Actions that are valid for Soccer
 * Key differences: formation-aware, fixture congestion, goalkeeper swap
 */
const SOCCER_ACTIONS: AIActionType[] = [
  ...UNIVERSAL_ACTIONS,
  // Draft
  'queue_player', 'auto_queue_best_3', 'draft_player', 'set_auction_bid',
  // Waiver
  'claim_player', 'set_faab_bid', 'drop_player_for_claim',
  // Lineup — formation slot awareness
  'start_player', 'bench_player', 'optimize_lineup', 'optimize_bench', 'swap_players', 'save_lineup',
  // Trade
  'propose_trade', 'generate_counter', 'share_trade_summary',
  // Roster — no IR in most soccer formats
  'drop_player', 'move_to_bench',
  // Matchup
  'optimize_ceiling', 'optimize_floor',
]

// ─── Format-Specific Additions ──────────────────────────────────────────────────

/**
 * Actions only available in dynasty or keeper formats
 */
const DYNASTY_KEEPER_ADDITIONS: AIActionType[] = [
  'move_to_taxi',
  'move_to_devy',
]

/**
 * Best-ball has no waiver wire or lineup decisions — strip those actions
 */
const BEST_BALL_EXCLUDED: AIActionType[] = [
  'claim_player', 'add_to_watchlist', 'set_faab_bid', 'drop_player_for_claim',
  'compare_claims', 'save_waiver_plan',
  'start_player', 'bench_player', 'optimize_lineup', 'optimize_bench', 'swap_players', 'save_lineup',
  'move_to_bench', 'drop_player', 'move_to_ir', 'move_to_il',
]

// ─── Lookup Map ────────────────────────────────────────────────────────────────

const SPORT_ACTION_MAP: Record<string, AIActionType[]> = {
  NFL: NFL_ACTIONS,
  NCAAF: NFL_ACTIONS,
  NBA: NBA_ACTIONS,
  NCAAB: NBA_ACTIONS,
  MLB: MLB_ACTIONS,
  NHL: NHL_ACTIONS,
  Soccer: SOCCER_ACTIONS,
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns the set of valid AIActionTypes for the given sport and league format.
 */
function getActionsForSport(
  sport: Sport,
  leagueType: LeagueFormat,
): AIActionType[] {
  const base: AIActionType[] = SPORT_ACTION_MAP[sport] ?? [...UNIVERSAL_ACTIONS]

  let result = [...base]

  // Add dynasty/keeper-only actions
  if (leagueType === 'dynasty' || leagueType === 'keeper' || leagueType === 'devy') {
    result = [...new Set([...result, ...DYNASTY_KEEPER_ADDITIONS])]
  }

  // Strip best-ball-incompatible actions
  if (leagueType === 'best-ball') {
    const excluded = new Set<string>(BEST_BALL_EXCLUDED)
    result = result.filter((a) => !excluded.has(a))
  }

  return result
}

/**
 * True if the given action type is valid for the sport + league format combination.
 */
export function isActionValidForSport(
  type: AIActionType,
  sport: Sport,
  leagueType: LeagueFormat,
): boolean {
  return getActionsForSport(sport, leagueType).includes(type)
}

/**
 * Returns additional sport-specific payload fields to merge into the action payload.
 * E.g., `{ mode: 'daily' }` for MLB, `{ formationAware: true }` for Soccer.
 */
export function getSportSpecificPayload(
  type: AIActionType,
  sport: Sport,
  leagueType: LeagueFormat,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {}

  switch (sport) {
    case 'NFL':
    case 'NCAAF':
      if (['optimize_lineup', 'swap_players'].includes(type)) {
        extra.weatherAware = true
      }
      if (['optimize_ceiling', 'optimize_floor'].includes(type)) {
        extra.stackingEnabled = true
      }
      break

    case 'NBA':
    case 'NCAAB':
      if (['optimize_lineup', 'optimize_categories'].includes(type)) {
        extra.scheduleDensityAware = true
      }
      if (['start_player', 'bench_player'].includes(type)) {
        extra.gamesPlayedMode = true
      }
      break

    case 'MLB':
      if (['start_player', 'bench_player', 'optimize_lineup'].includes(type)) {
        extra.lineupMode = leagueType === 'seasonal' ? 'weekly' : 'daily'
        extra.streamingEnabled = true
      }
      break

    case 'NHL':
      if (['start_player', 'bench_player', 'optimize_lineup'].includes(type)) {
        extra.goalieProtection = true
        extra.gamesPlayedMode = true
      }
      break

    case 'Soccer':
      if (['optimize_lineup', 'swap_players'].includes(type)) {
        extra.formationAware = true
        extra.fixtureCongest = true
      }
      break
  }

  // Devy/C2C — stash + promote actions
  if (
    (leagueType === 'dynasty' || leagueType === 'devy') &&
    ['move_to_taxi', 'move_to_devy', 'save_future_move'].includes(type)
  ) {
    extra.devyMode = true
    extra.stashEligible = true
  }

  return extra
}
