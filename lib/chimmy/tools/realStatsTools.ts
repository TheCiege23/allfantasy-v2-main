import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

/**
 * REAL-WORLD STATS FOR CHIMMY, READ FROM OUR OWN TABLES (Phase 1: NFL + college football).
 *
 * Until this module Chimmy had no stats tool at all: "how many yards did Chase have last week",
 * "who leads the NFL in rushing" and "SEC standings" fell through to a paid web search, while the
 * answers sat in tables refreshed every day. Measured on production 2026-09-23 (read-only):
 *
 *   fantasy_stat_lines  NFL  rolling_insights  2026 season totals  1,231 rows, refreshed today
 *   fantasy_stat_lines  NCAAF cfbd             2026 season totals 13,023 rows, refreshed today
 *   player_game_stats   NFL  sleeper           per-week lines (2025: 40,473 rows; 2026: see below)
 *   SportsDataCache     {NFL,NCAAF}:standings:2026:*   33 / 138 rows (ESPN, every 4h)
 *
 * ⚠ 2026 NFL WEEKLY LINES WERE NEARLY EMPTY (286 rows) because each week was ledgered complete
 * after its first game — fixed in `findWeeksNeedingWork` in the same change. Until the import
 * catches up, a missing week here means "not imported", and every executor says exactly that.
 *
 * ⚠ ABSENCE IS A SENTENCE, NEVER EMPTY (the rule in chimmyTools.ts). Each builder distinguishes
 * "we hold nothing for this sport/season" (a pipeline statement) from "we hold rows and none is
 * this player" (a player statement), and never lets a missing row read as a zero.
 *
 * ⚠ NO MODEL TEXT REACHES SQL AS AN IDENTIFIER. Stat keys come from the whitelists below; the
 * player name is only ever a bound parameter to ILIKE, then matched exactly in JS.
 */

type Db = Pick<typeof defaultPrisma, '$queryRaw'>

export type StatsSport = 'NFL' | 'NCAAF'

/** Which season-total source each sport reads, and the JSON key its rows carry the name under. */
const SEASON_SOURCE: Record<StatsSport, { source: string; nameKey: string; label: string }> = {
  NFL: { source: 'rolling_insights', nameKey: 'riPlayerName', label: 'Rolling Insights' },
  NCAAF: { source: 'cfbd', nameKey: 'name', label: 'CollegeFootballData' },
}

export function normalizeStatsSport(raw: unknown): StatsSport | null {
  const v = String(raw ?? 'NFL').trim().toUpperCase().replace(/[\s_-]+/g, '')
  if (!v || v === 'NFL') return 'NFL'
  if (v === 'NCAAF' || v === 'NCAAFB' || v === 'CFB' || v === 'COLLEGEFOOTBALL' || v === 'CFBD') return 'NCAAF'
  return null
}

function unsupportedSport(raw: unknown): string {
  return `Stats for "${String(raw)}" are not available from AllFantasy's data yet — only NFL and college football are. Say so plainly; do not give numbers from memory.`
}

/** The longest run of letters in a name — the ILIKE prefilter, same rule the projection reader uses. */
export function nameToken(raw: string): string {
  const parts = String(raw).split(/[^A-Za-z]+/).filter(Boolean)
  return parts.reduce((best, p) => (p.length > best.length ? p : best), '')
}

