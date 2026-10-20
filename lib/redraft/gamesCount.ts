/**
 * WHICH GAMES COUNT — the commissioner's per-league rule for NBA, NHL and MLB weekly scoring.
 *
 * A player in these sports plays several games in a fantasy week. The commissioner chooses which of a
 * STARTED player's games count toward the weekly score:
 *
 *   - `all`      every game (the DEFAULT, and exactly the behaviour before this setting existed);
 *   - `best_n`   N games (N = 2 or 3). The manager may pick which N; any slot he leaves unpicked is
 *                filled by his best remaining game, so a manager who never picks gets his best N;
 *   - `lock_in`  one game. After a game finishes, and before his next game starts, the manager may lock
 *                that game's score in; his later games that week then do not count. A manager who never
 *                locks in gets the player's LAST game of the week.
 *
 * Stored in `League.settings.sportConfig` as `gamesCountMode` and `gamesCountBestN`, the same blob the
 * league settings modal saves, and read ONLY through `readGamesCountSetting`. Anything that is not a
 * valid value — a missing key, a typo, a sport the rule does not apply to — reads as `all`, so a bad
 * write can never change a score.
 *
 * 🛑 `all` NEVER TOUCHES THE TWO TABLES THIS FEATURE ADDS. `player_week_game_scores` and
 * `redraft_games_count_choices` arrive with migration `20261020180000_games_count_setting`, and a
 * query against a table production lacks raises P2021. Every reader and writer is behind
 * `gamesCountActive`, which is false for every league until a commissioner picks another mode.
 *
 * Pure and client-safe: the settings panel and the player card import it.
 */

export type GamesCountMode = 'all' | 'best_n' | 'lock_in'

export type GamesCountSetting = { mode: 'all' } | { mode: 'best_n'; n: 2 | 3 } | { mode: 'lock_in' }

/** The only sports the rule applies to: several games a week per player. */
export const GAMES_COUNT_SPORTS: readonly string[] = ['NBA', 'NHL', 'MLB']

export const GAMES_COUNT_MODES: readonly GamesCountMode[] = ['all', 'best_n', 'lock_in']

export const GAMES_COUNT_BEST_N_VALUES: readonly number[] = [2, 3]

/** The keys inside `settings.sportConfig`. */
export const GAMES_COUNT_MODE_KEY = 'gamesCountMode'
export const GAMES_COUNT_BEST_N_KEY = 'gamesCountBestN'

const DEFAULT_SETTING: GamesCountSetting = { mode: 'all' }

function sportConfigOf(leagueSettings: unknown): Record<string, unknown> {
  if (!leagueSettings || typeof leagueSettings !== 'object' || Array.isArray(leagueSettings)) return {}
  const sc = (leagueSettings as Record<string, unknown>).sportConfig
  return sc && typeof sc === 'object' && !Array.isArray(sc) ? (sc as Record<string, unknown>) : {}
}

export function isGamesCountSport(sport: string | null | undefined): boolean {
  return GAMES_COUNT_SPORTS.includes(String(sport ?? '').trim().toUpperCase())
}

/** The league's rule. `{ mode: 'all' }` for every sport outside NBA/NHL/MLB and for any invalid value. */
export function readGamesCountSetting(leagueSettings: unknown, sport: string | null | undefined): GamesCountSetting {
  if (!isGamesCountSport(sport)) return DEFAULT_SETTING
  const sc = sportConfigOf(leagueSettings)
  const mode = sc[GAMES_COUNT_MODE_KEY]
  if (mode === 'lock_in') return { mode: 'lock_in' }
  if (mode === 'best_n') {
    const n = sc[GAMES_COUNT_BEST_N_KEY]
    if (n === 2 || n === 3) return { mode: 'best_n', n }
    return DEFAULT_SETTING
  }
  return DEFAULT_SETTING
}

/** True when the league counts anything other than every game — the gate for the two new tables. */
export function gamesCountActive(leagueSettings: unknown, sport: string | null | undefined): boolean {
  return readGamesCountSetting(leagueSettings, sport).mode !== 'all'
}

/**
 * Validate the two keys inside a `sportConfig` a commissioner is saving. Returns an error message for
 * a 400, or null when the keys are absent or valid. The keys are checked only when present, so a save
 * that does not mention them is never refused because of them.
 */
