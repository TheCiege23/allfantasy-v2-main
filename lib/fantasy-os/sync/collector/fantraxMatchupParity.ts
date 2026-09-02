/**
 * Fantasy OS — Fantrax weekly-matchup parity collector.
 *
 * 🛑 FANTRAX LEAGUES HAD NO `WeeklyMatchup` WRITER OF ANY KIND, which is why a
 * Fantrax league home renders empty end to end: no current week ("we cannot tell
 * which week this league is in yet"), no scoreboard, no power board ("no week
 * has been scored yet"). Every one of those surfaces reads `WeeklyMatchup`, and
 * for Fantrax the table was simply never populated. The Sleeper path has
 * `ensureMatchupsCached`; ESPN and Yahoo got `externalMatchupParity`; Fantrax
 * got nothing.
 *
 * ⚠ IT IS A SEPARATE COLLECTOR FROM ESPN/YAHOO FOR ONE REASON: CREDENTIALS.
 * That collector's whole enumeration and retry structure exists to try each
 * importing user's stored cookies/OAuth in turn. The Fantrax `fxea` API is
 * unauthenticated, so every one of those branches would be dead code here. What
 * IS shared is the part that must never diverge — `applySchedule`, which defines
 * what a WeeklyMatchup row means.
 *
 * ⚠ THE ROSTER ID IS READ FROM `LeagueTeam`, NOT RECOMPUTED. It would be easy to
 * re-derive it from the live API with `assignFantraxTeamIds`, and that is the
 * subtle way to get this wrong: the import computes ids over the SNAPSHOT's team
 * set, and a live read could see a slightly different set and land one team on a
 * different number. Every reader joins `WeeklyMatchup.rosterId` to
 * `Number(LeagueTeam.externalId)`, so `LeagueTeam` is the authority and this
 * maps onto it by name. A team that cannot be mapped is DROPPED, never numbered
 * by guess — a wrong roster id files somebody else's week under your team.
 */
import { prisma } from '@/lib/prisma'
import { applySchedule, type ScheduleWeekInput } from './externalMatchupParity'
import {
  fetchFantraxScheduleWithScores,
  getFantraxLeagueInfo,
} from '@/lib/league-import/fantrax/fantraxApi'
import { normalizeFantraxTeamName } from '@/lib/league-import/fantrax/fantraxTeamIds'

const CACHE_KEY_PREFIX = 'fantrax_matchup_sync'
/** Fantrax costs one request per played period, so refresh less often than Sleeper. */
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
const FAILURE_RETRY_MS = 30 * 60 * 1000

export interface FantraxMatchupConnection {
  /** `League.platformLeagueId` — for Fantrax this is the `FantraxLeague` row's uuid. */
  platformLeagueId: string
  /** Fantrax's own league id, the only thing the API can be called with. */
  sourceLeagueId: string
  season: number
  leagueName: string | null
}

export interface FantraxMatchupLeagueResult {
  runKey: string
  status: 'synced' | 'skipped' | 'failed' | 'not_due'
  note?: string
  weeksWritten?: number
  weeksUnchanged?: number
}

export interface FantraxMatchupParityResult {
  enumerated: number
  synced: number
  skipped: number
  failed: number
  notDue: number
  results: FantraxMatchupLeagueResult[]
}

/**
 * Every Fantrax league that names a Fantrax league id.
 *
 * ⚠ A ROW WITH NO `sourceLeagueId` IS SKIPPED SILENTLY AND THAT IS CORRECT.
 * Fantrax was a CSV upload before it was an API client; those snapshots were
 * never given a league id by anyone and there is nothing to backfill from. They
 * are permanently un-refreshable, which is a real state rather than an error.
 */
export async function enumerateFantraxMatchupConnections(): Promise<FantraxMatchupConnection[]> {
  const snapshots = await prisma.fantraxLeague.findMany({
    where: { sourceLeagueId: { not: null } },
    select: { id: true, sourceLeagueId: true, season: true, leagueName: true },
    orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }],
  })
  if (snapshots.length === 0) return []

  /*
   * Only snapshots that actually became a League — `platformLeagueId` is the
   * join key every WeeklyMatchup reader uses, so a snapshot with no League row
   * has nothing to write against.
   */
  const leagues = await prisma.league.findMany({
    where: { platform: 'fantrax', platformLeagueId: { in: snapshots.map((s) => s.id) } },
    select: { platformLeagueId: true, season: true },
  })
  const seasonByPlatformId = new Map(leagues.map((l) => [l.platformLeagueId, l.season]))

  const out: FantraxMatchupConnection[] = []
  const seen = new Set<string>()
  for (const snap of snapshots) {
    if (!seasonByPlatformId.has(snap.id)) continue
    if (seen.has(snap.id)) continue
    seen.add(snap.id)
    out.push({
      platformLeagueId: snap.id,
      sourceLeagueId: String(snap.sourceLeagueId),
      season: seasonByPlatformId.get(snap.id) ?? snap.season,
      leagueName: snap.leagueName,
    })
  }
  return out
}

/**
 * Fantrax team name → the roster id `LeagueTeam` already holds.
 *
 * Returns null when the league has no numeric team ids at all, which means the
 * backfill (`scripts/backfill-fantrax-team-ids.ts`) has not run for it. Writing
 * rows in that state would produce a scoreboard whose every team is unnameable,
 * so the league is skipped with a note that says exactly that.
 */