function isoMinute(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? null : `${t.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** The newest of some timestamps. By time — `Array.sort()` on Dates compares their strings. */
function latest(values: Array<Date | string | null | undefined>): Date | null {
  let best: number | null = null
  for (const v of values) {
    if (!v) continue
    const t = new Date(v).getTime()
    if (Number.isFinite(t) && (best == null || t > best)) best = t
  }
  return best == null ? null : new Date(best)
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

// ── Season totals ────────────────────────────────────────────────────────────────────────────

/** Friendly labels, in the order they should read. Unlisted numeric keys still render, humanized. */
const NFL_SEASON_LABELS: Array<[string, string]> = [
  ['games_played', 'Games'],
  ['completions', 'Completions'],
  ['passing_attempts', 'Pass attempts'],
  ['passing_yards', 'Passing yards'],
  ['passing_touchdowns', 'Passing TDs'],
  ['passing_interceptions', 'Interceptions thrown'],
  ['passer_rating', 'Passer rating'],
  ['rushing_attempts', 'Rush attempts'],
  ['rushing_yards', 'Rushing yards'],
  ['rushing_touchdowns', 'Rushing TDs'],
  ['rushing_long', 'Longest rush'],
  ['targets', 'Targets'],
  ['receptions', 'Receptions'],
  ['receiving_yards', 'Receiving yards'],
  ['receiving_touchdowns', 'Receiving TDs'],
  ['receiving_long', 'Longest reception'],
  ['fumbles', 'Fumbles'],
  ['fumbles_lost', 'Fumbles lost'],
  ['tackles', 'Tackles'],
  ['sacks', 'Sacks'],
  // ⚠ Rolling Insights `interceptions` is DEFENSIVE (caught); thrown is `passing_interceptions`.
  ['interceptions', 'Interceptions (defense)'],
  ['forced_fumbles', 'Forced fumbles'],
  ['field_goals_made', 'Field goals made'],
  ['field_goals_attempted', 'Field goal attempts'],
  ['field_goals_long', 'Longest field goal'],
  ['extra_points_made', 'Extra points made'],
]

const NCAAF_SEASON_LABELS: Array<[string, string]> = [
  ['games_played', 'Games'],
  ['passing.COMPLETIONS', 'Completions'],
  ['passing.ATT', 'Pass attempts'],
  ['passing.YDS', 'Passing yards'],
  ['passing.TD', 'Passing TDs'],
  ['passing.INT', 'Interceptions thrown'],
  ['passing.PCT', 'Completion rate'],
  ['passing.YPA', 'Yards per attempt'],
  ['rushing.CAR', 'Carries'],
  ['rushing.YPC', 'Yards per carry'],
  ['rushing.YDS', 'Rushing yards'],
  ['rushing.TD', 'Rushing TDs'],
  ['rushing.LONG', 'Longest rush'],
  ['receiving.REC', 'Receptions'],
  ['receiving.YDS', 'Receiving yards'],
  ['receiving.TD', 'Receiving TDs'],
  ['receiving.LONG', 'Longest reception'],
  ['fumbles.LOST', 'Fumbles lost'],
  ['defensive.TOT', 'Tackles'],
  ['defensive.SACKS', 'Sacks'],
  ['defensive.TFL', 'Tackles for loss'],
  ['interceptions.INT', 'Interceptions (defense)'],
]

/* DraftKings points the provider attaches are not the user's scoring and did not reconcile with
 * the counting stats on a sampled row (89.1 for 9 rec / 87 yds / 2 TD) — never shown. */
const HIDDEN_SEASON_KEYS = /^DK_|^snap_count/

function renderStatBlock(block: Record<string, unknown>, labels: Array<[string, string]>): string {
  const parts: string[] = []
  const used = new Set<string>()
  for (const [key, label] of labels) {
    const n = num(block[key])
    if (n == null) continue
    used.add(key)
    parts.push(`${label}: ${fmt(n)}`)
  }
  for (const [key, value] of Object.entries(block)) {
    if (used.has(key) || HIDDEN_SEASON_KEYS.test(key)) continue
    const n = num(value)
    if (n == null) continue
    parts.push(`${key.replace(/[._]+/g, ' ')}: ${fmt(n)}`)
  }
  return parts.join(' · ')
}

type SeasonRow = { playerId: string; season: string; team: string | null; stats: unknown; fetchedAt: Date | null }

async function newestSeason(db: Db, sport: StatsSport): Promise<string | null> {
  const { source } = SEASON_SOURCE[sport]
  const rows = await db.$queryRaw<Array<{ season: string | null }>>(Prisma.sql`
    SELECT max(season) AS season FROM fantasy_stat_lines
    WHERE sport = ${sport} AND source = ${source} AND week = 0`)
  return rows[0]?.season ?? null
}

export async function buildPlayerSeasonStatsContext(
  args: { playerName: string; sport?: unknown; season?: unknown },
  db: Db = defaultPrisma,
): Promise<string> {
  const asked = String(args.playerName ?? '').trim()
  if (!asked) return 'No player name was given, so nothing was looked up. Ask which player they mean.'
  const sport = normalizeStatsSport(args.sport)
  if (!sport) return unsupportedSport(args.sport)
  const { source, nameKey, label } = SEASON_SOURCE[sport]

  const season =
    typeof args.season === 'number' && Number.isFinite(args.season)
      ? String(Math.floor(args.season))
      : await newestSeason(db, sport)
  if (!season) {
    return `NO ${sport} SEASON STATS ARE STORED AT ALL, so nothing could be looked up. This is not a finding about the player; say the stats are unavailable right now.`
  }

  const token = nameToken(asked)
  if (token.length < 2) return `"${asked}" is not a name I can search for. Ask for the player's full name.`

  const rows = await db.$queryRaw<SeasonRow[]>(Prisma.sql`
    SELECT player_id AS "playerId", season, team, stats, fetched_at AS "fetchedAt"
    FROM fantasy_stat_lines
    WHERE sport = ${sport} AND source = ${source} AND week = 0 AND season = ${season}
      AND (stats ->> ${nameKey}) ILIKE ${`%${token}%`}
    LIMIT 60`)

  const target = normalizePlayerName(asked)
  const named = rows.map((r) => {
    const stats = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>
    return { row: r, stats, name: String(stats[nameKey] ?? '') }
  })
  const exact = named.filter((n) => normalizePlayerName(n.name) === target)

  if (exact.length === 0) {
    const near = [...new Set(named.map((n) => n.name).filter(Boolean))].slice(0, 5)
    return [
      `No ${sport} ${season} season line is stored for "${asked}".`,
      near.length ? `Similar names on file: ${near.join(', ')}. Ask which one they mean rather than picking.` : '',
      'A miss is NOT evidence he has no stats — do not report zeros or numbers from memory.',
    ]
      .filter(Boolean)
      .join(' ')
  }

  const labels = sport === 'NFL' ? NFL_SEASON_LABELS : NCAAF_SEASON_LABELS
  const lines: string[] = []
  if (exact.length > 1) {
    lines.push(`⚠ ${exact.length} different players are named "${asked}". Ask which one they mean rather than picking.`)
  }
  for (const { row, stats, name } of exact) {
    const regular = stats.regular_season && typeof stats.regular_season === 'object'
      ? (stats.regular_season as Record<string, unknown>)
      : null
    const team = String(stats.riTeam ?? row.team ?? '').trim()
    const position = String(stats.position ?? '').trim()
    lines.push(
      `${name}${position ? `, ${position}` : ''}${team ? `, ${team}` : ''} — ${sport} ${season} regular season, from ${label}, refreshed ${isoMinute(row.fetchedAt) ?? 'at an unknown time'}:`,
    )
    lines.push(regular ? `- ${renderStatBlock(regular, labels) || 'no counting stats recorded yet'}` : '- No regular-season stats recorded yet.')
    const post = stats.postseason && typeof stats.postseason === 'object'
      ? renderStatBlock(stats.postseason as Record<string, unknown>, labels)
      : ''
    if (post) lines.push(`- Postseason: ${post}`)
  }
  lines.push(
    'These are season-to-date totals from the provider, not your league\'s fantasy points. A stat that is not listed was not recorded — do not invent it.',
  )
  return lines.join('\n')
}

