import "server-only"
import { prisma } from "@/lib/prisma"
import { scoreAllEntriesForChallenge } from "./playoffScoringService"
import type { PlayoffSport } from "./types"

// ─── ESPN path segments ───────────────────────────────────────────────────────

const ESPN_SPORT_PATH: Record<PlayoffSport, string> = {
  nba: "basketball/nba",
  nhl: "hockey/nhl",
}

// ─── Team nickname → ESPN full-name fragment (for substring matching) ─────────
// Matches PlayoffTemplate team nicknames against ESPN's displayName field.

const NBA_NICKNAMES: ReadonlySet<string> = new Set([
  "Hawks", "Celtics", "Nets", "Hornets", "Bulls", "Cavaliers", "Mavericks",
  "Nuggets", "Pistons", "Warriors", "Rockets", "Pacers", "Clippers", "Lakers",
  "Grizzlies", "Heat", "Bucks", "Timberwolves", "Pelicans", "Knicks", "Thunder",
  "Magic", "76ers", "Suns", "Trail Blazers", "Kings", "Spurs", "Raptors",
  "Jazz", "Wizards",
])

const NHL_NICKNAMES: ReadonlySet<string> = new Set([
  "Ducks", "Bruins", "Sabres", "Hurricanes", "Blue Jackets", "Flames",
  "Blackhawks", "Avalanche", "Stars", "Red Wings", "Oilers", "Panthers",
  "Kings", "Wild", "Canadiens", "Devils", "Predators", "Islanders", "Rangers",
  "Senators", "Flyers", "Penguins", "Kraken", "Sharks", "Blues", "Lightning",
  "Maple Leafs", "Utah HC", "Canucks", "Golden Knights", "Jets", "Capitals",
])

// ─── ESPN scoreboard types ────────────────────────────────────────────────────

type EspnPlayoffGame = {
  /** ESPN full display name e.g. "Boston Celtics" */
  homeTeamFull: string
  awayTeamFull: string
  /** Series wins for the series HOME team (as seen from today's game) */
  homeSeriesWins: number | null
  awaySeriesWins: number | null
  /** ESPN status type name */
  statusName: string
  isLive: boolean
  isFinal: boolean
}

// ─── Public result types ──────────────────────────────────────────────────────

export type LiveSyncSeriesResult = {
  seriesId: string
  homeTeamName: string
  awayTeamName: string
  prevHomeWins: number
  prevAwayWins: number
  homeWins: number
  awayWins: number
  status: string
  winnerTeamName: string | null
  isLive: boolean
  wasUpdated: boolean
  newlyClinched: boolean
  skipped: boolean
  skipReason?: string
}

export type LiveSyncChallengeResult = {
  challengeId: string
  sport: PlayoffSport
  season: number
  dryRun: boolean
  seriesTotal: number
  seriesProcessed: number
  seriesUpdated: number
  newlyClinched: number
  results: LiveSyncSeriesResult[]
  errors: string[]
}

export type LiveSyncBatchResult = {
  sport: PlayoffSport
  season: number
  dryRun: boolean
  challengesProcessed: number
  challengeResults: LiveSyncChallengeResult[]
  errors: string[]
}

// ─── ESPN fetch helpers ───────────────────────────────────────────────────────

/**
 * Parse a competitor's records array for a series win count.
 * ESPN encodes this as e.g. { name: "PlayoffSeries", type: "vs", summary: "3-1" }
 * where summary is "wins-losses" from this competitor's perspective.
 */
function parseSeriesWins(records: unknown[]): number | null {
  if (!Array.isArray(records)) return null
  for (const rec of records) {
    const r = rec as Record<string, unknown>
    const name = String(r.name ?? "").toLowerCase()
    const type = String(r.type ?? "").toLowerCase()
    if (!name.includes("series") && type !== "vs") continue
    const summary = String(r.summary ?? "")
    const wins = parseInt(summary.split("-")[0], 10)
    if (Number.isFinite(wins)) return wins
  }
  return null
}

/**
 * Fetch today's NBA/NHL scoreboard from ESPN and extract playoff series data.
 * Returns an empty array on any error (non-fatal: sync degrades gracefully).
 */
