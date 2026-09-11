/**
 * Fantasy OS — Fleaflicker weekly-matchup parity collector.
 *
 * 🛑 FLEAFLICKER LEAGUES HAD NO `WeeklyMatchup` WRITER, so every surface that
 * reads that table — current week, scoreboard, power board, season outlook —
 * rendered empty for them end to end. Sleeper has `ensureMatchupsCached`,
 * ESPN/Yahoo got `externalMatchupParity`, Fantrax got `fantraxMatchupParity`,
 * Fleaflicker got nothing.
 *
 * ⚠ IT IS A SEPARATE COLLECTOR FROM ESPN/YAHOO FOR ONE REASON: CREDENTIALS.
 * That collector's entire enumeration and retry structure exists to try each
 * importing user's stored cookies/OAuth in turn. The Fleaflicker API is public
 * and keyless, so every one of those branches would be dead code here — the
 * same reason `fantraxMatchupParity` is separate. What IS shared is the part
 * that must never diverge: `applySchedule`, which defines what a WeeklyMatchup
 * row MEANS. Two copies of that drift invisibly — both write rows, both look
 * right, and the surfaces reading them disagree about who won.
 *
 * ⚠ THE ROSTER ID IS READ FROM `LeagueTeam`, NOT RECOMPUTED. Fleaflicker's
 * scoreboard team id is the SAME id space the standings/rosters import already
 * wrote (`contracts/fleaflicker/GAPS.md` G-04, proven by a 16/16 join on id AND
 * name, not by the shapes looking alike). That makes the direct join safe — but
 * `LeagueTeam` stays the authority, and a scoreboard side with no matching
 * `LeagueTeam` row is DROPPED rather than written on trust. A wrong roster id
 * files somebody else's week under your team, and nothing downstream can tell.
 *
 * 🛑 TWO PROVIDER BEHAVIOURS DECIDE THE SHAPE OF THIS FILE. Both were measured
 * on 2026-09-11 and both are the silent kind:
 *
 * 1. A `season` PAST THE LEAGUE'S LAST IS SILENTLY CLAMPED and returns that
 *    last season's complete, played data under HTTP 200. League 206154 (last
 *    season 2021) answers 2024, 2025, 2026 and 2099 with byte-identical games.
 *    A sync that trusted the request would persist 2021 finals as this week's
 *    results for every dormant league. `fetchFleaflickerScoreboard` asserts
 *    `schedulePeriod.low.season` and throws; this collector turns that into an
 *    honest per-league SKIP, because a dormant league is a normal state, not a
 *    failure. ⚠ The skip note names the season actually returned — a bare
 *    "failed" here would be indistinguishable from an outage.
 *
 * 2. A FALSE BOOLEAN IS OMITTED, NOT SENT AS `false`. So `isFinalScore ===
 *    false` is never true, and an unplayed game must be detected by ABSENCE.
 *    Proven per-row inside one payload — see `FleaflickerScoreboardGame`.
 *
 * ⚠ ONLY FINAL GAMES ARE WRITTEN, AND THAT IS A DELIBERATE ANSWER TO AN OPEN
 * GAP RATHER THAN A PREFERENCE. `contracts/fleaflicker/GAPS.md` G-05(b) — what
 * a scheduled-but-unplayed week's scores look like — is UNOBSERVED, and cannot
 * be observed from the only league with a committed fixture, because that
 * league's last season is 2021 and every one of its periods is final. The three
 * live possibilities are absent `homeScore`, an empty `{}`, or a zero value.
 * Writing only `isFinalScore === true` games makes this collector correct under
 * ALL THREE, so the gap does not have to be closed before it can ship. It also
 * matches `fantraxMatchupParity`'s reasoning: `applySchedule` coerces a missing
 * score to 0, every reader treats 0-0 as unplayed, and so a future fixture
 * written as a 0-0 placeholder is indistinguishable from a real result of zero.
 * ⚠ If G-05(b) is ever closed, revisit this — do not assume the placeholder
 * convention Sleeper/ESPN/Yahoo use is wrong for Fleaflicker, only that it is
 * unproven.
 */
import { prisma } from '@/lib/prisma'
import { applySchedule, type ScheduleWeekInput } from './externalMatchupParity'
import {
  fetchFleaflickerScoreboard,
  FleaflickerImportLeagueNotFoundError,
  FleaflickerImportUnavailableError,
  FleaflickerSeasonMismatchError,
} from '@/lib/league-import/fleaflicker/FleaflickerLeagueFetchService'
import type { FleaflickerSport } from '@/lib/league-import/fleaflicker/types'

