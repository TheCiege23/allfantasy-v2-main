import 'server-only'

import { Prisma } from '@prisma/client'
import type { prisma as defaultPrisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { fmt, nameToken, num } from '@/lib/chimmy/tools/statsFormat'
import { dailyOffSeasonNote, dailySeasonLabel } from '@/lib/chimmy/tools/dailySportStats'

/**
 * COLLEGE BASKETBALL (NCAAB) SEASON STATS — SUMMED FROM OUR OWN GAME LOGS, NEVER THE VENDOR TOTALS.
 *
 * 🛑 `fantasy_stat_lines` NCAAB season totals are TRUNCATED at the vendor (GAPS N-14): measured
 * 2026-09-24, the median team's most-played player has 11 games against 32 in ESPN's standings —
 * Duke went 32-2 and Cameron Boozer shows 12 GP. Nothing in this module reads that table.
 *
 * The 2025-26 game logs were backfilled into `player_game_stats` on 2026-09-24 (110,640 lines,
 * 5,728 games) and the daily Rolling Insights sweep keeps them current, so totals are summed at
 * READ time. No summary table and so no writer to schedule — the failure CLAUDE.md records for
 * `ingestCFBDStats`, where a table nothing refreshed looked correct while going stale. Measured
 * cost: 12 ms for one player, ~0.8 s for the league-wide leaders aggregate.
 *
 * WHAT A "SEASON" INCLUDES — the owner's decision (2026-09-24): conference tournaments count.
 * Rolling Insights labels conference tournaments, the NCAA Tournament and the NIT all
 * "Postseason", and the game-level `event_name` that would tell them apart is not stored on the
 * player rows. So a season here is EVERY game — which is also how college basketball's official
 * season statistics are kept — and each answer says how many postseason games it includes.
 * Preseason/exhibition rows are excluded.
 *
 * ⚠ THE VENDOR'S BOX CAN OMIT PLAYERS (GAPS N-15): 240 of 11,455 team sides (2.1%) sum under 40
 * points. Totals can therefore run slightly LOW, and every answer says so.
 *
 * ⚠ NCAAB has exactly ONE row per player per game (no batting/pitching-style groups — measured: 0
 * grouped game ids), so `count(*)` is the game count; `count(DISTINCT …)` forced a disk sort.
 */

type Db = Pick<typeof defaultPrisma, '$queryRaw'>

/** Excludes preseason; unlabelled rows predate the season_type ingest and are regular/post. */
const NOT_PRESEASON = Prisma.sql`coalesce(normalized_stat_map ->> 'seasonType', '') <> 'pre'`

/** The summed columns. Keys are constants — the only identifiers that reach SQL. */
const SUMS = [
  'points', 'total_rebounds', 'offensive_rebounds', 'defensive_rebounds', 'assists', 'steals', 'blocks',
  'turnovers', 'fouls', 'minutes', 'field_goals_made', 'field_goals_attempted',
  'three_points_made', 'three_points_attempted', 'free_throws_made', 'free_throws_attempted',
] as const
type SumKey = (typeof SUMS)[number]

const sumColumns = Prisma.join(
  // ::float8, not numeric: Prisma returns a numeric SUM as a Decimal OBJECT, which num() cannot read —
  // every total came back empty against production until this cast (measured 2026-09-24).
  SUMS.map((k) => Prisma.sql`sum((normalized_stat_map -> 'stats' ->> ${k})::numeric)::float8 AS ${Prisma.raw(`"${k}"`)}`),
)

type Totals = Record<SumKey, unknown> & { games: number; postGames: number }

const CAVEAT =
  'Summed from per-game box scores, counting every game — regular season, conference tournaments and the NCAA Tournament/NIT, as college season stats are kept. A few provider box scores are incomplete, so totals can run slightly low.'

async function newestSeason(db: Db): Promise<number | null> {
  const rows = await db.$queryRaw<Array<{ season: number | null }>>(Prisma.sql`
    SELECT max(season) AS season FROM player_game_stats WHERE "sportType" = 'NCAAB'`)
  return rows[0]?.season ?? null
}

function perGame(total: number | null, games: number): string | null {
  return total == null || games <= 0 ? null : (total / games).toFixed(1)
}

function pctOf(made: number | null, att: number | null): string | null {
  return made == null || att == null || att <= 0 ? null : `${((made / att) * 100).toFixed(1)}%`
}

export function renderNcaabTotals(t: Totals): string {
  const g = t.games
  const v = (k: SumKey) => num(t[k])
  const withPer = (label: string, k: SumKey) => {
    const n = v(k)
    return n == null ? null : `${label} ${fmt(n)} (${perGame(n, g)} per game)`
  }
  const parts = [
    `Games ${g}${t.postGames ? ` (incl. ${t.postGames} postseason)` : ''}`,
    withPer('Points', 'points'),
    withPer('Rebounds', 'total_rebounds'),
    withPer('Assists', 'assists'),
    withPer('Steals', 'steals'),
    withPer('Blocks', 'blocks'),
    withPer('Turnovers', 'turnovers'),
    v('three_points_made') != null ? `3PM ${fmt(v('three_points_made') ?? 0)} of ${fmt(v('three_points_attempted') ?? 0)}` : null,
    pctOf(v('field_goals_made'), v('field_goals_attempted')) ? `FG% ${pctOf(v('field_goals_made'), v('field_goals_attempted'))}` : null,
    pctOf(v('free_throws_made'), v('free_throws_attempted')) ? `FT% ${pctOf(v('free_throws_made'), v('free_throws_attempted'))}` : null,
    // Box-score `minutes` is whole MINUTES for NCAAB ("20"), unlike NBA season totals (seconds).
    v('minutes') ? `Minutes ${perGame(v('minutes'), g)} per game` : null,
  ]
  return `- ${parts.filter(Boolean).join(' · ')}`
}

export async function buildNcaabSeasonStatsContext(
  args: { playerName: string; season?: unknown; now?: Date },
  db: Db,
): Promise<string> {
  const asked = String(args.playerName ?? '').trim()
  const token = nameToken(asked)
  if (token.length < 2) return `"${asked}" is not a name I can search for. Ask for the player's full name.`

  const season =
    typeof args.season === 'number' && Number.isFinite(args.season) ? Math.floor(args.season) : await newestSeason(db)
  if (season == null) {
    return 'NO college basketball game logs are stored, so no season stats can be summed. Say so; do not give numbers from memory.'
  }

  const candidates = await db.$queryRaw<Array<{ id: string; canonicalName: string; position: string | null; currentTeam: string | null }>>(Prisma.sql`
    SELECT id, "canonicalName", position, "currentTeam" FROM "PlayerIdentityMap"
    WHERE sport = 'NCAAB' AND "rollingInsightsId" IS NOT NULL AND "canonicalName" ILIKE ${`%${token}%`}
    LIMIT 60`)
  const target = normalizePlayerName(asked)
  const named = candidates.filter((c) => normalizePlayerName(c.canonicalName) === target)
  if (named.length === 0) {
    const near = [...new Set(candidates.map((c) => c.canonicalName))].slice(0, 5)
    return [
      `No college basketball player named "${asked}" is in AllFantasy's player registry.`,
      near.length ? `Similar names: ${near.join(', ')}. Ask which one they mean.` : '',
      'Do not give numbers from memory.',
    ].filter(Boolean).join(' ')
  }

  const rows = await db.$queryRaw<Array<Totals & { playerId: string }>>(Prisma.sql`
    SELECT "playerId", count(*)::int AS games,
           count(*) FILTER (WHERE normalized_stat_map ->> 'seasonType' = 'post')::int AS "postGames",
           ${sumColumns}
    FROM player_game_stats
    WHERE "sportType" = 'NCAAB' AND season = ${season} AND ${NOT_PRESEASON}
      AND "playerId" IN (${Prisma.join(named.map((n) => n.id))})
    GROUP BY "playerId"`)

  const seasonText = dailySeasonLabel('NCAAB', season)
  if (rows.length === 0) {
    return `No ${seasonText} college basketball games are stored for ${named[0].canonicalName}. That can mean he did not play or was not in any stored box score — do NOT report zeros or numbers from memory.`
  }
  if (rows.length > 1) {
    const byId = new Map(named.map((n) => [n.id, n]))
    return `${rows.length} college players named "${asked}" played in ${seasonText} (${rows.map((r) => `${byId.get(r.playerId)?.position ?? '?'}, ${byId.get(r.playerId)?.currentTeam ?? '?'}`).join('; ')}). Ask which one they mean rather than picking.`
  }

  const player = named.find((n) => n.id === rows[0].playerId)!
  const note = args.season == null ? dailyOffSeasonNote('NCAAB', season, args.now) : null
  return [
    ...(note ? [note] : []),
    `${player.canonicalName}${player.position ? `, ${player.position}` : ''}${player.currentTeam ? `, ${player.currentTeam}` : ''} — NCAAB ${seasonText} season:`,
    renderNcaabTotals(rows[0]),
    CAVEAT,
  ].join('\n')
}

// ── Leaders ──────────────────────────────────────────────────────────────────────────────────

type LeaderSpec = { label: string; key: SumKey; perGame?: boolean }

export const NCAAB_LEADER_STATS: Record<string, LeaderSpec> = {
  points: { label: 'points', key: 'points' },
  rebounds: { label: 'rebounds', key: 'total_rebounds' },
  assists: { label: 'assists', key: 'assists' },
  steals: { label: 'steals', key: 'steals' },
  blocks: { label: 'blocks', key: 'blocks' },
  three_pointers_made: { label: 'three-pointers made', key: 'three_points_made' },
  points_per_game: { label: 'points per game', key: 'points', perGame: true },
  rebounds_per_game: { label: 'rebounds per game', key: 'total_rebounds', perGame: true },
  assists_per_game: { label: 'assists per game', key: 'assists', perGame: true },
}

const ALIASES: Record<string, string> = {
  ppg: 'points_per_game', rpg: 'rebounds_per_game', apg: 'assists_per_game', scoring: 'points_per_game',
  threes: 'three_pointers_made', '3pm': 'three_pointers_made', reb: 'rebounds', ast: 'assists',
}

/** A per-game leader must have played this share of the most games anyone played (NCAA uses 75% of team games). */
const PER_GAME_SHARE = 0.6

export async function buildNcaabLeadersContext(
  args: { stat: unknown; season?: unknown; limit?: unknown; now?: Date },
  db: Db,
): Promise<string> {
  const raw = String(args.stat ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const key = NCAAB_LEADER_STATS[raw] ? raw : ALIASES[raw] ?? raw
  const spec = NCAAB_LEADER_STATS[key]
  if (!spec) {
    return `"${raw}" is not a college basketball stat I can rank. Available: ${Object.keys(NCAAB_LEADER_STATS).join(', ')}. Do not produce a leaderboard from memory.`
  }
  const season =
    typeof args.season === 'number' && Number.isFinite(args.season) ? Math.floor(args.season) : await newestSeason(db)
  if (season == null) return 'NO college basketball game logs are stored, so no leaderboard can be built. Say so.'
  const limit = Math.min(10, Math.max(1, typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : 5))

  const rows = await db.$queryRaw<Array<{ playerId: string; games: number; total: unknown }>>(Prisma.sql`
    SELECT "playerId", count(*)::int AS games,
           sum((normalized_stat_map -> 'stats' ->> ${spec.key})::numeric)::float8 AS total
    FROM player_game_stats
    WHERE "sportType" = 'NCAAB' AND season = ${season} AND ${NOT_PRESEASON}
    GROUP BY "playerId"`)

  const maxGames = rows.reduce((m, r) => Math.max(m, r.games), 0)
  const minGames = spec.perGame ? Math.ceil(PER_GAME_SHARE * maxGames) : 0
  const ranked = rows
    .map((r) => {
      const t = num(r.total)
      return { r, v: t == null ? null : spec.perGame ? t / r.games : t }
    })
    .filter((x): x is { r: (typeof rows)[number]; v: number } => x.v != null && x.r.games >= minGames)
    .sort((a, b) => b.v - a.v || a.r.playerId.localeCompare(b.r.playerId))
    .slice(0, limit)

  const seasonText = dailySeasonLabel('NCAAB', season)
  if (ranked.length === 0) return `No ${seasonText} college basketball player has a recorded ${spec.label} yet. Say so; do not name leaders from memory.`

  const names = await db.$queryRaw<Array<{ id: string; canonicalName: string; position: string | null; currentTeam: string | null }>>(Prisma.sql`
    SELECT id, "canonicalName", position, "currentTeam" FROM "PlayerIdentityMap"
    WHERE id IN (${Prisma.join(ranked.map((x) => x.r.playerId))})`)
  const byId = new Map(names.map((n) => [n.id, n]))
  const note = args.season == null ? dailyOffSeasonNote('NCAAB', season, args.now) : null

  return [
    ...(note ? [note] : []),
    `NCAAB ${seasonText} leaders in ${spec.label}, summed from per-game box scores${spec.perGame ? ` — minimum ${minGames} games (${PER_GAME_SHARE * 100}% of the most anyone played, ${maxGames}; AllFantasy's cutoff, not the NCAA's official qualifier)` : ''}:`,
    ...ranked.map((x, i) => {
      const n = byId.get(x.r.playerId)
      return `${i + 1}. ${n?.canonicalName ?? 'Unknown'} (${n?.position ?? '?'}${n?.currentTeam ? `, ${n.currentTeam}` : ''}) — ${spec.perGame ? x.v.toFixed(1) : fmt(x.v)} in ${x.r.games} games`
    }),
    CAVEAT,
  ].join('\n')
}
