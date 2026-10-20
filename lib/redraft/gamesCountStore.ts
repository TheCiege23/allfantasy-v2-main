import { prisma } from '@/lib/prisma'

import { dayKey } from './dailyLineups'
import {
  compareGamesChronologically,
  readGamesCountSetting,
  selectCountingGames,
  type GamesCountChoice,
  type GamesCountSetting,
  type WeekGame,
} from './gamesCount'

/**
 * The storage half of "which games count" (lib/redraft/gamesCount.ts): per-game stat rows written by the
 * weekly stat sync, and the managers' picks / lock-ins.
 *
 * 🛑 CALL NOTHING HERE FOR A LEAGUE WHOSE SETTING IS `all`. Both tables arrive with migration
 * `20261020180000_games_count_setting`; querying a table production lacks raises P2021. Every caller
 * gates on `readGamesCountSetting(...).mode !== 'all'` first, which no league satisfies until a
 * commissioner opts in.
 *
 * ⚠ The two delegates are reached through a narrow structural type rather than the generated client's,
 * so this compiles whether or not the local Prisma client has been regenerated since the migration.
 */

export type StoredWeekGame = {
  gameId: string
  day: string
  startTime: string | null
  stats: Record<string, number>
}

type WeekGameRow = {
  playerId: string
  gameId: string
  gameDay: Date
  startTime: Date | null
  stats: unknown
}

type ChoiceRow = {
  playerId: string
  pickedGameIds: string[] | null
  lockedGameId: string | null
  lockedAt?: Date | null
}

export type GamesCountDb = {
  playerWeekGameScore: {
    findMany(args: unknown): Promise<WeekGameRow[]>
    upsert(args: unknown): Promise<unknown>
    deleteMany(args: unknown): Promise<{ count: number }>
  }
  redraftGamesCountChoice: {
    findMany(args: unknown): Promise<ChoiceRow[]>
    findUnique(args: unknown): Promise<ChoiceRow | null>
    upsert(args: unknown): Promise<ChoiceRow>
  }
}

export function gamesCountDb(client: unknown = prisma): GamesCountDb {
  return client as GamesCountDb
}

/** playerId → that player's games this week, chronological. */
export async function loadWeekGameScores(
  db: GamesCountDb,
  args: { playerIds: readonly string[]; sport: string; season: number; week: number },
): Promise<Map<string, StoredWeekGame[]>> {
  const out = new Map<string, StoredWeekGame[]>()
  if (args.playerIds.length === 0) return out
  const rows = await db.playerWeekGameScore.findMany({
    where: { playerId: { in: [...args.playerIds] }, sport: args.sport, season: args.season, week: args.week },
    select: { playerId: true, gameId: true, gameDay: true, startTime: true, stats: true },
  })
  for (const r of rows) {
    const list = out.get(r.playerId) ?? []
    list.push({
      gameId: r.gameId,
      day: dayKey(r.gameDay),
      startTime: r.startTime ? r.startTime.toISOString() : null,
      stats: (r.stats ?? {}) as Record<string, number>,
    })
    out.set(r.playerId, list)
  }
  for (const list of out.values()) list.sort(compareGamesChronologically)
  return out
}

/** playerId → the roster's stored choice for that player this week. */
export async function loadGamesCountChoices(
  db: GamesCountDb,
  args: { rosterId: string; season: number; week: number },
): Promise<Map<string, GamesCountChoice>> {
  const rows = await db.redraftGamesCountChoice.findMany({
    where: { rosterId: args.rosterId, season: args.season, week: args.week },
    select: { playerId: true, pickedGameIds: true, lockedGameId: true },
  })
  return new Map(rows.map((r) => [r.playerId, { pickedGameIds: r.pickedGameIds ?? [], lockedGameId: r.lockedGameId }]))
}

/**
 * Write one player's games for one week, and remove rows for games that are no longer in it (a stat
 * correction, a re-dated game), so a stale game cannot keep counting.
 */
export async function writePlayerWeekGameScores(
  db: GamesCountDb,
  args: {
    playerId: string
    sport: string
    season: number
    week: number
    games: ReadonlyArray<{ gameId: string; gameDay: Date; startTime: Date | null; stats: Record<string, number> }>
  },
): Promise<number> {
  const keep: string[] = []
  for (const g of args.games) {
    keep.push(g.gameId)
    await db.playerWeekGameScore.upsert({
      where: { playerId_sport_season_gameId: { playerId: args.playerId, sport: args.sport, season: args.season, gameId: g.gameId } },
      update: { week: args.week, gameDay: g.gameDay, startTime: g.startTime, stats: g.stats },
      create: {
        playerId: args.playerId,
        sport: args.sport,
        season: args.season,
        week: args.week,
        gameId: g.gameId,
        gameDay: g.gameDay,
        startTime: g.startTime,
        stats: g.stats,
      },
    })
  }
  await db.playerWeekGameScore.deleteMany({
    where: { playerId: args.playerId, sport: args.sport, season: args.season, week: args.week, gameId: { notIn: keep } },
  })
  return keep.length
}

/** The games-count rule for one league, plus the reads it needs — or null when the league counts every game. */
export type GamesCountScoring = {
  setting: Exclude<GamesCountSetting, { mode: 'all' }>
  games: Map<string, StoredWeekGame[]>
  choices: Map<string, GamesCountChoice>
}

/**
 * Load what a roster's scoring needs when the league is opted in. Returns null for `all` WITHOUT a
 * single query against the new tables — the P2021 gate.
 */
export async function loadGamesCountScoring(args: {
  leagueSettings: unknown
  sport: string
  rosterId: string
  season: number
  week: number
  players: ReadonlyArray<{ playerId: string; sport: string }>
  db?: GamesCountDb
}): Promise<GamesCountScoring | null> {
  const setting = readGamesCountSetting(args.leagueSettings, args.sport)
  if (setting.mode === 'all') return null
  const db = args.db ?? gamesCountDb()
  const games = new Map<string, StoredWeekGame[]>()
  for (const playerSport of new Set(args.players.map((p) => p.sport))) {
    const ids = args.players.filter((p) => p.sport === playerSport).map((p) => p.playerId)
    const bySport = await loadWeekGameScores(db, { playerIds: ids, sport: playerSport, season: args.season, week: args.week })
    for (const [k, v] of bySport) games.set(k, v)
  }
  const choices = await loadGamesCountChoices(db, { rosterId: args.rosterId, season: args.season, week: args.week })
  return { setting, games, choices }
}

/**
 * Score a started player's eligible games and apply the league's rule. `scoreStats` is the league's own
 * scorer for one stat line, so each game is scored exactly as a whole week would be.
 */
export async function scoreCountedGames(args: {
  setting: GamesCountSetting
  games: readonly StoredWeekGame[]
  choice?: GamesCountChoice | null
  scoreStats: (stats: Record<string, number>) => Promise<number>
}): Promise<{ points: number; countedGameIds: string[]; countedStats: Record<string, number>[]; scored: WeekGame[] }> {
  const scored: WeekGame[] = []
  for (const g of args.games) {
    scored.push({ gameId: g.gameId, day: g.day, startTime: g.startTime, points: await args.scoreStats(g.stats) })
  }
  const counted = selectCountingGames(args.setting, scored, args.choice)
  const ids = new Set(counted.countedGameIds)
  return {
    points: counted.points,
    countedGameIds: counted.countedGameIds,
    countedStats: args.games.filter((g) => ids.has(g.gameId)).map((g) => g.stats),
    scored,
  }
}
