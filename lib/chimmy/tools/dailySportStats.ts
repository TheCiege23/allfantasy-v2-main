import 'server-only'

import { Prisma } from '@prisma/client'
import type { prisma as defaultPrisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
import { fmt, isoMinute, latest, nameToken, num } from '@/lib/chimmy/tools/statsFormat'

/**
 * REAL-WORLD STATS FOR MLB, NBA AND NHL (Phase 3), read from our own tables.
 *
 * Measured on production 2026-09-24 (read-only), the sources these read:
 *
 *   fantasy_stat_lines  rolling_insights, week 0   MLB 2026 (2,595) · NBA 2025 (591) · NHL 2025 (1,040)
 *   player_game_stats   rolling_insights_live       MLB 2026 68,000 rows through 09-23 · NHL preseason only
 *   SportsDataCache     {MLB,NBA,NHL}:standings:*   ESPN
 *
 * ⚠ NBA / NHL `season` IS THE YEAR THE SEASON STARTED. "2025" is the 2025-26 season — the one
 * that ENDED in spring 2026. Until the 2026-27 season has stats, the newest NBA/NHL rows are last
 * season's, and every builder here says so in words the model cannot turn into "this season".
 *
 * ⚠ UNITS, MEASURED rather than assumed: NBA `minutes` and NHL `time_on_ice` SEASON totals are in
 * SECONDS (Doncic 137,319 over 64 games = 35.8 min/game; McDavid 113,127 over 82 = 23:00). The
 * per-game box carries them as "MM:SS" strings instead. MLB `IP` and `ERA` are provider strings,
 * shown verbatim — "33.1" innings is 33⅓ in baseball notation, not a decimal.
 *
 * ⚠ PRESEASON IS NEVER SHOWN AS A GAME LINE. `/live` returns preseason games beside the regular
 * season; `resolveStoredSeasonType` (lib/sports-data/riSeasonType.ts) is the one rule for which is
 * which, including rows written before the ingest kept the label.
 */

type Db = Pick<typeof defaultPrisma, '$queryRaw'>

export type DailySport = 'MLB' | 'NBA' | 'NHL' | 'NCAAB'

/** The daily sports whose season totals come from Rolling Insights `fantasy_stat_lines`. */
export type RiSeasonSport = Exclude<DailySport, 'NCAAB'>

/**
 * ⚠ NCAAB IS A DAILY SPORT FOR GAME LOGS AND STANDINGS, BUT NOT FOR SEASON TOTALS. Its vendor
 * totals are truncated (GAPS N-14), so season stats and leaders are summed from game logs in
 * collegeBasketballStats.ts. Callers must route NCAAB there BEFORE any `fantasy_stat_lines` path.
 */
export function isDailyStatsSport(sport: string): sport is DailySport {
  return sport === 'MLB' || sport === 'NBA' || sport === 'NHL' || sport === 'NCAAB'
}

/*
 * Openers the STATS tools need that are deliberately NOT in lib/season-week/dailySportSeasonStarts.ts.
 * Recording NCAAB there would switch on fantasy-scoring week resolution for college basketball
 * (seasonWeekService treats any recorded opener as a scoring anchor) — a separate decision. This
 * only drives the "these are last season's numbers" note. Source: the first 2026-27 NCAAB game in
 * SportsGame (2026-11-02), measured 2026-09-24.
 */
const STATS_ONLY_SEASON_STARTS: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  NCAAB: { 2026: '2026-11-02T00:00:00.000Z' },
}

/** "2025" -> "2025-26" for the sports whose season spans two calendar years. */
export function dailySeasonLabel(sport: DailySport, season: string | number): string {
  const y = Number(season)
  if (sport === 'MLB' || !Number.isFinite(y)) return String(season)
  return `${y}-${String(y + 1).slice(2)}`
}

/**
 * When the newest stored NBA/NHL season is the one that already ENDED, say so. Driven by the
 * recorded regular-season start of the NEXT season (lib/season-week/dailySportSeasonStarts.ts):
 * before it, these are last season's numbers; after it, this season's simply are not stored yet.
 */