async function readRosterIdsByTeamName(
  leaguePlatformId: string,
): Promise<Map<string, number> | null> {
  const teams = await prisma.leagueTeam.findMany({
    where: { league: { platformLeagueId: leaguePlatformId } },
    select: { externalId: true, teamName: true, ownerName: true },
  })
  const map = new Map<string, number>()
  for (const t of teams) {
    const roster = Number(String(t.externalId ?? '').trim())
    if (!Number.isInteger(roster) || roster < 0) continue
    const label = normalizeFantraxTeamName(t.teamName?.trim() || t.ownerName?.trim() || '')
    if (!label) continue
    map.set(label, roster)
  }
  return map.size > 0 ? map : null
}

function cacheKeyFor(connection: FantraxMatchupConnection): string {
  return `${CACHE_KEY_PREFIX}:${connection.sourceLeagueId}:${connection.season}`
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
  /* ⚠ FAILS OPEN. An unreadable cadence row must not stop a league syncing
     forever — the worst case is one extra read, and the alternative is a league
     that goes quiet with nothing reporting why. */
  if (!row?.expiresAt) return true
  return row.expiresAt.getTime() <= now.getTime()
}

export async function runFantraxMatchupParity(input?: {
  now?: Date
  /** Bound the tick: each league costs one request per played period. Default 3. */
  maxLeagues?: number
}): Promise<FantraxMatchupParityResult> {
  const now = input?.now ?? new Date()
  const maxLeagues = input?.maxLeagues ?? 3

  const connections = await enumerateFantraxMatchupConnections()
  const summary: FantraxMatchupParityResult = {
    enumerated: connections.length,
    synced: 0,
    skipped: 0,
    failed: 0,
    notDue: 0,
    results: [],
  }

  let budget = maxLeagues
  for (const connection of connections) {
    const runKey = `fantrax:${connection.sourceLeagueId}:${connection.season}`
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

    /* Per-league isolation, mirroring runExternalMatchupParity: one league's
       failure never blocks another's. */
    try {
      budget--

      const rosterIds = await readRosterIdsByTeamName(connection.platformLeagueId)
      if (!rosterIds) {
        const note =
          'no numeric LeagueTeam ids for this league — run scripts/backfill-fantrax-team-ids.ts'
        summary.skipped++
        summary.results.push({ runKey, status: 'skipped', note })
        await recordSyncState(cacheKey, FAILURE_RETRY_MS, { status: 'skipped', note })
        continue
      }

      const info = await getFantraxLeagueInfo(connection.sourceLeagueId)
      if (!info.ok) {
        const note = info.failure.message
        summary.skipped++
        summary.results.push({ runKey, status: 'skipped', note })
        await recordSyncState(cacheKey, FAILURE_RETRY_MS, { status: 'skipped', note })
        continue
      }

      const fetched = await fetchFantraxScheduleWithScores(connection.sourceLeagueId, info.data, {
        now,
      })

      /*
       * ⚠ ONLY WEEKS WITH A RESULT ARE WRITTEN.
       *
       * `applySchedule` coerces a missing score to 0, because for Sleeper/ESPN/
       * Yahoo an unplayed week legitimately bootstraps as a 0-0 placeholder. For
       * Fantrax that would be actively wrong: `currentWeek` resolves to the
       * earliest week carrying an unscored row, and every reader treats
       * `pointsFor === 0 && pointsAgainst === 0` as unplayed anyway — so a
       * future fixture written as 0-0 is indistinguishable from a real result of
       * zero, which is the exact ambiguity `played` was added to remove. Unplayed
       * fixtures are simply not written; the week appears when it has a score.
       */
      const byWeek = new Map<number, ScheduleWeekInput>()
      for (const row of fetched.rows) {
        if (!row.played || row.awayScore == null || row.homeScore == null) continue
        const away = rosterIds.get(normalizeFantraxTeamName(row.awayTeam))
        const home = rosterIds.get(normalizeFantraxTeamName(row.homeTeam))
        if (away == null || home == null) continue
        let week = byWeek.get(row.week)
        if (!week) {
          week = { week: row.week, season: connection.season, matchups: [] }
          byWeek.set(row.week, week)
        }
        week.matchups.push({
          teamId1: String(away),
          teamId2: String(home),
          points1: row.awayScore,
          points2: row.homeScore,
        })
      }

      const schedule = Array.from(byWeek.values()).sort((a, b) => a.week - b.week)
      if (schedule.length === 0) {
        const note =
          fetched.position?.state === 'preseason'
            ? `season has not started (period ${fetched.position.period} is first)`
            : 'no scored week is available for this league yet'
        summary.skipped++
        summary.results.push({ runKey, status: 'skipped', note })
        await recordSyncState(cacheKey, SYNC_INTERVAL_MS, { status: 'skipped', note })
        continue
      }

      const { weeksWritten, weeksUnchanged } = await applySchedule(
        (id) => {
          const n = Number(id)
          return Number.isInteger(n) && n >= 0 ? n : null
        },
        connection.platformLeagueId,
        schedule,
      )

      summary.synced++
      summary.results.push({ runKey, status: 'synced', weeksWritten, weeksUnchanged })
      await recordSyncState(cacheKey, SYNC_INTERVAL_MS, {
        status: 'synced',
        weeksWritten,
        weeksUnchanged,
        periodsRead: fetched.periodsRead,
        periodsFailed: fetched.periodsFailed,
      })
    } catch (err) {
      const note = err instanceof Error ? err.message : String(err)
      summary.failed++
      summary.results.push({ runKey, status: 'failed', note })
      await recordSyncState(cacheKey, FAILURE_RETRY_MS, { status: 'failed', note }).catch(() => {})
    }
  }

  return summary
}