async function fetchEspnPlayoffGames(sport: PlayoffSport): Promise<EspnPlayoffGame[]> {
  const path = ESPN_SPORT_PATH[sport]
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`

  let data: unknown
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000) // 8 s timeout
    let res: Response
    try {
      res = await fetch(url, { cache: "no-store", signal: controller.signal })
    } finally {
      clearTimeout(timeoutId)
    }
    if (!res.ok) return []
    data = await res.json()
  } catch {
    return []
  }

  const events: unknown[] = (data as Record<string, unknown>)?.events as unknown[] ?? []
  const games: EspnPlayoffGame[] = []

  for (const rawEvent of events) {
    const event = rawEvent as Record<string, unknown>
    const competitions = (event.competitions as unknown[]) ?? []
    const comp = (competitions[0] ?? {}) as Record<string, unknown>
    const competitors = (comp.competitors as unknown[]) ?? []

    const home = (competitors as Record<string, unknown>[]).find(
      (c) => c.homeAway === "home"
    )
    const away = (competitors as Record<string, unknown>[]).find(
      (c) => c.homeAway === "away"
    )
    if (!home || !away) continue

    const homeTeam = (home.team ?? {}) as Record<string, unknown>
    const awayTeam = (away.team ?? {}) as Record<string, unknown>
    const homeTeamFull = String(homeTeam.displayName ?? "")
    const awayTeamFull = String(awayTeam.displayName ?? "")
    if (!homeTeamFull || !awayTeamFull) continue

    const statusType = ((comp.status as Record<string, unknown>)?.type ?? {}) as Record<
      string,
      unknown
    >
    const statusName = String(statusType.name ?? "")
    const isLive =
      statusName === "STATUS_IN_PROGRESS" || statusName === "STATUS_HALFTIME"
    const isFinal = statusType.completed === true || statusName === "STATUS_FINAL"

    const homeSeriesWins = parseSeriesWins((home.records as unknown[]) ?? [])
    const awaySeriesWins = parseSeriesWins((away.records as unknown[]) ?? [])

    games.push({
      homeTeamFull,
      awayTeamFull,
      homeSeriesWins,
      awaySeriesWins,
      statusName,
      isLive,
      isFinal,
    })
  }

  return games
}

// ─── Team name matching ───────────────────────────────────────────────────────

/**
 * Returns true if the ESPN full name (e.g. "Boston Celtics") contains the
 * series nickname (e.g. "Celtics").  Case-insensitive substring match.
 */
function fullNameContainsNickname(full: string, nickname: string): boolean {
  return full.toLowerCase().includes(nickname.toLowerCase())
}

/**
 * Find an ESPN game that matches this series' home and away nicknames.
 * Games can be hosted at either site across a series, so we also test the
 * reversed pairing.
 *
 * Returns the game and whether it was found in the "normal" (home/away
 * matching nicknames directly) or "reversed" orientation.
 */
function findMatchingGame(
  games: EspnPlayoffGame[],
  homeNickname: string,
  awayNickname: string
): { game: EspnPlayoffGame; reversed: boolean } | null {
  for (const game of games) {
    if (
      fullNameContainsNickname(game.homeTeamFull, homeNickname) &&
      fullNameContainsNickname(game.awayTeamFull, awayNickname)
    ) {
      return { game, reversed: false }
    }
    // Series teams swap home/away between games
    if (
      fullNameContainsNickname(game.homeTeamFull, awayNickname) &&
      fullNameContainsNickname(game.awayTeamFull, homeNickname)
    ) {
      return { game, reversed: true }
    }
  }
  return null
}

/**
 * Returns true if the team name is a real nickname (not a placeholder like "EAST1").
 */
function isRealTeamName(name: string, sport: PlayoffSport): boolean {
  const set = sport === "nba" ? NBA_NICKNAMES : NHL_NICKNAMES
  return set.has(name)
}

// ─── Clinch threshold ─────────────────────────────────────────────────────────

function clinchThreshold(bestOf: number): number {
  return Math.ceil(bestOf / 2)
}

// ─── Core sync for a single challenge ────────────────────────────────────────

type SeriesRow = {
  id: string
  homeTeamName: string
  awayTeamName: string
  homeWins: number
  awayWins: number
  bestOf: number
  status: string
  winnerTeamName: string | null
}

/**
 * Sync live series data for one playoff bracket challenge.
 *
 * Algorithm:
 *  1. Load all non-final series for the challenge.
 *  2. Fetch today's ESPN scoreboard for live series game data.
 *  3. For each series with real team names, look for a matching ESPN game.
 *  4. Extract series win counts from the ESPN game's competitor records.
 *  5. Detect clinch (either team reaches ceil(bestOf/2) wins) → mark final.
 *  6. Detect live game → mark in_progress.
 *  7. Persist changes and trigger scoring on newly clinched series.
 *
 * On any day with no scheduled games the ESPN data is empty; existing
 * homeWins/awayWins values are left untouched (no regression).
 */
export async function syncPlayoffLiveSeries(input: {
  challengeId: string
  sport: PlayoffSport
  season: number
  dryRun?: boolean
  /** Pre-fetched ESPN games — pass to avoid redundant network calls in batch mode */
  prefetchedGames?: EspnPlayoffGame[]
}): Promise<LiveSyncChallengeResult> {
  const { challengeId, sport, season, dryRun = false } = input
  const errors: string[] = []

  // ── Load all non-final series ─────────────────────────────────────────────
  const allSeries = await (prisma as any).playoffBracketSeries.findMany({
    where: { challengeId, status: { not: "final" } },
    select: {
      id: true,
      homeTeamName: true,
      awayTeamName: true,
      homeWins: true,
      awayWins: true,
      bestOf: true,
      status: true,
      winnerTeamName: true,
    },
  })

  const seriesRows = allSeries as SeriesRow[]

  if (seriesRows.length === 0) {
    return {
      challengeId,
      sport,
      season,
      dryRun,
      seriesTotal: 0,
      seriesProcessed: 0,
      seriesUpdated: 0,
      newlyClinched: 0,
      results: [],
      errors,
    }
  }

  // ── Fetch ESPN playoff games (or use pre-fetched batch) ───────────────────
  let espnGames: EspnPlayoffGame[] = input.prefetchedGames ?? []
  if (!input.prefetchedGames) {
    try {
      espnGames = await fetchEspnPlayoffGames(sport)
    } catch (err) {
      errors.push(`ESPN scoreboard fetch failed: ${String(err)}`)
      // Non-fatal — continue with live detection degraded
    }
  }

  // ── Process each non-final series ─────────────────────────────────────────
  const results: LiveSyncSeriesResult[] = []
  let seriesProcessed = 0
  let seriesUpdated = 0
  let newlyClinchedCount = 0
  let anySeriesClinched = false

  for (const series of seriesRows) {
    // ── Skip placeholder teams (non-test-mode before commissioner seeds teams)
    if (
      !isRealTeamName(series.homeTeamName, sport) ||
      !isRealTeamName(series.awayTeamName, sport)
    ) {
      results.push({
        seriesId: series.id,
        homeTeamName: series.homeTeamName,
        awayTeamName: series.awayTeamName,
        prevHomeWins: series.homeWins,
        prevAwayWins: series.awayWins,
        homeWins: series.homeWins,
        awayWins: series.awayWins,
        status: series.status,
        winnerTeamName: series.winnerTeamName,
        isLive: false,
        wasUpdated: false,
        newlyClinched: false,
        skipped: true,
        skipReason: "Placeholder team names — bracket not yet seeded",
      })
      continue
    }

    seriesProcessed++

    // ── Match to an ESPN game ─────────────────────────────────────────────
    const match = findMatchingGame(espnGames, series.homeTeamName, series.awayTeamName)

    // If no ESPN game for this series today, leave existing values unchanged
    if (!match) {
      results.push({
        seriesId: series.id,
        homeTeamName: series.homeTeamName,
        awayTeamName: series.awayTeamName,
        prevHomeWins: series.homeWins,
        prevAwayWins: series.awayWins,
        homeWins: series.homeWins,
        awayWins: series.awayWins,
        status: series.status,
        winnerTeamName: series.winnerTeamName,
        isLive: false,
        wasUpdated: false,
        newlyClinched: false,
        skipped: false,
      })
      continue
    }

    const { game, reversed } = match

    // Extract series wins — if ESPN doesn't provide them keep existing values
    let homeWins = series.homeWins
    let awayWins = series.awayWins

    if (game.homeSeriesWins !== null && game.awaySeriesWins !== null) {
      if (reversed) {
        // ESPN's "home" team is our series' away team and vice versa
        homeWins = game.awaySeriesWins
        awayWins = game.homeSeriesWins
      } else {
        homeWins = game.homeSeriesWins
        awayWins = game.awaySeriesWins
      }
    }

    // ── Determine new status / winner ─────────────────────────────────────
    const needed = clinchThreshold(series.bestOf)
    let newStatus = series.status
    let newWinner = series.winnerTeamName
    let newlyClinched = false

    if (homeWins >= needed) {
      newStatus = "final"
      newWinner = series.homeTeamName
      if (series.status !== "final") {
        newlyClinched = true
        anySeriesClinched = true
        newlyClinchedCount++
      }
    } else if (awayWins >= needed) {
      newStatus = "final"
      newWinner = series.awayTeamName
      if (series.status !== "final") {
        newlyClinched = true
        anySeriesClinched = true
        newlyClinchedCount++
      }
    } else if (game.isLive) {
      newStatus = "in_progress"
      newWinner = null
    } else if (game.isFinal) {
      // Game completed but series not over — still scheduled until next game
      newStatus = series.status === "in_progress" ? "scheduled" : series.status
      newWinner = null
    }

    const wasUpdated =
      homeWins !== series.homeWins ||
      awayWins !== series.awayWins ||
      newStatus !== series.status ||
      newWinner !== series.winnerTeamName

    // ── Persist ───────────────────────────────────────────────────────────
    if (wasUpdated && !dryRun) {
      try {
        await (prisma as any).playoffBracketSeries.update({
          where: { id: series.id },
          data: {
            homeWins,
            awayWins,
            status: newStatus,
            winnerTeamName: newWinner,
          },
        })
      } catch (err) {
        errors.push(`Series update failed (${series.id}): ${String(err)}`)
      }
    }

    if (wasUpdated) seriesUpdated++

    results.push({
      seriesId: series.id,
      homeTeamName: series.homeTeamName,
      awayTeamName: series.awayTeamName,
      prevHomeWins: series.homeWins,
      prevAwayWins: series.awayWins,
      homeWins,
      awayWins,
      status: newStatus,
      winnerTeamName: newWinner,
      isLive: game.isLive,
      wasUpdated,
      newlyClinched,
      skipped: false,
    })
  }

  // ── Rescore all entries if any series was newly clinched ──────────────────
  if (!dryRun && anySeriesClinched) {
    try {
      await scoreAllEntriesForChallenge({ challengeId })
    } catch (err) {
      errors.push(`Scoring failed after clinch: ${String(err)}`)
    }
  }

  return {
    challengeId,
    sport,
    season,
    dryRun,
    seriesTotal: seriesRows.length,
    seriesProcessed,
    seriesUpdated,
    newlyClinched: newlyClinchedCount,
    results,
    errors,
  }
}

// ─── Batch: sync all open challenges for a sport ─────────────────────────────

/**
 * Discover and sync all open playoff bracket challenges for the given sport.
 * Called by the cron job every 5 minutes during active playoff windows.
 */
export async function syncAllPlayoffChallenges(input: {
  sport: PlayoffSport
  season: number
  dryRun?: boolean
  singleChallengeId?: string
}): Promise<LiveSyncBatchResult> {
  const { sport, season, dryRun = false, singleChallengeId } = input
  const errors: string[] = []

  // ── Discover challenges ───────────────────────────────────────────────────
  let challengeIds: string[]
  if (singleChallengeId) {
    challengeIds = [singleChallengeId]
  } else {
    try {
      const rows = await (prisma as any).playoffBracketChallenge.findMany({
        where: { sport, seasonYear: season, status: "open" },
        select: { id: true },
      })
      challengeIds = (rows as Array<{ id: string }>).map((r) => r.id)
    } catch (err) {
      errors.push(`Challenge discovery failed: ${String(err)}`)
      return {
        sport,
        season,
        dryRun,
        challengesProcessed: 0,
        challengeResults: [],
        errors,
      }
    }
  }

  // ── Fetch ESPN games once for all challenges (shared network call) ──────────
  let sharedEspnGames: EspnPlayoffGame[] | undefined
  if (!singleChallengeId) {
    // Only pre-fetch in batch mode; single-challenge mode fetches itself
    try {
      sharedEspnGames = await fetchEspnPlayoffGames(sport)
    } catch (err) {
      errors.push(`ESPN pre-fetch failed (degraded): ${String(err)}`)
      sharedEspnGames = []
    }
  }

  // ── Sync all challenges in parallel ──────────────────────────────────────
  const settled = await Promise.allSettled(
    challengeIds.map((challengeId) =>
      syncPlayoffLiveSeries({
        challengeId,
        sport,
        season,
        dryRun,
        prefetchedGames: sharedEspnGames,
      })
    )
  )

  const challengeResults: LiveSyncChallengeResult[] = settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value
    const msg = String(result.reason)
    errors.push(`Challenge ${challengeIds[i]} failed: ${msg}`)
    return {
      challengeId: challengeIds[i],
      sport,
      season,
      dryRun,
      seriesTotal: 0,
      seriesProcessed: 0,
      seriesUpdated: 0,
      newlyClinched: 0,
      results: [],
      errors: [msg],
    }
  })

  return {
    sport,
    season,
    dryRun,
    challengesProcessed: challengeIds.length,
    challengeResults,
    errors,
  }
}