// ── NFL game log ─────────────────────────────────────────────────────────────────────────────

/** Sleeper's weekly keys, grouped so a line reads like a box score. */
const NFL_GAME_KEYS: Array<[string, string]> = [
  ['pass_cmp', 'cmp'],
  ['pass_att', 'att'],
  ['pass_yd', 'pass yds'],
  ['pass_td', 'pass TD'],
  ['pass_int', 'INT'],
  ['rush_att', 'rush att'],
  ['rush_yd', 'rush yds'],
  ['rush_td', 'rush TD'],
  ['rec_tgt', 'tgt'],
  ['rec', 'rec'],
  ['rec_yd', 'rec yds'],
  ['rec_td', 'rec TD'],
  ['fum_lost', 'fumbles lost'],
  ['idp_tkl', 'tackles'],
  ['idp_sack', 'sacks'],
  ['idp_int', 'INT (def)'],
  ['fgm', 'FG made'],
  ['fga', 'FG att'],
  ['xpm', 'XP made'],
]

type GameRow = {
  playerId: string
  season: number
  week: number
  team: string | null
  opponent: string | null
  gameDate: Date | null
  statPayload: unknown
}

export async function buildPlayerGameLogContext(
  args: { playerName: string; sport?: unknown; season?: unknown; week?: unknown; lastN?: unknown },
  db: Db = defaultPrisma,
): Promise<string> {
  const asked = String(args.playerName ?? '').trim()
  if (!asked) return 'No player name was given, so nothing was looked up. Ask which player they mean.'
  const sport = normalizeStatsSport(args.sport)
  if (!sport) return unsupportedSport(args.sport)
  if (sport === 'NCAAF') return buildNcaafGameLogContext(args, db)

  const token = nameToken(asked)
  if (token.length < 2) return `"${asked}" is not a name I can search for. Ask for the player's full name.`

  /*
   * player_game_stats keys NFL rows on the SLEEPER id; PlayerIdentityMap is the bridge (sleeperId is
   * unique there — measured 9,037 rows / 9,037 ids). Matched exactly in JS with the app's own
   * normalizer, never the stored normalizedName column, which other writers fill differently.
   */
  const candidates = await db.$queryRaw<Array<{ sleeperId: string; canonicalName: string; position: string | null; currentTeam: string | null }>>(Prisma.sql`
    SELECT "sleeperId", "canonicalName", position, "currentTeam"
    FROM "PlayerIdentityMap"
    WHERE sport = 'NFL' AND "sleeperId" IS NOT NULL AND "canonicalName" ILIKE ${`%${token}%`}
    LIMIT 60`)
  const target = normalizePlayerName(asked)
  const players = candidates.filter((c) => normalizePlayerName(c.canonicalName) === target)
  if (players.length === 0) {
    const near = [...new Set(candidates.map((c) => c.canonicalName))].slice(0, 5)
    return [
      `No NFL player named "${asked}" is in AllFantasy's player registry.`,
      near.length ? `Similar names: ${near.join(', ')}. Ask which one they mean.` : '',
      'Do not give a game line from memory.',
    ]
      .filter(Boolean)
      .join(' ')
  }
  if (players.length > 1) {
    return `${players.length} NFL players are named "${asked}" (${players.map((p) => `${p.position ?? '?'} ${p.currentTeam ?? 'FA'}`).join('; ')}). Ask which one they mean rather than picking.`
  }
  const player = players[0]

  const week = typeof args.week === 'number' && Number.isFinite(args.week) ? Math.floor(args.week) : null
  const requestedSeason = typeof args.season === 'number' && Number.isFinite(args.season) ? Math.floor(args.season) : null
  const lastN = Math.min(10, Math.max(1, typeof args.lastN === 'number' && Number.isFinite(args.lastN) ? Math.floor(args.lastN) : 5))

  const [seasonRows, currentRows] = await Promise.all([
    db.$queryRaw<Array<{ season: number | null }>>(Prisma.sql`
      SELECT max(season) AS season FROM player_game_stats
      WHERE "sportType" = 'NFL' AND "playerId" = ${player.sleeperId}`),
    db.$queryRaw<Array<{ season: number | null }>>(Prisma.sql`
      SELECT max(season) AS season FROM player_game_stats WHERE "sportType" = 'NFL'`),
  ])
  const season = requestedSeason ?? seasonRows[0]?.season ?? null
  const currentSeason = currentRows[0]?.season ?? null
  /*
   * ⚠ "HIS LATEST SEASON" IS NOT "THIS SEASON". Measured live: asked for Ja'Marr Chase with no
   * season, this fell back to his 2025 weeks — correctly labelled, and exactly what a model would
   * then call "last week". When his newest stored season trails the newest season on file, say so
   * in words the model cannot paraphrase into a current-week answer.
   */
  const staleSeason =
    requestedSeason == null && season != null && currentSeason != null && season < currentSeason
      ? `⚠ NO ${currentSeason} GAME LINES ARE STORED FOR HIM YET — the lines below are from ${season}, NOT this season. Do NOT present any of them as "last week" or as ${currentSeason} stats; offer his ${currentSeason} season totals (get_player_season_stats) instead.`
      : null
  if (season == null) {
    return `No NFL game lines are stored for ${player.canonicalName} at all. This is a gap in AllFantasy's data, not a finding that he did not play — say so, and do not give numbers from memory.`
  }

  const rows = await db.$queryRaw<GameRow[]>(Prisma.sql`
    SELECT "playerId", season, "weekOrRound" AS week, team, opponent, game_date AS "gameDate", stat_payload AS "statPayload"
    FROM player_game_stats
    WHERE "sportType" = 'NFL' AND "playerId" = ${player.sleeperId} AND season = ${season}
      ${week != null ? Prisma.sql`AND "weekOrRound" = ${week}` : Prisma.empty}
    ORDER BY "weekOrRound" DESC
    LIMIT ${week != null ? 3 : lastN}`)

  const header = `${player.canonicalName} (${player.position ?? '?'}, ${player.currentTeam ?? 'FA'}) — NFL ${season}, per-game lines from Sleeper's weekly stats:`
  if (rows.length === 0) {
    return [
      header,
      week != null
        ? `- No line is stored for week ${week}. Either he did not play, or that week has not been imported yet — do NOT report it as zero, and say which is unknown.`
        : `- No lines are stored for ${season}. Either he has not played, or the season's weeks have not been imported yet — do NOT report zeros.`,
    ].join('\n')
  }

  const lines = staleSeason ? [staleSeason, header] : [header]
  for (const r of rows) {
    const s = (r.statPayload && typeof r.statPayload === 'object' ? r.statPayload : {}) as Record<string, unknown>
    const parts: string[] = []
    for (const [key, label] of NFL_GAME_KEYS) {
      const n = num(s[key])
      if (n != null && n !== 0) parts.push(`${fmt(n)} ${label}`)
    }
    const ppr = num(s.pts_ppr)
    const half = num(s.pts_half_ppr)
    const std = num(s.pts_std)
    const pts = [ppr != null ? `${fmt(ppr)} PPR` : null, half != null ? `${fmt(half)} half-PPR` : null, std != null ? `${fmt(std)} standard` : null]
      .filter(Boolean)
      .join(' / ')
    const when = r.gameDate ? ` (${new Date(r.gameDate).toISOString().slice(0, 10)})` : ''
    lines.push(
      `- Week ${r.week}${r.opponent ? ` vs ${r.opponent}` : ''}${when}: ${parts.length ? parts.join(', ') : 'active, no counting stats'}${pts ? ` · ${pts} pts` : ''}`,
    )
  }
  lines.push(
    'Fantasy points shown are Sleeper\'s standard presets, NOT the user\'s league scoring. A week missing from this list was not played or not imported yet — never a zero.',
  )
  return lines.join('\n')
}