const CACHE_KEY_PREFIX = 'fleaflicker_matchup_sync'
/** One request per scoring period read, so refresh a league every 6h rather than Sleeper's 30min. */
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
const FAILURE_RETRY_MS = 30 * 60 * 1000
/**
 * Ceiling on periods fetched per league per tick. A full NFL season is ~17; the
 * cap exists so a malformed `eligibleSchedulePeriods` cannot turn one league
 * into an unbounded request loop against a provider that asks nothing of us.
 */
const MAX_PERIODS_PER_LEAGUE = 20

export interface FleaflickerMatchupConnection {
  /** `League.platformLeagueId` — for Fleaflicker this is the bare numeric league id, e.g. "206154". */
  platformLeagueId: string
  leagueId: number
  season: number
  sport: FleaflickerSport
}

export interface FleaflickerMatchupLeagueResult {
  runKey: string
  status: 'synced' | 'skipped' | 'failed' | 'not_due'
  note?: string
  weeksWritten?: number
  weeksUnchanged?: number
  periodsRead?: number
}

export interface FleaflickerMatchupParityResult {
  enumerated: number
  synced: number
  skipped: number
  failed: number
  notDue: number
  results: FleaflickerMatchupLeagueResult[]
}

/**
 * Latest imported season per Fleaflicker league — older seasons are frozen
 * history and never refetched.
 *
 * ⚠ A non-numeric `platformLeagueId` is skipped rather than coerced. The
 * Fleaflicker API takes an integer league id and nothing else; feeding it
 * `Number('')` (which is 0) would probe a league that is not this one.
 */
export async function enumerateFleaflickerMatchupConnections(): Promise<FleaflickerMatchupConnection[]> {
  const rows = await prisma.league.findMany({
    where: { platform: 'fleaflicker', platformLeagueId: { not: '' } },
    select: { platformLeagueId: true, season: true, sport: true },
    orderBy: [{ season: 'desc' }, { createdAt: 'asc' }],
  })

  const byLeague = new Map<string, FleaflickerMatchupConnection>()
  for (const row of rows) {
    const platformLeagueId = String(row.platformLeagueId ?? '').trim()
    if (!/^\d+$/.test(platformLeagueId)) continue
    if (byLeague.has(platformLeagueId)) continue
    const leagueId = Number(platformLeagueId)
    if (!Number.isInteger(leagueId) || leagueId <= 0) continue

    /*
     * Only NFL is in this codebase's Fleaflicker scope today (see
     * provider-ui-config's supportedSports). An unexpected sport is passed
     * through rather than silently rewritten to NFL — a wrong sport returns a
     * 404 the caller can read, where a substituted one returns another
     * league's data.
     */
    const sport = String(row.sport ?? 'NFL').toUpperCase() as FleaflickerSport
    byLeague.set(platformLeagueId, {
      platformLeagueId,
      leagueId,
      season: row.season,
      sport,
    })
  }
  return Array.from(byLeague.values())
}

/**
 * The set of team ids `LeagueTeam` already holds for this league.
 *
 * Returns null when the league has no teams at all — writing matchup rows in
 * that state produces a scoreboard whose every team is unnameable, which is
 * worse than the empty board it replaces.
 *
 * ⚠ A SET, NOT A NAME MAP, AND THE DIFFERENCE IS THE POINT. `fantraxMatchupParity`
 * has to join on normalized team NAME because Fantrax team ids are hashes
 * computed over a snapshot. Fleaflicker needs no such bridge — G-04 proved the
 * scoreboard id IS the imported id — so this only has to answer "does this team
 * exist here", and never has to guess which team a name means.
 */
async function readKnownRosterIds(platformLeagueId: string): Promise<Set<string> | null> {
  const teams = await prisma.leagueTeam.findMany({
    where: { league: { platformLeagueId } },
    select: { externalId: true },
  })
  const ids = new Set<string>()
  for (const t of teams) {
    const raw = String(t.externalId ?? '').trim()
    if (raw) ids.add(raw)
  }
  return ids.size > 0 ? ids : null
}

function cacheKeyFor(connection: FleaflickerMatchupConnection): string {
  return `${CACHE_KEY_PREFIX}:${connection.platformLeagueId}:${connection.season}`
}

async function recordSyncState(
  cacheKey: string,
  ttlMs: number,
  data: Record<string, unknown>,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    update: { data: data as object, expiresAt },
    create: { cacheKey, data: data as object, expiresAt },
  })
}

