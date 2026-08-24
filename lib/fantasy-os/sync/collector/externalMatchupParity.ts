/**
 * Fantasy OS — ESPN/Yahoo weekly-matchup parity collector.
 *
 * The durable Sleeper collector fills `WeeklyMatchup` through
 * `ensureMatchupsCached`; ESPN and Yahoo leagues had NO writer at all, so every
 * WeeklyMatchup-backed surface (week board, matchup views, season outlook)
 * silently rendered empty for them while every reader joins on the PLATFORM
 * league id. This collector writes the SAME shape: `leagueId` =
 * `League.platformLeagueId`, `rosterId` = the provider's numeric team id (the
 * ESPN team id; the `.t.<n>` tail of a Yahoo team key), `matchupId` = the
 * pairing's 1-based index within its week (synthesized, consistent for both
 * rows of a pairing), and 0-0 placeholder rows for unplayed weeks — the exact
 * conventions of `lib/rankings-engine/sleeper-matchup-cache`.
 *
 * Credentials are per importing user (ESPN cookies for private leagues, Yahoo
 * OAuth always). Each mirror row's user is tried in turn; a league with no
 * working credentials is SKIPPED with an honest note — never guessed at.
 *
 * Cadence state lives in `SportsDataCache` under
 * `external_matchup_sync:<provider>:<externalLeagueId>:<season>` — no schema
 * change. Per-league error isolation mirrors `runDueSleeperLeagues`: one
 * league's failure never blocks another, and stable enumeration order plus the
 * per-league TTL rotates the portfolio across heartbeats.
 */
import { prisma } from '@/lib/prisma'
import { resolveCadence, isInSeason } from '@/lib/fantasy-os/sync/season'
import {
  EspnImportConnectionError,
  EspnImportLeagueNotFoundError,
  fetchEspnScheduleForSync,
} from '@/lib/league-import/espn/EspnLeagueFetchService'
import {
  fetchYahooWeeklyMatchupsForSync,
  YahooImportConnectionError,
  YahooImportLeagueNotFoundError,
} from '@/lib/league-import/yahoo/YahooLeagueFetchService'

const CACHE_KEY_PREFIX = 'external_matchup_sync'
/** Full provider reads are heavier than Sleeper's keyless burst — refresh each league every 6h in season, not every 30min. */
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
/** After an unexpected failure retry sooner, without hammering the provider. */
const FAILURE_RETRY_MS = 30 * 60 * 1000
/** Bound credential probes per league (a league can have many importing users). */
const MAX_USER_CANDIDATES = 3

export type ExternalMatchupProvider = 'espn' | 'yahoo'

export interface ExternalMatchupConnection {
  provider: ExternalMatchupProvider
  /** The provider's league id — ESPN numeric id / Yahoo league key. Matches `League.platformLeagueId`. */
  externalLeagueId: string
  season: number
  sport: string
  /** Importing users whose stored credentials may unlock the league, in import order. */
  userIds: string[]
}

export interface ExternalMatchupLeagueResult {
  runKey: string
  status: 'synced' | 'skipped' | 'failed' | 'not_due'
  note?: string
  weeksWritten?: number
  weeksUnchanged?: number
}

export interface ExternalMatchupParityResult {
  enumerated: number
  synced: number
  skipped: number
  failed: number
  notDue: number
  results: ExternalMatchupLeagueResult[]
}

/**
 * Latest imported season per (provider, externalLeagueId) — older seasons are
 * frozen history and never refetched — with every same-season mirror's user id
 * collected as a credential candidate.
 */
export async function enumerateExternalMatchupConnections(): Promise<ExternalMatchupConnection[]> {
  const rows = await prisma.league.findMany({
    where: {
      platform: { in: ['espn', 'yahoo'] },
      platformLeagueId: { not: '' },
    },
    select: { platform: true, platformLeagueId: true, season: true, sport: true, userId: true },
    orderBy: [{ season: 'desc' }, { createdAt: 'asc' }],
  })

  const byLeague = new Map<string, ExternalMatchupConnection>()
  for (const row of rows) {
    const provider = row.platform as ExternalMatchupProvider
    const externalLeagueId = String(row.platformLeagueId ?? '').trim()
    if (!externalLeagueId) continue
    const key = `${provider}:${externalLeagueId}`
    const existing = byLeague.get(key)
    if (!existing) {
      byLeague.set(key, {
        provider,
        externalLeagueId,
        season: row.season,
        sport: String(row.sport),
        userIds: [row.userId],
      })
    } else if (existing.season === row.season && !existing.userIds.includes(row.userId)) {
      existing.userIds.push(row.userId)
    }
  }
  return Array.from(byLeague.values())
}

