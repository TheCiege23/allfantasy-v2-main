/**
 * Survivor league constants and defaults (PROMPT 346).
 * Sport-aware defaults for merge week etc. align with PROMPT 344.
 */

import type { LeagueSport } from '@prisma/client'

export const SURVIVOR_VARIANT = 'survivor'

/** Default first-entry intro — asset in `/public/survivor/` (filename is URL-encoded for spaces). */
export const SURVIVOR_LEAGUE_INTRO_VIDEO = `/survivor/${encodeURIComponent('Survivor League Intro.mp4')}`

/** Default merge week by sport (pre-merge ends; merge starts). */
export const DEFAULT_MERGE_WEEK_BY_SPORT: Partial<Record<LeagueSport, number>> = {
  NFL: 10,
  NBA: 14,
  MLB: 16,
  NHL: 18,
  NCAAF: 8,
  NCAAB: 12,
  SOCCER: 12,
}

export const DEFAULT_TRIBE_COUNT = 4
export const DEFAULT_TRIBE_SIZE = 4
export const MIN_TRIBES = 2
export const MAX_TRIBES = 8
export const MIN_TRIBE_SIZE = 2
export const MAX_TRIBE_SIZE = 6

export const DEFAULT_IDOL_COUNT = 2
export const DEFAULT_EXILE_RETURN_TOKENS = 4
export const DEFAULT_IDOL_EXPIRY_PLAYERS_REMAINING = 5

/**
 * Key position per sport for Exile Island team draft.
 * Claiming this position reserves exclusive team rights; teammates are claimed individually.
 */
export const EXILE_KEY_POSITION_BY_SPORT: Record<string, string> = {
  NFL: 'QB',
  MLB: 'SP',
  NHL: 'G',
  NBA: 'PG',
  NCAAF: 'QB',
  NCAAB: 'C',
  SOCCER: 'GK',
}

/**
 * Mini-game frequency by sport week structure.
 * Daily sports get more mini-games per scoring period.
 */
export const MINIGAMES_PER_WEEK_BY_SPORT: Record<string, number> = {
  NFL: 1,      // 1 game per team per week
  NBA: 3,      // Multiple games, 3 mini-games Mon/Wed/Fri
  MLB: 3,      // Daily games, 3 mini-games
  NHL: 2,      // Most nights, 2 mini-games
  NCAAF: 1,    // Weekend games
  NCAAB: 2,    // Daily during season
  SOCCER: 1,   // Weekend matches
}

/**
 * Idol distribution: 30-35% of league gets idols. Each idol is unique.
 * Idols are attached to PLAYERS (not managers). If a player is traded or
 * picked up off waivers, the idol transfers to the new manager.
 */
export const IDOL_DISTRIBUTION_PERCENT = 0.32 // ~32% of league

/** Idol power types that can be in the pool (configurable). */
export const IDOL_POWER_TYPES = [
  // Immunity — cancel votes
  'protect_self',             // No votes against you count
  'protect_self_plus_one',    // Protect self + one ally

  // Vote control
  'extra_vote',               // Cast one extra vote
  'double_vote',              // Your vote counts as two
  'vote_nullifier',           // Cancel one player's vote
  'vote_steal',               // Steal another player's vote

  // Player/roster movement
  'steal_one_player',         // Steal 1 player from any team
  'steal_three_players',      // Steal 3 same-position players from any team
  'swap_starter',             // Swap your bench with rival's starter

  // Score modification
  'score_boost_10',           // +10 pts this week
  'score_boost_20',           // +20 pts this week
  'rival_penalty_10',         // -10 pts to a rival

  // Waiver/FAAB
  'waiver_priority_override', // Jump to #1 waiver
  'faab_bonus',               // Bonus FAAB budget

  // Tribe powers
  'tribe_immunity_modifier',  // Your tribe wins immunity
  'secret_tribe_power',       // Secret tribe power
  'force_tribe_shuffle',      // Force tribe swap

  // Information
  'idol_sniffer',             // Reveal if target has idol
  'reveal_tribe_powers',      // Reveal all idols in a tribe

  // Endgame (excluded from default pool)
  'jury_influence',
  'finale_advantage',
] as const

