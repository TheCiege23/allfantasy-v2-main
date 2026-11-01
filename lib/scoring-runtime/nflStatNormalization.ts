import { NFL_EXTRA_PLAYER_STAT_KEYS, NFL_EXTRA_TEAM_STAT_SOURCES } from './nflExtraStatKeys'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function firstNumber(source: JsonRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const n = asNumber(source[key])
    if (n !== undefined) return n
  }
  return undefined
}

function sumNumbers(source: JsonRecord, keys: string[]): number | undefined {
  let total = 0
  let found = false
  for (const key of keys) {
    const n = asNumber(source[key])
    if (n !== undefined) {
      total += n
      found = true
    }
  }
  return found ? total : undefined
}

function setIfNumber(out: Record<string, number>, key: string, value: number | undefined) {
  if (value !== undefined) out[key] = value
}

export function normalizeNflWeeklyStats(raw: unknown): Record<string, number> {
  const source = isRecord(raw) && isRecord(raw.stats) ? raw.stats : raw
  if (!isRecord(source)) return {}

  const out: Record<string, number> = {}

  setIfNumber(out, 'pass_yds', firstNumber(source, ['pass_yds', 'pass_yd', 'passing_yards', 'passingYards']))
  setIfNumber(out, 'pass_td', firstNumber(source, ['pass_td', 'passing_td', 'passing_touchdowns', 'passingTouchdowns']))
  setIfNumber(out, 'pass_int', firstNumber(source, ['pass_int', 'passing_int', 'interception_thrown', 'interceptions']))
  setIfNumber(out, 'rush_yds', firstNumber(source, ['rush_yds', 'rush_yd', 'rushing_yards', 'rushingYards']))
  setIfNumber(out, 'rush_td', firstNumber(source, ['rush_td', 'rushing_td', 'rushing_touchdowns', 'rushingTouchdowns']))
  setIfNumber(out, 'rec', firstNumber(source, ['rec', 'receptions', 'receiving_receptions']))
  setIfNumber(out, 'rec_yds', firstNumber(source, ['rec_yds', 'rec_yd', 'receiving_yards', 'receivingYards']))
  setIfNumber(out, 'rec_td', firstNumber(source, ['rec_td', 'receiving_td', 'receiving_touchdowns', 'receivingTouchdowns']))
  setIfNumber(out, 'two_pt', sumNumbers(source, ['two_pt', 'pass_2pt', 'rush_2pt', 'rec_2pt']))
  setIfNumber(out, 'fum_lost', firstNumber(source, ['fum_lost', 'fumbles_lost', 'fumble_lost']))
  setIfNumber(out, 'fumble_td', firstNumber(source, ['fumble_td', 'fum_rec_td']))
  setIfNumber(out, 'fg_0_39', sumNumbers(source, ['fg_0_39', 'fgm_0_19', 'fgm_20_29', 'fgm_30_39']))
  setIfNumber(out, 'fg_40_49', firstNumber(source, ['fg_40_49', 'fgm_40_49']))
  setIfNumber(out, 'fg_50_plus', firstNumber(source, ['fg_50_plus', 'fgm_50p', 'fgm_50_plus']))
  setIfNumber(out, 'fg_miss', firstNumber(source, ['fg_miss', 'fgmiss', 'fg_missed']))
  setIfNumber(out, 'xp_made', firstNumber(source, ['xp_made', 'xpm', 'pat_made']))
  setIfNumber(out, 'idp_solo', firstNumber(source, ['idp_solo', 'idp_tkl_solo', 'tackle_solo', 'solo_tkl']))
  setIfNumber(out, 'idp_assist', firstNumber(source, ['idp_assist', 'idp_tkl_ast', 'tackle_ast', 'assist_tkl']))
  setIfNumber(out, 'idp_sack', firstNumber(source, ['idp_sack', 'sack']))
  setIfNumber(out, 'idp_int', firstNumber(source, ['idp_int', 'def_int', 'int']))
  setIfNumber(out, 'idp_pd', firstNumber(source, ['idp_pd', 'idp_pass_def', 'pass_defended', 'pd']))
  setIfNumber(out, 'idp_ff', firstNumber(source, ['idp_ff', 'fum_forced', 'ff']))
  setIfNumber(out, 'idp_fr', firstNumber(source, ['idp_fr', 'idp_fum_rec', 'fum_rec', 'fr']))
  setIfNumber(out, 'idp_td', firstNumber(source, ['idp_td', 'idp_def_td', 'def_td']))
  setIfNumber(out, 'idp_safety', firstNumber(source, ['idp_safety', 'idp_safe', 'safety']))
  setIfNumber(out, 'idp_tfl', firstNumber(source, ['idp_tfl', 'idp_tkl_loss', 'tackle_loss', 'tfl']))
  setIfNumber(out, 'idp_qb_hit', firstNumber(source, ['idp_qb_hit', 'qb_hit', 'qb_hits']))
  // Scored straight from the provider's own count (first downs, long plays, bonuses, special teams).
  for (const key of NFL_EXTRA_PLAYER_STAT_KEYS) setIfNumber(out, key, asNumber(source[key]))

  return out
}