/**
 * Provider team id → WeeklyMatchup.rosterId. ESPN team ids are numeric
 * strings; Yahoo team keys carry the numeric id after `.t.`. Anything
 * non-numeric is rejected (the row is dropped, never invented).
 */
function toRosterId(provider: ExternalMatchupProvider, sourceTeamId: string): number | null {
  const raw = provider === 'yahoo' ? sourceTeamId.split('.t.')[1] ?? '' : sourceTeamId
  const n = Number(String(raw).trim())
  return Number.isInteger(n) && n >= 0 ? n : null
}

type ScheduleWeekInput = {
  week: number
  season: number
  matchups: Array<{ teamId1: string; teamId2: string; points1?: number; points2?: number }>
}

/**
 * Idempotent per-week apply. Same row semantics as the Sleeper writer
 * (`sleeper-matchup-cache`): an unplayed side is 0-0, win = pointsFor >
 * pointsAgainst. A week whose stored rows already match is left untouched;
 * a changed week is replaced whole (delete + createMany), mirroring
 * `refreshWeekCache`.
 */
async function applySchedule(
  provider: ExternalMatchupProvider,
  externalLeagueId: string,
  schedule: ScheduleWeekInput[]
): Promise<{ weeksWritten: number; weeksUnchanged: number }> {
  let weeksWritten = 0
  let weeksUnchanged = 0

  for (const weekEntry of schedule) {
    const rows: Array<{
      rosterId: number
      matchupId: number
      pointsFor: number
      pointsAgainst: number
      win: number
    }> = []
    weekEntry.matchups.forEach((m, index) => {
      const roster1 = toRosterId(provider, m.teamId1)
      const roster2 = toRosterId(provider, m.teamId2)
      if (roster1 == null || roster2 == null) return
      const p1 = typeof m.points1 === 'number' && Number.isFinite(m.points1) ? m.points1 : 0
      const p2 = typeof m.points2 === 'number' && Number.isFinite(m.points2) ? m.points2 : 0
      const matchupId = index + 1
      rows.push({ rosterId: roster1, matchupId, pointsFor: p1, pointsAgainst: p2, win: p1 > p2 ? 1 : 0 })
      rows.push({ rosterId: roster2, matchupId, pointsFor: p2, pointsAgainst: p1, win: p2 > p1 ? 1 : 0 })
    })
    if (rows.length === 0) continue

    const existing = await prisma.weeklyMatchup.findMany({
      where: { leagueId: externalLeagueId, seasonYear: weekEntry.season, week: weekEntry.week },
      select: { rosterId: true, matchupId: true, pointsFor: true, pointsAgainst: true, win: true },
    })
    const byRoster = new Map(existing.map((r) => [r.rosterId, r]))
    const unchanged =
      existing.length === rows.length &&
      rows.every((r) => {
        const prev = byRoster.get(r.rosterId)
        return (
          prev != null &&
          prev.matchupId === r.matchupId &&
          Math.abs(prev.pointsFor - r.pointsFor) < 0.005 &&
          Math.abs(prev.pointsAgainst - r.pointsAgainst) < 0.005 &&
          prev.win === r.win
        )
      })
    if (unchanged) {
      weeksUnchanged++
      continue
    }

    await prisma.weeklyMatchup.deleteMany({
      where: { leagueId: externalLeagueId, seasonYear: weekEntry.season, week: weekEntry.week },
    })
    await prisma.weeklyMatchup.createMany({
      data: rows.map((r) => ({
        leagueId: externalLeagueId,
        seasonYear: weekEntry.season,
        week: weekEntry.week,
        ...r,
      })),
      skipDuplicates: true,
    })
    weeksWritten++
  }

  return { weeksWritten, weeksUnchanged }
}

function cacheKeyFor(connection: ExternalMatchupConnection): string {
  return `${CACHE_KEY_PREFIX}:${connection.provider}:${connection.externalLeagueId}:${connection.season}`
}

async function recordSyncState(
  cacheKey: string,
  ttlMs: number,
  data: Record<string, unknown>
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    update: { data: data as object, expiresAt },
    create: { cacheKey, data: data as object, expiresAt },
  })
}