export function dailyOffSeasonNote(sport: DailySport, season: string | number, now: Date = new Date()): string | null {
  if (sport === 'MLB') return null
  const y = Number(season)
  if (!Number.isFinite(y)) return null
  const start = resolveDailySportSeasonStart(sport, y + 1) ?? STATS_ONLY_SEASON_STARTS[sport]?.[y + 1] ?? null
  if (!start) return null
  const thisLabel = dailySeasonLabel(sport, y)
  const nextLabel = dailySeasonLabel(sport, y + 1)
  if (now.getTime() < new Date(start).getTime()) {
    return `⚠ The ${nextLabel} ${sport} season has not started (it opens ${start.slice(0, 10)}), so these are LAST season's ${thisLabel} numbers. Say "last season", never "this season".`
  }
  return `⚠ NO ${nextLabel} ${sport} NUMBERS ARE STORED YET — these are from ${thisLabel}, NOT this season. Do not present them as current.`
}

// ── Season totals ────────────────────────────────────────────────────────────────────────────

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

function per(total: number | null, games: number | null): string | null {
  if (total == null || games == null || games <= 0) return null
  return (total / games).toFixed(1)
}

/** ".279" — a rate the way baseball and hockey print it. */
function rate3(n: number): string {
  return n.toFixed(3).replace(/^0(?=\.)/, '')
}

function pct(made: number | null, att: number | null): string | null {
  if (made == null || att == null || att <= 0) return null
  return `${((made / att) * 100).toFixed(1)}%`
}