// ── College football game log ────────────────────────────────────────────────────────────────

/** CFBD per-game keys (lib/stats/cfbdGameLogs.ts), in box-score order. */
const NCAAF_GAME_KEYS: Array<[string, string]> = [
  ['passing.COMPLETIONS', 'cmp'],
  ['passing.ATT', 'att'],
  ['passing.YDS', 'pass yds'],
  ['passing.TD', 'pass TD'],
  ['passing.INT', 'INT'],
  ['rushing.CAR', 'car'],
  ['rushing.YDS', 'rush yds'],
  ['rushing.TD', 'rush TD'],
  ['receiving.REC', 'rec'],
  ['receiving.YDS', 'rec yds'],
  ['receiving.TD', 'rec TD'],
  ['fumbles.LOST', 'fumbles lost'],
  ['defensive.TOT', 'tackles'],
  ['defensive.TFL', 'TFL'],
  ['defensive.SACKS', 'sacks'],
  ['interceptions.INT', 'INT (def)'],
  ['kicking.FGM', 'FG made'],
  ['kicking.FGA', 'FG att'],
  ['kicking.XPM', 'XP made'],
]

/*
 * College lines live in player_game_stats under the CFBD athlete id — the SAME id the CFBD season
 * rows in fantasy_stat_lines carry (their `player_id`), so a player found by name there is the key
 * here. No identity-map hop, and so none of its coverage gaps.
 */