/** Default idol power pool (all except jury/finale). Each idol assigned is unique — no duplicates. */
export const DEFAULT_IDOL_POWER_POOL = IDOL_POWER_TYPES.filter(
  (p) => p !== 'jury_influence' && p !== 'finale_advantage'
)

/** Human-readable idol power descriptions for @Chimmy DMs and league chat. */
export const IDOL_POWER_DESCRIPTIONS: Record<string, string> = {
  protect_self: 'Play before votes are counted — all votes against you are cancelled.',
  protect_self_plus_one: 'Protect yourself AND one ally from all votes this tribal.',
  extra_vote: 'Cast one extra vote at elimination council.',
  double_vote: 'Your vote counts as two votes.',
  vote_nullifier: "Cancel one other player's vote — it won't be counted.",
  vote_steal: "Steal another player's vote. They lose theirs, you cast it.",
  steal_one_player: "Steal 1 player from any team's roster.",
  steal_three_players: 'Steal 3 same-position players from any team.',
  swap_starter: "Swap one of your bench players with a rival's starter.",
  score_boost_10: '+10 fantasy points applied to your score this week.',
  score_boost_20: '+20 fantasy points applied to your score this week.',
  rival_penalty_10: "-10 points applied to a rival's score this week.",
  waiver_priority_override: 'Jump to #1 waiver priority this week.',
  faab_bonus: 'Receive a bonus FAAB budget increase.',
  tribe_immunity_modifier: 'Your tribe automatically wins immunity this week.',
  secret_tribe_power: 'A secret power is awarded to your tribe — only you know.',
  force_tribe_shuffle: 'Force a tribe swap/shuffle this week.',
  idol_sniffer: 'Reveal whether a specific player holds any idol.',
  reveal_tribe_powers: 'Reveal all idols held by members of one tribe.',
  jury_influence: 'Your closing speech gets a bonus prompt with the jury.',
  finale_advantage: 'Advantage in the final elimination council.',
}

/** League chat source for tribe-scoped messages (filter by membership). */
export function tribeChatSource(tribeId: string): string {
  return `tribe_${tribeId}`
}

/** Parse tribe id from chat source. */
export function parseTribeIdFromSource(source: string | null): string | null {
  if (!source || !source.startsWith('tribe_')) return null
  return source.slice(6) || null
}

/**
 * Key-position map used to pick the "anchor" player for exile team drafts.
 * Claiming the anchor position reserves that player's real-world team.
 */
export const KEY_POSITION_BY_SPORT: Record<string, { code: string; label: string }> = {
  NFL: { code: 'QB', label: 'Quarterback' },
  MLB: { code: 'SP', label: 'Starting Pitcher' },
  NHL: { code: 'G', label: 'Goaltender' },
  NBA: { code: 'PG', label: 'Point Guard' },
  NCAAF: { code: 'QB', label: 'Quarterback' },
  NCAAB: { code: 'C', label: 'Center' },
  SOCCER: { code: 'GK', label: 'Goalkeeper' },
}

/** Per-sport mini-game cadence (games per week + tribal-council day). */
export const SURVIVOR_MINI_GAME_CADENCE: Record<string, { perWeek: number; tribalDay: string }> = {
  NFL: { perWeek: 1, tribalDay: 'tuesday' },
  NBA: { perWeek: 3, tribalDay: 'monday' },
  MLB: { perWeek: 3, tribalDay: 'monday' },
  NHL: { perWeek: 2, tribalDay: 'monday' },
  NCAAF: { perWeek: 1, tribalDay: 'sunday' },
  NCAAB: { perWeek: 2, tribalDay: 'monday' },
  SOCCER: { perWeek: 1, tribalDay: 'monday' },
}

export function keyPositionForSport(sport?: string | null) {
  if (!sport) return KEY_POSITION_BY_SPORT.NFL
  return KEY_POSITION_BY_SPORT[sport.toUpperCase()] ?? KEY_POSITION_BY_SPORT.NFL
}
