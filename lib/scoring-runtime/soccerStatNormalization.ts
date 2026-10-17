/**
 * One Rolling Insights soccer box line -> the engine's SOCCER category keys (lib/sportConfig/configs/soccer.ts).
 *
 * The scheduled multi-sport ingest (`rollingInsightsGameLogs.ts`) writes one `player_game_stats` row per
 * player per game with `normalizedStatMap = { group, position, stats: { <vendor field>: number }, … }`.
 * `group` is `fielders` or `goalkeepers`; `position` is `Defender` / `Midfielder` / `Forward` /
 * `Goalkeeper`. The contract has no soccer field list (`GAPS.md` G-04), so the fields below were read off
 * the stored rows instead — measured on production 2026-09-28, all 4,159 rows (EPL, La Liga and Serie A,
 * 2026-08-25 to 2026-09-20):
 *
 *   every row     goals assists yellow_cards red_cards minutes_played shots_attempted shots_on_goal
 *                 fouls_committed fouls_drawn free_kicks_won penalties_scored penalty_attempts player_id
 *   defenders+GK  clean_sheets
 *   goalkeepers   saves goals_conceded penalties_faced penalties_saved
 *
 * 🛑 A CLEAN SHEET NEEDS 60 MINUTES. The vendor sets `clean_sheets: 1` for 86 of 333 defender lines on
 * which the player played under an hour — a 90th-minute substitute. Every mainstream fantasy game (FPL
 * first) awards a clean sheet only at 60+ minutes, and so does this: the flag AND the minutes. No
 * goalkeeper line was affected (0 of 63).
 *
 * 🛑 THERE IS NO OWN-GOAL FIELD. Goalkeepers conceded 400 against 385 scored in the same games, so own
 * goals happen and are counted against the keeper — but no line says whose. `own_goal` is never emitted;
 * inventing it from the gap would charge a random defender.
 *
 * Derived per game: a missed penalty (`penalty_attempts - penalties_scored`; 28 taken, 20 scored), and an
 * appearance (any minutes). A penalty goal is already a goal, so `penalties_scored` is not scored again.
 *
 * Every other numeric field is listed as non-scoring or reported as unmapped, so a vendor rename shows up
 * as a warning instead of a quiet week of zeros.
 */
import type { NormalizedGameStats } from './dailySportStatNormalization'

/** Minutes a player must play for his clean sheet to count. */
export const SOCCER_CLEAN_SHEET_MIN_MINUTES = 60

const DIRECT: Readonly<Record<string, string>> = {
  goals: 'goals',
  assists: 'assists',
  yellow_cards: 'yellow_card',
  red_cards: 'red_card',
  shots_on_goal: 'shots_on_target',
  shots_attempted: 'shots',
  minutes_played: 'minutes_played',
  fouls_committed: 'fouls_committed',
  fouls_drawn: 'fouls_drawn',
}

/** Only a goalkeeper's line may score these. */
const GOALKEEPER_ONLY: Readonly<Record<string, string>> = {
  saves: 'saves',
  penalties_saved: 'pen_save',
  goals_conceded: 'gk_goals_against',
}

/** Read to derive something, or deliberately unscored. */
const CONSUMED_OR_NON_SCORING = new Set([
  'clean_sheets',
  'penalties_scored',
  'penalty_attempts',
  'penalties_faced',
  'free_kicks_won',
  'player_id',
])

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

export function normalizeSoccerGameStats(raw: unknown): NormalizedGameStats {
  const record = isRecord(raw) ? raw : {}
  const group = typeof record.group === 'string' ? record.group : null
  const source = isRecord(record.stats) ? record.stats : null
  if (!source || (group !== 'fielders' && group !== 'goalkeepers')) {
    // A line whose group we cannot tell must not be guessed: a keeper's clean sheet is not a defender's.
    return { stats: {}, unmappedKeys: group ? [`group:${group}`] : source ? ['group:(missing)'] : [] }
  }
  const isKeeper = group === 'goalkeepers'
  const position = typeof record.position === 'string' ? record.position.trim().toLowerCase() : ''
  const isDefender = !isKeeper && (position === 'defender' || position === 'def' || position === 'd')

  const stats: Record<string, number> = {}
  const unmappedKeys: string[] = []
  for (const [field, value] of Object.entries(source)) {
    const n = asNumber(value)
    if (n === undefined) continue
    const direct = DIRECT[field]
    if (direct) {
      stats[direct] = n
      continue
    }
    const keeperKey = GOALKEEPER_ONLY[field]
    if (keeperKey) {
      if (isKeeper) stats[keeperKey] = n
      else if (n !== 0) unmappedKeys.push(`${group}.${field}`)
      continue
    }
    if (!CONSUMED_OR_NON_SCORING.has(field)) unmappedKeys.push(`${group}.${field}`)
  }

  const minutes = asNumber(source.minutes_played) ?? 0
  stats.appearance = minutes > 0 ? 1 : 0

  const attempts = asNumber(source.penalty_attempts)
  if (attempts !== undefined) stats.pen_miss = Math.max(0, attempts - (asNumber(source.penalties_scored) ?? 0))

  const cleanSheet = (asNumber(source.clean_sheets) ?? 0) >= 1 && minutes >= SOCCER_CLEAN_SHEET_MIN_MINUTES ? 1 : 0
  if (isKeeper) stats.clean_sheet_gk = cleanSheet
  else if (isDefender) stats.clean_sheet_def = cleanSheet

  return { stats, unmappedKeys }
}