async function isDue(cacheKey: string, now: Date): Promise<boolean> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey }, select: { expiresAt: true } })
    .catch(() => null)
  /* ⚠ FAILS OPEN, like the Fantrax collector: an unreadable cadence row must not
     stop a league syncing forever. Worst case is one extra keyless read; the
     alternative is a league that goes quiet with nothing reporting why. */
  if (!row?.expiresAt) return true
  return row.expiresAt.getTime() <= now.getTime()
}

/**
 * Read a scored point off a game side.
 *
 * Every level is optional because the unplayed shape is unobserved (G-05(b)):
 * `homeScore` may be absent, `{}`, or carry a zero. This returns null unless a
 * finite number is actually present — it never substitutes 0 for "no score",
 * which is the coercion that makes an unplayed week indistinguishable from a
 * real zero.
 */
function scoreOf(side: { score?: { value?: number } } | null | undefined): number | null {
  const v = side?.score?.value
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Fetch every period up to and including the league's current one, keeping only
 * games that are final and whose BOTH sides map to a known `LeagueTeam`.
 */
async function collectPlayedWeeks(
  connection: FleaflickerMatchupConnection,
  knownRosterIds: Set<string>,
): Promise<{ schedule: ScheduleWeekInput[]; periodsRead: number; season: number } | { skipNote: string }> {
  // The unparameterised call doubles as the season assertion and the period census.
  const head = await fetchFleaflickerScoreboard(
    connection.sport,
    connection.leagueId,
    connection.season,
  )

  const current = head.currentPeriod
  if (current == null || current < 1) {
    return { skipNote: 'league reports no current scoring period' }
  }

  /*
   * Periods 1..current only. Later periods cannot contain a final game by
   * definition, and fetching them would spend requests to discover the one
   * shape this collector deliberately does not write (see the header note on
   * G-05(b)).
   */
  const periods = (
    head.periods.length > 0
      ? head.periods
      : /* No eligible-period list came back; fall back to counting up to the current one. */
        Array.from({ length: current }, (_, i) => i + 1)
  )
    .filter((p) => p <= current)
    .slice(0, MAX_PERIODS_PER_LEAGUE)
    .sort((a, b) => a - b)

  const schedule: ScheduleWeekInput[] = []
  let periodsRead = 0
  let season = connection.season

  for (const period of periods) {
    // Reuse the head response for the current period rather than re-fetching it.
    const fetched =
      period === current && head.week != null
        ? head
        : await fetchFleaflickerScoreboard(
            connection.sport,
            connection.leagueId,
            connection.season,
            period,
          )
    periodsRead++
    const week = fetched.week
    if (week == null) continue // no `games` key at all — nothing scheduled yet
    season = week.season

    const matchups: ScheduleWeekInput['matchups'] = []
    for (const game of week.games) {
      /*
       * 🛑 `=== true`, NEVER `!== false`. A false boolean is omitted, so
       * `isFinalScore` is either `true` or absent; `!== false` would match every
       * unplayed game and write the whole future season as 0-0 placeholders.
       */
      if (game.isFinalScore !== true) continue

      const homeId = String(game.home?.id ?? '')
      const awayId = String(game.away?.id ?? '')
      // LeagueTeam is the authority — an unmappable side is dropped, never guessed.
      if (!knownRosterIds.has(homeId) || !knownRosterIds.has(awayId)) continue

      const homePoints = scoreOf(game.homeScore)
      const awayPoints = scoreOf(game.awayScore)
      /*
       * A final game with no readable score is dropped rather than written as
       * 0-0. It has never been observed and would be a contradiction; writing
       * it would invent a scoreline.
       */
      if (homePoints == null || awayPoints == null) continue

      matchups.push({
        teamId1: homeId,
        teamId2: awayId,
        points1: homePoints,
        points2: awayPoints,
      })
    }

    if (matchups.length > 0) {
      schedule.push({ week: period, season, matchups })
    }
  }

  return { schedule, periodsRead, season }
}

export async function runFleaflickerMatchupParity(input?: {
  now?: Date
  /** Bound the tick: each league costs one request per played period. Default 3. */
  maxLeagues?: number
}): Promise<FleaflickerMatchupParityResult> {
  const now = input?.now ?? new Date()
  const maxLeagues = input?.maxLeagues ?? 3

  const connections = await enumerateFleaflickerMatchupConnections()
  const summary: FleaflickerMatchupParityResult = {
    enumerated: connections.length,
    synced: 0,
    skipped: 0,
    failed: 0,
    notDue: 0,
    results: [],
  }

  let budget = maxLeagues
  for (const connection of connections) {
    const runKey = `fleaflicker:${connection.platformLeagueId}:${connection.season}`
    const cacheKey = cacheKeyFor(connection)

    if (budget <= 0) {
      summary.notDue++
      summary.results.push({ runKey, status: 'not_due', note: 'tick budget spent' })
      continue
    }
    if (!(await isDue(cacheKey, now))) {
      summary.notDue++
      summary.results.push({ runKey, status: 'not_due' })
      continue
    }

    /* Per-league isolation, mirroring the other three collectors: one league's
       failure never blocks another's. */
    try {
      budget--

      const knownRosterIds = await readKnownRosterIds(connection.platformLeagueId)
      if (!knownRosterIds) {
        const note = 'no LeagueTeam rows for this league — import it before syncing matchups'
        summary.skipped++
        summary.results.push({ runKey, status: 'skipped', note })
        await recordSyncState(cacheKey, FAILURE_RETRY_MS, { status: 'skipped', note })
        continue
      }

      const collected = await collectPlayedWeeks(connection, knownRosterIds)
      if ('skipNote' in collected) {
        summary.skipped++
        summary.results.push({ runKey, status: 'skipped', note: collected.skipNote })
        await recordSyncState(cacheKey, SYNC_INTERVAL_MS, {
          status: 'skipped',
          note: collected.skipNote,
          at: now.toISOString(),
        })
        continue
      }

      if (collected.schedule.length === 0) {
        const note = 'no final week available for this league yet'
        summary.skipped++
        summary.results.push({
          runKey,
          status: 'skipped',
          note,
          periodsRead: collected.periodsRead,
        })
        await recordSyncState(cacheKey, SYNC_INTERVAL_MS, {
          status: 'skipped',
          note,
          periodsRead: collected.periodsRead,
          at: now.toISOString(),
        })
        continue
      }

      const { weeksWritten, weeksUnchanged } = await applySchedule(
        /*
         * Identity, deliberately. Every id reaching here has already been
         * checked against `LeagueTeam` in `collectPlayedWeeks`, so re-deriving
         * or re-validating it here would put a second opinion about team
         * identity in the file — which is exactly the failure the Fantrax
         * collector's header warns about.
         */
        (id) => (id ? id : null),
        connection.platformLeagueId,
        collected.schedule,
      )

      summary.synced++
      summary.results.push({
        runKey,
        status: 'synced',
        weeksWritten,
        weeksUnchanged,
        periodsRead: collected.periodsRead,
      })
      await recordSyncState(cacheKey, SYNC_INTERVAL_MS, {
        status: 'synced',
        weeksWritten,
        weeksUnchanged,
        periodsRead: collected.periodsRead,
        season: collected.season,
        at: now.toISOString(),
      })
    } catch (err) {
      /*
       * ⚠ THREE PROVIDER CONDITIONS ARE SKIPS, NOT FAILURES, AND CONFLATING THEM
       * WOULD HIDE THE ONE THAT MATTERS.
       *
       * - A season mismatch means the league is DORMANT and the provider
       *   clamped us to an older season. That is a normal end state for an old
       *   league, and the note names the season actually returned.
       * - A 404 means the league is gone.
       * - An unavailable (429/5xx) is transient and retries sooner.
       */
      if (err instanceof FleaflickerSeasonMismatchError) {
        const note =
          `league has no ${connection.season} season — provider returned ` +
          `${err.returnedSeason ?? 'unknown'} (silently clamped); not syncing stale results`
        summary.skipped++
        summary.results.push({ runKey, status: 'skipped', note })
        await recordSyncState(cacheKey, SYNC_INTERVAL_MS, {
          status: 'skipped',
          note,
          returnedSeason: err.returnedSeason,
          at: now.toISOString(),
        }).catch(() => {})
        continue
      }
      if (err instanceof FleaflickerImportLeagueNotFoundError) {
        const note = err.message
        summary.skipped++
        summary.results.push({ runKey, status: 'skipped', note })
        await recordSyncState(cacheKey, SYNC_INTERVAL_MS, {
          status: 'skipped',
          note,
          at: now.toISOString(),
        }).catch(() => {})
        continue
      }

      const note =
        err instanceof FleaflickerImportUnavailableError
          ? `provider unavailable (${err.status ?? 'no status'})`
          : err instanceof Error
            ? err.message.slice(0, 200)
            : 'sync failed'
      summary.failed++
      summary.results.push({ runKey, status: 'failed', note })
      await recordSyncState(cacheKey, FAILURE_RETRY_MS, {
        status: 'failed',
        note,
        at: now.toISOString(),
      }).catch(() => {})
    }
  }

  return summary
}