function clock(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function joinParts(parts: Array<string | null | false>): string {
  return parts.filter(Boolean).join(' · ')
}

function labelled(block: Record<string, unknown>, pairs: Array<[string, string]>): string[] {
  const out: string[] = []
  for (const [key, label] of pairs) {
    const raw = block[key]
    if (raw == null || raw === '') continue
    // IP and ERA are provider strings; show them as sent rather than re-rounding.
    out.push(`${label} ${typeof raw === 'string' ? raw : fmt(num(raw) ?? 0)}`)
  }
  return out
}

function mlbSeason(block: Record<string, unknown>): string[] {
  const lines: string[] = []
  const games = num(block.games_played)
  const b = rec(block.batting)
  if (Object.keys(b).length) {
    const ab = num(b.AB)
    const h = num(b.H)
    lines.push(
      `- Batting: ${joinParts([
        games != null && `Games ${fmt(games)}`,
        ...labelled(b, [['AB', 'AB'], ['R', 'R'], ['H', 'H'], ['2B', '2B'], ['3B', '3B'], ['HR', 'HR'], ['RBI', 'RBI'], ['BB', 'BB'], ['SO', 'K'], ['SB', 'SB'], ['CS', 'CS']]),
        ab != null && ab > 0 && h != null && `AVG ${rate3(h / ab)} (H/AB)`,
      ])}`,
    )
  }
  const p = rec(block.pitching)
  if (Object.keys(p).length) {
    const w = num(p.W)
    const l = num(p.L)
    lines.push(
      `- Pitching: ${joinParts([
        games != null && `Games ${fmt(games)}`,
        w != null && l != null && `Record ${fmt(w)}-${fmt(l)}`,
        ...labelled(p, [['S', 'Saves'], ['HLD', 'Holds'], ['IP', 'IP'], ['ERA', 'ERA'], ['K', 'K'], ['BB', 'BB'], ['H', 'H allowed'], ['ER', 'ER'], ['HR', 'HR allowed']]),
      ])}`,
    )
  }
  return lines
}

function nbaSeason(block: Record<string, unknown>): string[] {
  const g = num(block.games_played)
  const stat = (k: string) => num(block[k])
  const withPer = (label: string, k: string) => {
    const t = stat(k)
    if (t == null) return null
    const p = per(t, g)
    return `${label} ${fmt(t)}${p ? ` (${p} per game)` : ''}`
  }
  const secs = stat('minutes')
  return [
    `- ${joinParts([
      g != null && `Games ${fmt(g)}`,
      withPer('Points', 'points'),
      withPer('Rebounds', 'total_rebounds'),
      withPer('Assists', 'assists'),
      withPer('Steals', 'steals'),
      withPer('Blocks', 'blocks'),
      withPer('Turnovers', 'turnovers'),
      stat('three_points_made') != null &&
        `3PM ${fmt(stat('three_points_made') ?? 0)}${stat('three_points_attempted') != null ? ` of ${fmt(stat('three_points_attempted') ?? 0)}` : ''}`,
      pct(stat('field_goals_made'), stat('field_goals_attempted')) && `FG% ${pct(stat('field_goals_made'), stat('field_goals_attempted'))}`,
      pct(stat('free_throws_made'), stat('free_throws_attempted')) && `FT% ${pct(stat('free_throws_made'), stat('free_throws_attempted'))}`,
      // Season `minutes` is SECONDS (see the module header).
      secs != null && g != null && g > 0 && `Minutes ${(secs / 60 / g).toFixed(1)} per game`,
    ])}`,
  ]
}

function nhlSeason(block: Record<string, unknown>): string[] {
  const g = num(block.games_played)
  const stat = (k: string) => num(block[k])
  const toi = stat('time_on_ice')
  const toiPerGame = toi != null && g != null && g > 0 ? `TOI ${clock(toi / g)} per game` : null
  // A goalie's line carries saves / shots against; a skater's does not.
  if (stat('saves') != null || stat('shots_against') != null) {
    const sv = stat('saves')
    const sa = stat('shots_against')
    const ga = stat('goals_allowed')
    return [
      `- ${joinParts([
        g != null && `Games ${fmt(g)}`,
        ...labelled(block, [['win', 'Wins'], ['loss', 'Losses'], ['overtime_loss', 'OT losses'], ['shutouts', 'Shutouts']]),
        sv != null && sa != null && sa > 0 && `Saves ${fmt(sv)} of ${fmt(sa)} (SV% ${rate3(sv / sa)})`,
        ga != null && `Goals against ${fmt(ga)}${toi != null && toi > 0 ? ` (GAA ${((ga * 3600) / toi).toFixed(2)})` : ''}`,
        toiPerGame,
      ])}`,
    ]
  }
  const goals = stat('goals')
  const assists = stat('assists')
  // The feed carries no `*_points` totals — only the goal and assist halves (GAPS, 2026-09-19).
  const sum = (a: string, b: string) => (stat(a) != null || stat(b) != null ? (stat(a) ?? 0) + (stat(b) ?? 0) : null)
  const ppp = sum('power_play_goals', 'power_play_assists')
  const shp = sum('short_handed_goals', 'short_handed_assists')
  return [
    `- ${joinParts([
      g != null && `Games ${fmt(g)}`,
      goals != null && `Goals ${fmt(goals)}`,
      assists != null && `Assists ${fmt(assists)}`,
      goals != null && assists != null && `Points ${fmt(goals + assists)}`,
      ...labelled(block, [['plus_minus', '+/-'], ['shots_on_goal', 'Shots']]),
      ppp != null && `Power-play points ${fmt(ppp)}`,
      shp != null && shp > 0 && `Shorthanded points ${fmt(shp)}`,
      ...labelled(block, [['penalty_minutes', 'PIM'], ['hits', 'Hits'], ['blocks', 'Blocks']]),
      toiPerGame,
    ])}`,
  ]
}

/** Lines for one `regular_season` / `postseason` block. Curated keys only; computed rates say so. */
export function renderDailySeasonBlock(sport: DailySport, block: unknown): string[] {
  const b = rec(block)
  if (!Object.keys(b).length) return []
  if (sport === 'MLB') return mlbSeason(b)
  if (sport === 'NBA') return nbaSeason(b)
  // NCAAB totals are summed from game logs (collegeBasketballStats.ts); a vendor block is never rendered.
  if (sport === 'NCAAB') return []
  return nhlSeason(b)
}

// ── Game log ─────────────────────────────────────────────────────────────────────────────────

type DailyGameRow = {
  gameId: string
  providerGameId: string | null
  season: number | null
  team: string | null
  opponent: string | null
  gameDate: Date | null
  map: unknown
  payload: unknown
}

function mlbBattingGame(s: Record<string, unknown>): string | null {
  const ab = num(s.AB)
  const h = num(s.H)
  const extras: string[] = []
  for (const [k, label] of [['HR', 'HR'], ['2B', '2B'], ['3B', '3B'], ['R', 'R'], ['RBI', 'RBI'], ['BB', 'BB'], ['SO', 'K'], ['SB', 'SB']] as const) {
    const n = num(s[k])
    if (n) extras.push(`${fmt(n)} ${label}`)
  }
  if (ab == null && !extras.length) return null
  return `Batting ${[ab != null && h != null ? `${fmt(h)}-for-${fmt(ab)}` : null, ...extras].filter(Boolean).join(', ')}`
}

function mlbPitchingGame(s: Record<string, unknown>, payload: Record<string, unknown>): string | null {
  // IP from the verbatim payload when it is a string ("5.2"); the flattened map has a number.
  const ip = typeof payload.IP === 'string' ? payload.IP : num(s.IP) != null ? fmt(num(s.IP) ?? 0) : null
  const parts: string[] = []
  if (ip != null) parts.push(`${ip} IP`)
  for (const [k, label] of [['H', 'H'], ['ER', 'ER'], ['BB', 'BB'], ['K', 'K'], ['HR', 'HR']] as const) {
    const n = num(s[k])
    if (n != null) parts.push(`${fmt(n)} ${label}`)
  }
  const decision = num(s.W) ? 'W' : num(s.L) ? 'L' : num(s.S) ? 'SV' : num(s.HLD) ? 'HLD' : num(s.BS) ? 'BS' : null
  if (decision) parts.push(decision)
  return parts.length ? `Pitching ${parts.join(', ')}` : null
}

function nbaGame(s: Record<string, unknown>, payload: Record<string, unknown>): string | null {
  const parts: string[] = []
  for (const [k, label] of [['points', 'pts'], ['total_rebounds', 'reb'], ['assists', 'ast'], ['steals', 'stl'], ['blocks', 'blk'], ['turnovers', 'TO']] as const) {
    const n = num(s[k])
    if (n != null) parts.push(`${fmt(n)} ${label}`)
  }
  const fgm = num(s.field_goals_made)
  const fga = num(s.field_goals_attempted)
  if (fgm != null && fga != null) parts.push(`${fmt(fgm)}/${fmt(fga)} FG`)
  const tpm = num(s.three_points_made)
  if (tpm) parts.push(`${fmt(tpm)} 3PM`)
  if (typeof payload.minutes === 'string' && payload.minutes.trim()) parts.push(`${payload.minutes.trim()} min`)
  return parts.length ? parts.join(', ') : null
}

function nhlGame(group: string, s: Record<string, unknown>, payload: Record<string, unknown>): string | null {
  const toi = typeof payload.time_on_ice === 'string' && /[1-9]/.test(payload.time_on_ice) ? `${payload.time_on_ice} TOI` : null
  if (group === 'goalies') {
    const sv = num(s.saves)
    const sa = num(s.shots_against)
    const parts: string[] = []
    if (sv != null && sa != null) parts.push(`${fmt(sv)} saves on ${fmt(sa)} shots`)
    const ga = num(s.goals_allowed)
    if (ga != null) parts.push(`${fmt(ga)} GA`)
    const decision = num(s.win) ? 'W' : num(s.loss) ? 'L' : num(s.overtime_loss) ? 'OTL' : null
    if (decision) parts.push(decision)
    if (num(s.shutouts)) parts.push('shutout')
    if (toi) parts.push(toi)
    return parts.length ? `Goalie ${parts.join(', ')}` : null
  }
  const parts: string[] = []
  const g = num(s.goals) ?? 0
  const a = num(s.assists) ?? 0
  parts.push(`${fmt(g)} G, ${fmt(a)} A`)
  const pm = num(s.plus_minus)
  if (pm != null) parts.push(`${pm > 0 ? '+' : ''}${fmt(pm)}`)
  for (const [k, label] of [['shots_on_goal', 'SOG'], ['hits', 'hits'], ['blocks', 'blocks'], ['penalty_minutes', 'PIM']] as const) {
    const n = num(s[k])
    if (n) parts.push(`${fmt(n)} ${label}`)
  }
  const ppp = (num(s.power_play_goals) ?? 0) + (num(s.power_play_assists) ?? 0)
  if (ppp) parts.push(`${fmt(ppp)} PPP`)
  if (toi) parts.push(toi)
  return parts.join(', ')
}

function renderGameGroup(sport: DailySport, row: DailyGameRow): string | null {
  const map = rec(row.map)
  const stats = rec(map.stats)
  const payload = rec(row.payload)
  const group = String(map.group ?? row.gameId.split(':')[1] ?? 'all')
  if (sport === 'MLB') return group === 'pitching' ? mlbPitchingGame(stats, payload) : mlbBattingGame(stats)
  // NCAAB's box has NBA's shape (fixtures/live.NCAABB.json); its minutes arrive as "20", not "MM:SS".
  if (sport === 'NBA' || sport === 'NCAAB') return nbaGame(stats, payload)
  return nhlGame(group, stats, payload)
}

export async function buildDailyGameLogContext(
  sport: DailySport,
  args: { playerName: string; season?: unknown; lastN?: unknown },
  db: Db,
): Promise<string> {
  const asked = String(args.playerName ?? '').trim()
  const token = nameToken(asked)
  if (token.length < 2) return `"${asked}" is not a name I can search for. Ask for the player's full name.`

  /*
   * player_game_stats keys these rows on PlayerIdentityMap.id (the RI ingest resolves the provider
   * id through `rollingInsightsId`), so the registry row IS the key. Matched exactly in JS with the
   * app's own normalizer — never the stored normalizedName column.
   */
  const candidates = await db.$queryRaw<Array<{ id: string; canonicalName: string; position: string | null; currentTeam: string | null }>>(Prisma.sql`
    SELECT id, "canonicalName", position, "currentTeam"
    FROM "PlayerIdentityMap"
    WHERE sport = ${sport} AND "rollingInsightsId" IS NOT NULL AND "canonicalName" ILIKE ${`%${token}%`}
    LIMIT 60`)
  const target = normalizePlayerName(asked)
  let players = candidates.filter((c) => normalizePlayerName(c.canonicalName) === target)
  if (players.length === 0) {
    const near = [...new Set(candidates.map((c) => c.canonicalName))].slice(0, 5)
    return [
      `No ${sport} player named "${asked}" is in AllFantasy's player registry.`,
      near.length ? `Similar names: ${near.join(', ')}. Ask which one they mean.` : '',
      'Do not give a game line from memory.',
    ]
      .filter(Boolean)
      .join(' ')
  }
  if (players.length > 1) {
    /* 69 MLB names are shared by two registry rows (measured 2026-09-24) — usually a retired
     * namesake. Keep only the ones with games on file before asking the user to choose. */
    const ids = players.map((p) => p.id)
    const withGames = await db.$queryRaw<Array<{ playerId: string }>>(Prisma.sql`
      SELECT DISTINCT "playerId" FROM player_game_stats
      WHERE "sportType" = ${sport} AND "playerId" IN (${Prisma.join(ids)})`)
    const active = new Set(withGames.map((r) => r.playerId))
    const narrowed = players.filter((p) => active.has(p.id))
    if (narrowed.length !== 1) {
      const pool = narrowed.length ? narrowed : players
      return `${pool.length} ${sport} players are named "${asked}" (${pool.map((p) => `${p.position ?? '?'} ${p.currentTeam ?? 'FA'}`).join('; ')}). Ask which one they mean rather than picking.`
    }
    players = narrowed
  }
  const player = players[0]

  const requestedSeason = typeof args.season === 'number' && Number.isFinite(args.season) ? Math.floor(args.season) : null
  const lastN = Math.min(10, Math.max(1, typeof args.lastN === 'number' && Number.isFinite(args.lastN) ? Math.floor(args.lastN) : 5))

  const [rows, sportLatestRows] = await Promise.all([
    db.$queryRaw<DailyGameRow[]>(Prisma.sql`
      SELECT "gameId", provider_game_id AS "providerGameId", season, team, opponent, game_date AS "gameDate",
             normalized_stat_map AS map, stat_payload AS payload
      FROM player_game_stats
      WHERE "sportType" = ${sport} AND "playerId" = ${player.id}
        ${requestedSeason != null ? Prisma.sql`AND season = ${requestedSeason}` : Prisma.empty}
      ORDER BY game_date DESC NULLS LAST, "gameId" ASC
      LIMIT ${lastN * 2 + 40}`),
    db.$queryRaw<Array<{ latest: Date | null }>>(Prisma.sql`
      SELECT max(game_date) AS latest FROM player_game_stats WHERE "sportType" = ${sport}`),
  ])

  // Preseason never counts as a game line; one game can hold two rows (MLB batting + pitching).
  let preseason = 0
  const games: Array<{ key: string; rows: DailyGameRow[]; post: boolean }> = []
  const byKey = new Map<string, { key: string; rows: DailyGameRow[]; post: boolean }>()
  for (const r of rows) {
    const type = resolveStoredSeasonType({ normalizedStatMap: r.map, sport, season: r.season, gameDate: r.gameDate })
    if (type === 'pre') {
      preseason += 1
      continue
    }
    const key = r.providerGameId ?? r.gameId.split(':')[0]
    let game = byKey.get(key)
    if (!game) {
      if (games.length >= lastN) continue
      game = { key, rows: [], post: false }
      byKey.set(key, game)
      games.push(game)
    }
    game.rows.push(r)
    if (type === 'post') game.post = true
  }

  const header = `${player.canonicalName} (${player.position ?? '?'}, ${player.currentTeam ?? 'FA'}) — ${sport} per-game box-score lines from Rolling Insights, newest first:`
  if (games.length === 0) {
    return [
      header,
      `- No ${requestedSeason != null ? `${dailySeasonLabel(sport, requestedSeason)} ` : ''}regular-season or playoff game lines are stored for him.${preseason ? ` (${preseason} preseason line(s) are stored and deliberately not shown — preseason is not the season.)` : ''} Do NOT report zeros or give lines from memory; offer his season totals (get_player_season_stats) instead.`,
    ].join('\n')
  }

  const lines: string[] = []
  const newest = latest(games[0].rows.map((r) => r.gameDate))
  const sportLatest = sportLatestRows[0]?.latest ?? null
  if (requestedSeason == null && newest && sportLatest && new Date(sportLatest).getTime() - newest.getTime() > 3 * 86_400_000) {
    /* Measured: Aaron Judge's 2026 lines stop in May and resume in September. His "last game" is
     * whatever the newest row is — which is not "last night" when the league has played since. */
    lines.push(
      `⚠ His newest stored game is ${newest.toISOString().slice(0, 10)}, while ${sport} box scores are stored through ${new Date(sportLatest).toISOString().slice(0, 10)}. He has not appeared in a stored game since — this data cannot say why. Do NOT call it "last night" or his latest game without that caveat.`,
    )
  }
  lines.push(header)
  for (const g of games) {
    const first = g.rows[0]
    const date = first.gameDate ? new Date(first.gameDate).toISOString().slice(0, 10) : 'date unknown'
    // Pitching before batting reads oddly; keep the provider group order stable: batting first.
    const sorted = [...g.rows].sort((a, b) => a.gameId.localeCompare(b.gameId))
    const body = sorted.map((r) => renderGameGroup(sport, r)).filter(Boolean).join(' · ')
    lines.push(`- ${date}${first.opponent ? ` vs ${first.opponent}` : ''}${g.post ? ' (postseason)' : ''}: ${body || 'appeared, no counting stats'}`)
  }
  lines.push(
    `A date missing from this list is a game he did not appear in or that was not imported — never a zero.${preseason ? ' Preseason games are excluded.' : ''} These are real box scores, not fantasy points.`,
  )
  return lines.join('\n')
}

// ── Season leaders ───────────────────────────────────────────────────────────────────────────

type Parts = Record<string, readonly string[]>

type DailyLeaderSpec = {
  label: string
  /** Paths under `regular_season`. Constants only — these are the ONLY keys that reach SQL. */
  parts: Parts
  value: (p: Record<string, number | null>) => number | null
  asc?: boolean
  format?: 'int' | 'rate3' | 'dec2' | 'dec1'
  /** Minimum `part` of `perGame` × the most games anyone has played, so it scales through a season. */
  qualify?: { part: string; perGame: number; unit: string }
}

const total = (path: readonly string[]): Pick<DailyLeaderSpec, 'parts' | 'value'> => ({
  parts: { v: path },
  value: (p) => p.v,
})

const G = ['games_played'] as const

export const DAILY_LEADER_STATS: Record<RiSeasonSport, Record<string, DailyLeaderSpec>> = {
  MLB: {
    home_runs: { label: 'home runs', ...total(['batting', 'HR']) },
    rbi: { label: 'RBI', ...total(['batting', 'RBI']) },
    runs: { label: 'runs', ...total(['batting', 'R']) },
    hits: { label: 'hits', ...total(['batting', 'H']) },
    stolen_bases: { label: 'stolen bases', ...total(['batting', 'SB']) },
    batting_average: {
      label: 'batting average',
      parts: { h: ['batting', 'H'], ab: ['batting', 'AB'] },
      value: (p) => (p.h != null && p.ab ? p.h / p.ab : null),
      format: 'rate3',
      qualify: { part: 'ab', perGame: 3, unit: 'at-bats' },
    },
    strikeouts: { label: 'strikeouts (pitching)', ...total(['pitching', 'K']) },
    wins: { label: 'wins (pitching)', ...total(['pitching', 'W']) },
    saves: { label: 'saves', ...total(['pitching', 'S']) },
    era: {
      label: 'ERA',
      parts: { era: ['pitching', 'ERA'], ip: ['pitching', 'IP'] },
      value: (p) => p.era,
      asc: true,
      format: 'dec2',
      qualify: { part: 'ip', perGame: 1, unit: 'innings' },
    },
  },
  NBA: {
    points: { label: 'points', ...total(['points']) },
    rebounds: { label: 'rebounds', ...total(['total_rebounds']) },
    assists: { label: 'assists', ...total(['assists']) },
    steals: { label: 'steals', ...total(['steals']) },
    blocks: { label: 'blocks', ...total(['blocks']) },
    three_pointers_made: { label: 'three-pointers made', ...total(['three_points_made']) },
    points_per_game: {
      label: 'points per game',
      parts: { t: ['points'], g: G },
      value: (p) => (p.t != null && p.g ? p.t / p.g : null),
      format: 'dec1',
      qualify: { part: 'g', perGame: 0.7, unit: 'games' },
    },
    rebounds_per_game: {
      label: 'rebounds per game',
      parts: { t: ['total_rebounds'], g: G },
      value: (p) => (p.t != null && p.g ? p.t / p.g : null),
      format: 'dec1',
      qualify: { part: 'g', perGame: 0.7, unit: 'games' },
    },
    assists_per_game: {
      label: 'assists per game',
      parts: { t: ['assists'], g: G },
      value: (p) => (p.t != null && p.g ? p.t / p.g : null),
      format: 'dec1',
      qualify: { part: 'g', perGame: 0.7, unit: 'games' },
    },
  },
  NHL: {
    goals: { label: 'goals', ...total(['goals']) },
    assists: { label: 'assists', ...total(['assists']) },
    points: {
      label: 'points',
      parts: { g: ['goals'], a: ['assists'] },
      value: (p) => (p.g != null && p.a != null ? p.g + p.a : null),
    },
    plus_minus: { label: 'plus/minus', ...total(['plus_minus']) },
    shots: { label: 'shots on goal', ...total(['shots_on_goal']) },
    power_play_points: {
      label: 'power-play points',
      parts: { g: ['power_play_goals'], a: ['power_play_assists'] },
      value: (p) => (p.g != null || p.a != null ? (p.g ?? 0) + (p.a ?? 0) : null),
    },
    penalty_minutes: { label: 'penalty minutes', ...total(['penalty_minutes']) },
    hits: { label: 'hits', ...total(['hits']) },
    wins: { label: 'goalie wins', ...total(['win']) },
    shutouts: { label: 'shutouts', ...total(['shutouts']) },
    save_percentage: {
      label: 'save percentage',
      parts: { sv: ['saves'], sa: ['shots_against'], g: G },
      value: (p) => (p.sv != null && p.sa ? p.sv / p.sa : null),
      format: 'rate3',
      qualify: { part: 'g', perGame: 0.3, unit: 'games' },
    },
    goals_against_average: {
      label: 'goals-against average',
      parts: { ga: ['goals_allowed'], toi: ['time_on_ice'], g: G },
      // time_on_ice is SECONDS (module header), so GAA is per 60 minutes = 3,600 s.
      value: (p) => (p.ga != null && p.toi ? (p.ga * 3600) / p.toi : null),
      asc: true,
      format: 'dec2',
      qualify: { part: 'g', perGame: 0.3, unit: 'games' },
    },
  },
}

const LEADER_ALIASES: Record<string, string> = {
  hr: 'home_runs',
  homers: 'home_runs',
  homeruns: 'home_runs',
  rbis: 'rbi',
  sb: 'stolen_bases',
  steals_bases: 'stolen_bases',
  avg: 'batting_average',
  average: 'batting_average',
  k: 'strikeouts',
  ks: 'strikeouts',
  ppg: 'points_per_game',
  rpg: 'rebounds_per_game',
  apg: 'assists_per_game',
  threes: 'three_pointers_made',
  '3pm': 'three_pointers_made',
  sv_pct: 'save_percentage',
  'sv%': 'save_percentage',
  gaa: 'goals_against_average',
  pim: 'penalty_minutes',
  ppp: 'power_play_points',
}

function formatValue(n: number, format: DailyLeaderSpec['format']): string {
  if (format === 'rate3') return rate3(n)
  if (format === 'dec2') return n.toFixed(2)
  if (format === 'dec1') return n.toFixed(1)
  return fmt(n)
}

export async function buildDailySeasonLeadersContext(
  sport: RiSeasonSport,
  args: { stat: unknown; season: string; limit: number; now?: Date },
  db: Db,
): Promise<string> {
  const raw = String(args.stat ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const key = DAILY_LEADER_STATS[sport][raw] ? raw : LEADER_ALIASES[raw] ?? raw
  const spec = DAILY_LEADER_STATS[sport][key]
  if (!spec) {
    return `"${raw}" is not a ${sport} stat I can rank. Available: ${Object.keys(DAILY_LEADER_STATS[sport]).join(', ')}. Do not produce a leaderboard from memory.`
  }

  const names = Object.keys(spec.parts)
  const cols = names.map(
    (n, i) => Prisma.sql`stats #>> ${['regular_season', ...spec.parts[n]]}::text[] AS ${Prisma.raw(`"p${i}"`)}`,
  )
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT stats ->> 'riPlayerName' AS name, coalesce(stats ->> 'riTeam', team) AS team,
           stats ->> 'position' AS position, stats #>> '{regular_season,games_played}' AS games,
           fetched_at AS "fetchedAt", ${Prisma.join(cols)}
    FROM fantasy_stat_lines
    WHERE sport = ${sport} AND source = 'rolling_insights' AND week = 0 AND season = ${args.season}`)

  const maxGames = rows.reduce((m, r) => Math.max(m, num(r.games) ?? 0), 0)
  const minQual = spec.qualify ? Math.ceil(spec.qualify.perGame * maxGames) : 0
  const ranked = rows
    .map((r) => {
      const p: Record<string, number | null> = {}
      names.forEach((n, i) => {
        p[n] = num(r[`p${i}`])
      })
      return { r, p, v: spec.value(p) }
    })
    .filter((x) => x.v != null && Number.isFinite(x.v))
    .filter((x) => !spec.qualify || (x.p[spec.qualify.part] ?? 0) >= minQual)
    .sort((a, b) => (spec.asc ? (a.v as number) - (b.v as number) : (b.v as number) - (a.v as number)) || String(a.r.name).localeCompare(String(b.r.name)))
    .slice(0, args.limit)

  const seasonText = dailySeasonLabel(sport, args.season)
  if (ranked.length === 0) {
    return `No ${sport} ${seasonText} player has a recorded ${spec.label}${spec.qualify ? ` with at least ${minQual} ${spec.qualify.unit}` : ''} yet. Say so; do not name leaders from memory.`
  }
  const asOf = latest(ranked.map((x) => x.r.fetchedAt as Date | null))
  const note = dailyOffSeasonNote(sport, args.season, args.now)
  return [
    ...(note ? [note] : []),
    `${sport} ${seasonText} regular-season leaders in ${spec.label}, from Rolling Insights season totals (refreshed ${isoMinute(asOf) ?? 'at an unknown time'})${spec.qualify ? ` — minimum ${minQual} ${spec.qualify.unit}, i.e. ${spec.qualify.perGame} per game of the most games played (${maxGames})` : ''}:`,
    ...ranked.map((x, i) => {
      const g = num(x.r.games)
      return `${i + 1}. ${x.r.name ?? 'Unknown'} (${x.r.position ?? '?'}${x.r.team ? `, ${x.r.team}` : ''}) — ${formatValue(x.v as number, spec.format)}${g != null ? ` in ${fmt(g)} games` : ''}`
    }),
    spec.qualify
      ? 'The minimum is AllFantasy\'s own cutoff to keep small samples out, not the league\'s official qualifier — say so if the user asks about the official title race.'
      : 'Season-to-date totals through the provider\'s last refresh.',
  ].join('\n')
}