async function buildNcaafGameLogContext(
  args: { playerName: string; season?: unknown; week?: unknown; lastN?: unknown },
  db: Db,
): Promise<string> {
  const asked = String(args.playerName ?? '').trim()
  const token = nameToken(asked)
  if (token.length < 2) return `"${asked}" is not a name I can search for. Ask for the player's full name.`

  const candidates = await db.$queryRaw<Array<{ playerId: string; name: string | null; team: string | null; position: string | null; season: string }>>(Prisma.sql`
    SELECT DISTINCT ON (player_id) player_id AS "playerId", stats ->> 'name' AS name,
           coalesce(stats ->> 'riTeam', team) AS team, stats ->> 'position' AS position, season
    FROM fantasy_stat_lines
    WHERE sport = 'NCAAF' AND source = 'cfbd' AND week = 0 AND (stats ->> 'name') ILIKE ${`%${token}%`}
    ORDER BY player_id, season DESC
    LIMIT 60`)
  const target = normalizePlayerName(asked)
  const players = candidates.filter((c) => normalizePlayerName(c.name ?? '') === target)
  if (players.length === 0) {
    const near = [...new Set(candidates.map((c) => c.name).filter(Boolean))].slice(0, 5)
    return [
      `No college football player named "${asked}" has stats on file.`,
      near.length ? `Similar names: ${near.join(', ')}. Ask which one they mean.` : '',
      'Do not give a game line from memory.',
    ]
      .filter(Boolean)
      .join(' ')
  }
  if (players.length > 1) {
    return `${players.length} college players are named "${asked}" (${players.map((p) => `${p.position ?? '?'}, ${p.team ?? '?'}`).join('; ')}). Ask which one they mean rather than picking.`
  }
  const player = players[0]

  const week = typeof args.week === 'number' && Number.isFinite(args.week) ? Math.floor(args.week) : null
  const requestedSeason = typeof args.season === 'number' && Number.isFinite(args.season) ? Math.floor(args.season) : null
  const lastN = Math.min(10, Math.max(1, typeof args.lastN === 'number' && Number.isFinite(args.lastN) ? Math.floor(args.lastN) : 5))

  const [seasonRows, currentRows] = await Promise.all([
    db.$queryRaw<Array<{ season: number | null }>>(Prisma.sql`
      SELECT max(season) AS season FROM player_game_stats WHERE "sportType" = 'NCAAF' AND "playerId" = ${player.playerId}`),
    db.$queryRaw<Array<{ season: number | null }>>(Prisma.sql`
      SELECT max(season) AS season FROM player_game_stats WHERE "sportType" = 'NCAAF'`),
  ])
  const currentSeason = currentRows[0]?.season ?? null
  if (currentSeason == null) {
    return 'NO college football game lines are stored yet (the per-game import is new). Offer his season totals (get_player_season_stats) instead; do not give a game line from memory.'
  }
  const season = requestedSeason ?? seasonRows[0]?.season ?? null
  const header = `${player.name} (${player.position ?? '?'}, ${player.team ?? '?'}) — NCAAF${season != null ? ` ${season}` : ''}, per-game lines from CollegeFootballData:`
  if (season == null) {
    return [
      header,
      '- No game lines are stored for him. Either he has not recorded a stat, or his games have not been imported yet — do NOT report zeros; offer season totals instead.',
    ].join('\n')
  }
  const staleSeason =
    requestedSeason == null && season < currentSeason
      ? `⚠ NO ${currentSeason} GAME LINES ARE STORED FOR HIM YET — the lines below are from ${season}, NOT this season. Do NOT present them as "last week"; offer his ${currentSeason} season totals instead.`
      : null

  const rows = await db.$queryRaw<GameRow[]>(Prisma.sql`
    SELECT "playerId", season, "weekOrRound" AS week, team, opponent, game_date AS "gameDate", stat_payload AS "statPayload"
    FROM player_game_stats
    WHERE "sportType" = 'NCAAF' AND "playerId" = ${player.playerId} AND season = ${season}
      ${week != null ? Prisma.sql`AND "weekOrRound" = ${week}` : Prisma.empty}
    ORDER BY "weekOrRound" DESC
    LIMIT ${week != null ? 3 : lastN}`)
  if (rows.length === 0) {
    return [
      header,
      week != null
        ? `- No line is stored for week ${week}. Either he did not record a stat, or that week has not been imported yet — do NOT report it as zero.`
        : `- No lines are stored for ${season}. Do NOT report zeros; offer season totals instead.`,
    ].join('\n')
  }

  const lines = staleSeason ? [staleSeason, header] : [header]
  for (const r of rows) {
    const s = (r.statPayload && typeof r.statPayload === 'object' ? r.statPayload : {}) as Record<string, unknown>
    const parts: string[] = []
    for (const [key, label] of NCAAF_GAME_KEYS) {
      const n = num(s[key])
      if (n != null && n !== 0) parts.push(`${fmt(n)} ${label}`)
    }
    const opponent = typeof s._opponent === 'string' && s._opponent.trim() ? s._opponent.trim() : null
    const where = s._homeAway === 'away' ? ' at ' : ' vs '
    const when = r.gameDate ? ` (${new Date(r.gameDate).toISOString().slice(0, 10)})` : ''
    lines.push(`- Week ${r.week}${opponent ? `${where}${opponent}` : ''}${when}: ${parts.length ? parts.join(', ') : 'appeared, no counting stats'}`)
  }
  lines.push('A week missing from this list means no recorded stat or not imported yet — never a zero.')
  return lines.join('\n')
}

