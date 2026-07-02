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
  setIfNumber(out, 'idp_solo', firstNumber(source, ['idp_solo', 'tackle_solo', 'solo_tkl']))
  setIfNumber(out, 'idp_assist', firstNumber(source, ['idp_assist', 'tackle_ast', 'assist_tkl']))
  setIfNumber(out, 'idp_sack', firstNumber(source, ['idp_sack', 'sack']))
  setIfNumber(out, 'idp_int', firstNumber(source, ['idp_int', 'def_int', 'int']))
  setIfNumber(out, 'idp_pd', firstNumber(source, ['idp_pd', 'pass_defended', 'pd']))
  setIfNumber(out, 'idp_ff', firstNumber(source, ['idp_ff', 'fum_forced', 'ff']))
  setIfNumber(out, 'idp_fr', firstNumber(source, ['idp_fr', 'fum_rec', 'fr']))
  setIfNumber(out, 'idp_td', firstNumber(source, ['idp_td', 'def_td']))
  setIfNumber(out, 'idp_safety', firstNumber(source, ['idp_safety', 'safety']))
  setIfNumber(out, 'idp_tfl', firstNumber(source, ['idp_tfl', 'tackle_loss', 'tfl']))
  setIfNumber(out, 'idp_qb_hit', firstNumber(source, ['idp_qb_hit', 'qb_hit', 'qb_hits']))

  return out
}

export function normalizeNflTeamDefenseWeeklyStats(raw: unknown): Record<string, number> {
  const source = isRecord(raw) && isRecord(raw.stats) ? raw.stats : raw
  if (!isRecord(source)) return {}

  const out: Record<string, number> = {}

  setIfNumber(out, 'def_sack', firstNumber(source, ['def_sack', 'sack', 'sacks', 'def_sacks']))
  setIfNumber(out, 'def_int', firstNumber(source, ['def_int', 'interceptions', 'int', 'def_interceptions']))
  setIfNumber(out, 'def_fr', firstNumber(source, ['def_fr', 'fum_rec', 'fumble_recovery', 'fumbles_recovered']))
  setIfNumber(out, 'def_safety', firstNumber(source, ['def_safety', 'def_safe', 'safe', 'safety', 'safeties']))
  setIfNumber(out, 'def_blk_kick', firstNumber(source, ['def_blk_kick', 'blk_kick', 'blocked_kick', 'blocked_kicks']))
  setIfNumber(out, 'def_td', firstNumber(source, ['def_td', 'defensive_td', 'def_tds']))
  setIfNumber(
    out,
    'def_st_td',
    sumNumbers(source, ['def_st_td', 'st_td', 'special_teams_td', 'ret_td', 'kr_td', 'pr_td']),
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