export function gamesCountSportConfigError(sportConfig: unknown, sport: string | null | undefined): string | null {
  if (!sportConfig || typeof sportConfig !== 'object' || Array.isArray(sportConfig)) return null
  const sc = sportConfig as Record<string, unknown>
  const hasMode = sc[GAMES_COUNT_MODE_KEY] !== undefined && sc[GAMES_COUNT_MODE_KEY] !== null
  const hasN = sc[GAMES_COUNT_BEST_N_KEY] !== undefined && sc[GAMES_COUNT_BEST_N_KEY] !== null
  if (!hasMode && !hasN) return null
  const mode = sc[GAMES_COUNT_MODE_KEY]
  if (hasMode && !GAMES_COUNT_MODES.includes(mode as GamesCountMode)) {
    return `${GAMES_COUNT_MODE_KEY} must be one of: ${GAMES_COUNT_MODES.join(', ')}`
  }
  const effectiveMode = (hasMode ? mode : 'all') as GamesCountMode
  if (effectiveMode !== 'all' && !isGamesCountSport(sport)) {
    return `${GAMES_COUNT_MODE_KEY} applies to ${GAMES_COUNT_SPORTS.join(', ')} leagues only`
  }
  if (effectiveMode === 'best_n') {
    const n = sc[GAMES_COUNT_BEST_N_KEY]
    if (!GAMES_COUNT_BEST_N_VALUES.includes(n as number)) {
      return `${GAMES_COUNT_BEST_N_KEY} must be ${GAMES_COUNT_BEST_N_VALUES.join(' or ')} when ${GAMES_COUNT_MODE_KEY} is best_n`
    }
  } else if (hasN && !GAMES_COUNT_BEST_N_VALUES.includes(sc[GAMES_COUNT_BEST_N_KEY] as number)) {
    return `${GAMES_COUNT_BEST_N_KEY} must be ${GAMES_COUNT_BEST_N_VALUES.join(' or ')}`
  }
  return null
}

/** One game a player played this week, scored by the league's rules. */
export type WeekGame = {
  gameId: string
  /** The US Eastern day, `YYYY-MM-DD`. */
  day: string
  /** The scheduled start instant (ISO), when the schedule knows it. */
  startTime: string | null
  points: number
}

/** The manager's stored choice for one player and one week. */
export type GamesCountChoice = {
  pickedGameIds?: readonly string[] | null
  lockedGameId?: string | null
}

/**
 * Chronological order: Eastern day, then start time, then game id. A game with no start time sorts
 * before a timed game on the same day; the game id settles anything left, so the order is total and
 * never depends on input order.
 */
export function compareGamesChronologically(a: Pick<WeekGame, 'gameId' | 'day' | 'startTime'>, b: Pick<WeekGame, 'gameId' | 'day' | 'startTime'>): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  const at = a.startTime ?? ''
  const bt = b.startTime ?? ''
  if (at !== bt) return at < bt ? -1 : 1
  if (a.gameId !== b.gameId) return a.gameId < b.gameId ? -1 : 1
  return 0
}

/**
 * Best-first order for `best_n`: more points first; on equal points the EARLIER game wins (the score
 * the manager could have seen first), then the game id. Total, so the pick is deterministic.
 */
export function compareGamesBestFirst(a: WeekGame, b: WeekGame): number {
  if (a.points !== b.points) return b.points - a.points
  return compareGamesChronologically(a, b)
}

/** The player's last game of the week — what `lock_in` counts when the manager never locks one in. */
export function lastGame<T extends Pick<WeekGame, 'gameId' | 'day' | 'startTime'>>(games: readonly T[]): T | null {
  let last: T | null = null
  for (const g of games) if (!last || compareGamesChronologically(g, last) > 0) last = g
  return last
}

export type CountedGames = { countedGameIds: string[]; points: number }

/**
 * Which of a started player's games count, and their total.
 *
 * `games` are the games that are ELIGIBLE — in a daily-lineup league, only the games on days he was
 * started. A pick or lock naming a game outside them is ignored, never trusted.
 *
 *   - `all`      every eligible game;
 *   - `best_n`   the manager's picks first (his first N, in the order he gave), then his best remaining
 *                games until N are counted (`compareGamesBestFirst`). Fewer than N games: all count;
 *   - `lock_in`  the locked game when it is eligible, otherwise the last eligible game.
 *
 * `countedGameIds` is in chronological order.
 */
export function selectCountingGames(
  setting: GamesCountSetting,
  games: readonly WeekGame[],
  choice?: GamesCountChoice | null,
): CountedGames {
  const byId = new Map(games.map((g) => [g.gameId, g]))
  let counted: WeekGame[]
  if (setting.mode === 'all') {
    counted = [...games]
  } else if (setting.mode === 'lock_in') {
    const locked = choice?.lockedGameId ? byId.get(choice.lockedGameId) : undefined
    const g = locked ?? lastGame(games)
    counted = g ? [g] : []
  } else {
    const picked = [...new Set(choice?.pickedGameIds ?? [])]
      .map((id) => byId.get(id))
      .filter((g): g is WeekGame => Boolean(g))
      .slice(0, setting.n)
    const pickedIds = new Set(picked.map((g) => g.gameId))
    const fill = games
      .filter((g) => !pickedIds.has(g.gameId))
      .sort(compareGamesBestFirst)
      .slice(0, setting.n - picked.length)
    counted = [...picked, ...fill]
  }
  counted.sort(compareGamesChronologically)
  return {
    countedGameIds: counted.map((g) => g.gameId),
    points: counted.reduce((sum, g) => sum + g.points, 0),
  }
}