// ── Season leaders ───────────────────────────────────────────────────────────────────────────

/** Friendly stat → the JSON key inside `regular_season`, per sport. The ONLY keys that reach SQL. */
export const LEADER_STATS: Record<string, { label: string; NFL?: string; NCAAF?: string }> = {
  passing_yards: { label: 'passing yards', NFL: 'passing_yards', NCAAF: 'passing.YDS' },
  passing_touchdowns: { label: 'passing TDs', NFL: 'passing_touchdowns', NCAAF: 'passing.TD' },
  passing_interceptions: { label: 'interceptions thrown', NFL: 'passing_interceptions', NCAAF: 'passing.INT' },
  completions: { label: 'completions', NFL: 'completions', NCAAF: 'passing.COMPLETIONS' },
  rushing_yards: { label: 'rushing yards', NFL: 'rushing_yards', NCAAF: 'rushing.YDS' },
  rushing_touchdowns: { label: 'rushing TDs', NFL: 'rushing_touchdowns', NCAAF: 'rushing.TD' },
  rushing_attempts: { label: 'rush attempts', NFL: 'rushing_attempts', NCAAF: 'rushing.CAR' },
  receiving_yards: { label: 'receiving yards', NFL: 'receiving_yards', NCAAF: 'receiving.YDS' },
  receptions: { label: 'receptions', NFL: 'receptions', NCAAF: 'receiving.REC' },
  receiving_touchdowns: { label: 'receiving TDs', NFL: 'receiving_touchdowns', NCAAF: 'receiving.TD' },
  targets: { label: 'targets', NFL: 'targets' },
  sacks: { label: 'sacks', NFL: 'sacks', NCAAF: 'defensive.SACKS' },
  tackles: { label: 'tackles', NFL: 'tackles', NCAAF: 'defensive.TOT' },
  interceptions: { label: 'interceptions (defense)', NFL: 'interceptions', NCAAF: 'interceptions.INT' },
  forced_fumbles: { label: 'forced fumbles', NFL: 'forced_fumbles' },
  field_goals_made: { label: 'field goals made', NFL: 'field_goals_made' },
}