export function normalizeNflTeamDefenseWeeklyStats(raw: unknown): Record<string, number> {
  const source = isRecord(raw) && isRecord(raw.stats) ? raw.stats : raw
  if (!isRecord(source)) return {}

  const out: Record<string, number> = {}

  setIfNumber(out, 'def_sack', firstNumber(source, ['def_sack', 'dst_sack', 'sack', 'sacks', 'def_sacks']))
  setIfNumber(out, 'def_int', firstNumber(source, ['def_int', 'dst_interception', 'interceptions', 'int', 'def_interceptions']))
  setIfNumber(out, 'def_fr', firstNumber(source, ['def_fr', 'fum_rec', 'fumble_recovery', 'fumbles_recovered']))
  setIfNumber(out, 'def_safety', firstNumber(source, ['def_safety', 'def_safe', 'safe', 'safety', 'safeties']))
  setIfNumber(out, 'def_blk_kick', firstNumber(source, ['def_blk_kick', 'blk_kick', 'blocked_kick', 'blocked_kicks']))
  // Stored team rows share this unambiguous touchdown key with IDP rows. A bare `td`
  // on a team row describes opponent offensive touchdowns, so it must never be used here.
  setIfNumber(out, 'def_td', firstNumber(source, ['def_td', 'idp_defensive_touchdown', 'defensive_td', 'def_tds']))
  setIfNumber(
    out,
    'def_st_td',
    // A supplied total already includes its kick/punt-return components. Prefer the
    // total (including an explicit zero); add components only when no total exists.
    firstNumber(source, ['def_st_td', 'st_td', 'special_teams_td', 'ret_td']) ??
      sumNumbers(source, ['kr_td', 'pr_td']),
  )
  setIfNumber(
    out,
    'def_points_allowed',
    firstNumber(source, ['def_points_allowed', 'pts_allow', 'points_allowed', 'pa']),
  )
  setIfNumber(
    out,
    'def_yds_allowed',
    firstNumber(source, ['def_yds_allowed', 'yds_allow', 'yards_allowed', 'total_yards_allowed']),
  )
  setIfNumber(out, 'def_kr_yd', firstNumber(source, ['def_kr_yd', 'kr_yd', 'kick_return_yards', 'kr_yards']))
  setIfNumber(out, 'def_pr_yd', firstNumber(source, ['def_pr_yd', 'pr_yd', 'punt_return_yards', 'pr_yards']))
  for (const [key, from] of NFL_EXTRA_TEAM_STAT_SOURCES) setIfNumber(out, key, firstNumber(source, [key, from]))

  return out
}

export function isTeamDefenseRow(playerId: string | null | undefined, position: string | null | undefined): boolean {
  const pos = String(position ?? '').trim().toUpperCase()
  if (pos === 'DEF' || pos === 'DST') return true
  return String(playerId ?? '').toLowerCase().startsWith('nfl:def:')
}

export function teamAbbrevFromDefPlayerId(playerId: string | null | undefined): string | null {
  const match = String(playerId ?? '').match(/^nfl:def:(.+)$/i)
  return match ? match[1].trim().toUpperCase() : null
}

/**
 * The ONE key a team defence's box score is stored under — `nfl:def:<ABBR>` — for either id form a
 * roster can hold, or null when the row is not a team defence.
 *
 * 🛑 TWO ID FORMS, ONE DEFENCE. Sleeper's id for a defence is the bare club code (`KC` — every
 * Sleeper-league DEF slot on production); AllFantasy's synthetic one is `nfl:def:KC`. Every box-score
 * writer keys on the synthetic form — the team-defence ingest (`buildTeamDefensePlayerId`), the live
 * provider's defence lines, and all 8 `player_game_log_cache` defence rows on production (0 under a
 * bare code, 2026-10-13) — so a reader asking for `KC` found nothing and scored points-allowed alone.
 * The synthetic form is canonical because it is what the stored data and its writers already use;
 * a bare code is accepted only on a row whose position says team defence, since a two-letter id is
 * not otherwise self-describing.
 */
export function canonicalTeamDefenseId(
  playerId: string | null | undefined,
  position: string | null | undefined,
): string | null {
  const fromId = teamAbbrevFromDefPlayerId(playerId)
  if (fromId) return `nfl:def:${fromId}`
  const pos = String(position ?? '').trim().toUpperCase()
  if (pos !== 'DEF' && pos !== 'DST' && pos !== 'D/ST') return null
  const code = String(playerId ?? '').trim().toUpperCase()
  return /^[A-Z]{2,3}$/.test(code) ? `nfl:def:${code}` : null
}

export function pointsAllowedFromGame(
  game: { homeTeam: string | null; awayTeam: string | null; homeScore: number | null; awayScore: number | null },
  team: string,
): number | null {
  const want = team.trim().toUpperCase()
  const home = String(game.homeTeam ?? '').trim().toUpperCase()
  const away = String(game.awayTeam ?? '').trim().toUpperCase()
  if (want === home) return typeof game.awayScore === 'number' ? game.awayScore : null
  if (want === away) return typeof game.homeScore === 'number' ? game.homeScore : null
  return null
}

function rowWeek(row: unknown): number | null {
  if (!isRecord(row)) return null
  const direct = asNumber(row.week)
  if (direct !== undefined) return direct
  if (isRecord(row.stats)) {
    const nested = asNumber(row.stats.week)
    if (nested !== undefined) return nested
  }
  return null
}

export function findCachedWeekPayload(payload: unknown, week: number): unknown | null {
  if (Array.isArray(payload)) {
    return payload.find((row) => rowWeek(row) === week) ?? null
  }
  if (!isRecord(payload)) return null

  const direct = payload[String(week)]
  if (direct) return direct

  for (const key of ['gameLogs', 'weeklyStats', 'weeks', 'stats']) {
    const nested = payload[key]
    const found = findCachedWeekPayload(nested, week)
    if (found) return found
  }

  return rowWeek(payload) === week ? payload : null
}