/**
 * Fetch the league's weekly schedule, trying each importing user's stored
 * credentials in turn. A connection error (missing/expired cookies or OAuth)
 * moves on to the next candidate; running out of candidates returns an honest
 * skip note. A not-found is a skip too. Anything else throws to the caller's
 * per-league isolation.
 */
async function fetchScheduleWithCandidates(
  connection: ExternalMatchupConnection
): Promise<{ schedule: ScheduleWeekInput[] } | { skipNote: string }> {
  const candidates = connection.userIds.slice(0, MAX_USER_CANDIDATES)
  let lastConnectionNote: string | null = null

  for (const userId of candidates) {
    try {
      if (connection.provider === 'espn') {
        const schedule = await fetchEspnScheduleForSync(
          userId,
          connection.externalLeagueId,
          connection.season
        )
        return { schedule }
      }
      const { schedule } = await fetchYahooWeeklyMatchupsForSync(userId, connection.externalLeagueId)
      return {
        schedule: schedule.map((week) => ({
          week: week.week,
          season: week.season,
          matchups: week.matchups.map((m) => ({
            teamId1: m.teamKey1,
            teamId2: m.teamKey2,
            points1: m.points1,
            points2: m.points2,
          })),
        })),
      }
    } catch (err) {
      if (err instanceof EspnImportConnectionError || err instanceof YahooImportConnectionError) {
        // This user's stored credentials don't unlock the league — try the next mirror's user.
        lastConnectionNote = err.message
        continue
      }
      if (err instanceof EspnImportLeagueNotFoundError || err instanceof YahooImportLeagueNotFoundError) {
        return { skipNote: err.message }
      }
      throw err
    }
  }
  return { skipNote: lastConnectionNote ?? 'no importing user with working credentials' }
}

export async function runExternalMatchupParity(input?: {
  now?: Date
  /** Max leagues to actually sync this tick — full provider reads are heavier than Sleeper's. Default 3. */
  maxLeagues?: number
}): Promise<ExternalMatchupParityResult> {
  const now = input?.now ?? new Date()
  const maxLeagues = input?.maxLeagues ?? 3
  const connections = await enumerateExternalMatchupConnections()

  const summary: ExternalMatchupParityResult = {
    enumerated: connections.length,
    synced: 0,
    skipped: 0,
    failed: 0,
    notDue: 0,
    results: [],
  }

  let executed = 0
  for (const connection of connections) {
    if (executed >= maxLeagues) break
    const runKey = `${connection.provider}:${connection.externalLeagueId}:${connection.season}`

    // Season gate per league sport: only NFL has a calendar today, so non-NFL
    // leagues resolve to 'unknown' and are skipped honestly, never guessed.
    const { state } = resolveCadence({ sport: connection.sport, provider: connection.provider, now })
    if (!isInSeason(state)) {
      summary.notDue++
      summary.results.push({ runKey, status: 'not_due', note: `season state ${state}` })
      continue
    }

    const cacheKey = cacheKeyFor(connection)
    const cached = await prisma.sportsDataCache.findUnique({
      where: { cacheKey },
      select: { expiresAt: true },
    })
    if (cached && cached.expiresAt.getTime() > now.getTime()) {
      summary.notDue++
      summary.results.push({ runKey, status: 'not_due' })
      continue
    }

    executed++
    try {
      const fetched = await fetchScheduleWithCandidates(connection)
      if ('skipNote' in fetched) {
        summary.skipped++
        summary.results.push({ runKey, status: 'skipped', note: fetched.skipNote })
        await recordSyncState(cacheKey, SYNC_INTERVAL_MS, {
          status: 'skipped',
          note: fetched.skipNote,
          at: now.toISOString(),
        })
        continue
      }
      const { weeksWritten, weeksUnchanged } = await applySchedule(
        connection.provider,
        connection.externalLeagueId,
        fetched.schedule
      )
      summary.synced++
      summary.results.push({ runKey, status: 'synced', weeksWritten, weeksUnchanged })
      await recordSyncState(cacheKey, SYNC_INTERVAL_MS, {
        status: 'synced',
        weeksWritten,
        weeksUnchanged,
        at: now.toISOString(),
      })
    } catch (err) {
      // Per-league isolation: one league's failure never blocks the rest.
      const note = err instanceof Error ? err.message.slice(0, 200) : 'sync failed'
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