export async function buildSeasonLeadersContext(
  args: { stat: unknown; sport?: unknown; season?: unknown; limit?: unknown },
  db: Db = defaultPrisma,
): Promise<string> {
  const sport = normalizeStatsSport(args.sport)
  if (!sport) return unsupportedSport(args.sport)
  const statKey = String(args.stat ?? '').trim().toLowerCase()
  const stat = LEADER_STATS[statKey]
  const jsonKey = stat?.[sport]
  if (!stat || !jsonKey) {
    const offered = Object.keys(LEADER_STATS).filter((k) => LEADER_STATS[k][sport]).join(', ')
    return `"${statKey}" is not a ${sport} stat I can rank. Available: ${offered}. Do not produce a leaderboard from memory.`
  }
  const { source, nameKey, label } = SEASON_SOURCE[sport]
  const season =
    typeof args.season === 'number' && Number.isFinite(args.season)
      ? String(Math.floor(args.season))
      : await newestSeason(db, sport)
  if (!season) return `NO ${sport} SEASON STATS ARE STORED AT ALL, so no leaderboard can be built. Say so.`
  const limit = Math.min(10, Math.max(1, typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : 5))

  /* The value is read as text and cast only when it is a plain number, so one malformed row
   * cannot fail the whole query. [0-9.] rather than \d: this string passes through layers. */
  const rows = await db.$queryRaw<Array<{ name: string | null; team: string | null; position: string | null; value: string | null; games: string | null; fetchedAt: Date | null }>>(Prisma.sql`
    SELECT stats ->> ${nameKey} AS name,
           coalesce(stats ->> 'riTeam', team) AS team,
           stats ->> 'position' AS position,
           stats -> 'regular_season' ->> ${jsonKey} AS value,
           stats -> 'regular_season' ->> 'games_played' AS games,
           fetched_at AS "fetchedAt"
    FROM fantasy_stat_lines
    WHERE sport = ${sport} AND source = ${source} AND week = 0 AND season = ${season}
      AND (stats -> 'regular_season' ->> ${jsonKey}) ~ '^-?[0-9]+([.][0-9]+)?$'
    ORDER BY (stats -> 'regular_season' ->> ${jsonKey})::numeric DESC, stats ->> ${nameKey} ASC
    LIMIT ${limit}`)

  if (rows.length === 0) {
    return `No ${sport} ${season} player has a recorded ${stat.label} total yet. Say so; do not name leaders from memory.`
  }
  const asOf = latest(rows.map((r) => r.fetchedAt))
  return [
    `${sport} ${season} regular-season leaders in ${stat.label}, from ${label} season totals (refreshed ${isoMinute(asOf) ?? 'at an unknown time'}):`,
    ...rows.map((r, i) => {
      const v = num(r.value)
      const g = num(r.games)
      return `${i + 1}. ${r.name ?? 'Unknown'}${r.position ? ` (${r.position}` : ' ('}${r.team ? `, ${r.team})` : ')'} — ${v != null ? fmt(v) : '?'}${g != null ? ` in ${fmt(g)} games` : ''}`
    }),
    'These are season-to-date TOTALS through the provider\'s last refresh, not per-game rates, and only players with a recorded value are ranked.',
    ...(sport === 'NCAAF'
      ? ['College data covers every division, FCS included — if the user means FBS only, say this list may include FCS players.']
      : []),
  ].join('\n')
}

// ── Real standings ───────────────────────────────────────────────────────────────────────────

type StandingEntry = {
  team?: string
  teamName?: string
  won?: number
  lost?: number
  tied?: number
  pointsFor?: number
  pointsAgainst?: number
  conference?: string
  division?: string
}

function hasConference(data: unknown): boolean {
  return Boolean(data && typeof data === 'object' && (data as StandingEntry).conference)
}

/**
 * What people type → the name ESPN stores (measured: "Southeastern Conference", "Big Ten
 * Conference", "American Football Conference", …). Unknown input passes through as a substring.
 */
const GROUP_ALIASES: Record<string, string> = {
  sec: 'southeastern',
  acc: 'atlantic coast',
  b1g: 'big ten',
  'big 10': 'big ten',
  'big10': 'big ten',
  'big 12': 'big 12',
  big12: 'big 12',
  'pac 12': 'pac-12',
  pac12: 'pac-12',
  aac: 'american conference',
  american: 'american conference',
  mac: 'mid-american',
  mwc: 'mountain west',
  cusa: 'conference usa',
  'c-usa': 'conference usa',
  independents: 'independents',
  afc: 'american football conference',
  nfc: 'national football conference',
}

function expandGroup(raw: string): string {
  const v = raw.trim().toLowerCase()
  if (!v) return ''
  return GROUP_ALIASES[v] ?? GROUP_ALIASES[v.replace(/\s+conference$/, '')] ?? v
}

export async function buildRealStandingsContext(
  args: { sport?: unknown; season?: unknown; group?: unknown },
  db: Db = defaultPrisma,
): Promise<string> {
  const sport = normalizeStatsSport(args.sport)
  if (!sport) return unsupportedSport(args.sport)

  /*
   * ⚠ ALWAYS ONE SEASON, AND NO ROW CAP. The digest this replaces read the key PREFIX with no
   * season filter and `take: 40` — mixing seasons and cutting college football (138 teams) off
   * mid-list. Keys are `{SPORT}:standings:{season}:{ABBR}`.
   */
  let season: string | null =
    typeof args.season === 'number' && Number.isFinite(args.season) ? String(Math.floor(args.season)) : null
  if (!season) {
    const seasons = await db.$queryRaw<Array<{ season: string | null }>>(Prisma.sql`
      SELECT max(split_part(key, ':', 3)) AS season FROM "SportsDataCache"
      WHERE key LIKE ${`${sport}:standings:%`}`)
    season = seasons[0]?.season ?? null
  }
  if (!season) return `NO ${sport} STANDINGS ARE STORED, so none can be shown. Say so; do not recite standings from memory.`

  const rows = await db.$queryRaw<Array<{ key: string; data: unknown }>>(Prisma.sql`
    SELECT key, data FROM "SportsDataCache"
    WHERE key LIKE ${`${sport}:standings:${season}:%`}`)
  if (rows.length === 0) return `No ${sport} ${season} standings are stored. Say so; do not recite them from memory.`

  const group = expandGroup(typeof args.group === 'string' ? args.group : '')
  const seen = new Set<string>()
  const teams: Array<StandingEntry & { name: string; pct: number; diff: number; bucket: string }> = []
  /* Rows WITH a conference first, so a stray duplicate carrying none cannot win the dedupe below
   * and push a real team into "Other" (one 2026 NFL row has a null conference). */
  const ordered = [...rows].sort((a, b) => Number(hasConference(b.data)) - Number(hasConference(a.data)))
  for (const r of ordered) {
    const d = (r.data && typeof r.data === 'object' ? r.data : {}) as StandingEntry
    const name = String(d.teamName ?? d.team ?? r.key.split(':')[3] ?? '').trim()
    if (!name || seen.has(name.toLowerCase())) continue
    const bucket = String(d.conference ?? d.division ?? 'Other').trim() || 'Other'
    if (group && !bucket.toLowerCase().includes(group) && !String(d.division ?? '').toLowerCase().includes(group)) continue
    seen.add(name.toLowerCase())
    const w = num(d.won) ?? 0
    const l = num(d.lost) ?? 0
    const t = num(d.tied) ?? 0
    const games = w + l + t
    teams.push({
      ...d,
      name,
      bucket,
      pct: games > 0 ? (w + t / 2) / games : 0,
      diff: (num(d.pointsFor) ?? 0) - (num(d.pointsAgainst) ?? 0),
    })
  }
  if (teams.length === 0) {
    return `No ${sport} ${season} team matches "${String(args.group)}". Say so, and offer the full standings instead.`
  }

  const buckets = new Map<string, typeof teams>()
  for (const t of teams) buckets.set(t.bucket, [...(buckets.get(t.bucket) ?? []), t])
  /* No "refreshed at": the cache keeps only `createdAt`, and rows are updated in place, so the
   * creation time understates freshness by days (measured: 09-18 on rows showing week-2 results). */
  const out = [`${sport} ${season} standings (ESPN, updated every few hours):`]
  for (const [bucket, list] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`${bucket}:`)
    list
      .sort((a, b) => b.pct - a.pct || b.diff - a.diff || a.name.localeCompare(b.name))
      .forEach((t) => {
        const rec = `${fmt(num(t.won) ?? 0)}-${fmt(num(t.lost) ?? 0)}${num(t.tied) ? `-${fmt(num(t.tied) ?? 0)}` : ''}`
        const pf = num(t.pointsFor)
        const pa = num(t.pointsAgainst)
        out.push(`- ${t.name} ${rec}${pf != null && pa != null ? ` (PF ${fmt(pf)}, PA ${fmt(pa)})` : ''}`)
      })
  }
  out.push('Ordered by win percentage, then point differential — not an official tiebreaker order.')
  return out.join('\n')
}
