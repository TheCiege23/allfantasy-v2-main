/**
 * Fantasy OS — MFL weekly-matchup parity collector.
 *
 * 🛑 MFL WAS THE LAST PROVIDER WITH NO `WeeklyMatchup` WRITER, and unlike the
 * others it was not an oversight — it was blocked on a real identity problem,
 * documented at length in `lib/import-os/collector/index.ts`. MFL franchise ids
 * are ZERO-PADDED strings ("0001"). `WeeklyMatchup.rosterId` was an `Int`, so
 * `Number('0001')` became `1` and `String(1)` became `"1"`, which never matches
 * `LeagueTeam.externalId` ("0001") again. A writer built on that column would
 * have written rows that LOOKED right and that no reader could resolve — the
 * failure this repo records for `ingestCFBDStats`: silent, and correct-looking.
 *
 * ✅ THAT BLOCKER IS GONE. `rosterId` has been TEXT in production since
 * 2026-09-03 (verified 2026-09-12 against `information_schema`, not against the
 * migration's own header: `data_type=text`, 49,180 rows, all four indexes
 * intact). `schema.prisma` declares `String`, and `applySchedule` takes one. So
 * this collector writes the padded id VERBATIM and the join works.
 *
 * ⚠ THEREFORE: NEVER NORMALISE, PAD OR UNPAD A FRANCHISE ID IN THIS FILE.
 * Every other provider's collector validates its id as an integer and
 * canonicalises through `String(Number(x))`, because ESPN/Yahoo/Fantrax ids are
 * plain unpadded integers and that strips incidental whitespace harmlessly. Copy
 * that here and you reintroduce exactly the bug this writer waited nine days to
 * be able to avoid. `"0001"` must reach the database as `"0001"`.
 *
 * ⚠ AND IDENTITY COMES FROM `LeagueTeam`, NOT FROM MFL'S RESPONSE. The schedule
 * names franchises; `LeagueTeam.externalId` is what every reader joins on. A
 * side whose franchise id has no `LeagueTeam` row is DROPPED rather than
 * written on trust — a wrong roster id files somebody else's week under your
 * team, and nothing downstream can tell.
 *
 * ⚠ CREDENTIALS, WHICH IS WHY THIS IS SHAPED LIKE `externalMatchupParity` AND
 * NOT LIKE THE FANTRAX/FLEAFLICKER ONES. MFL needs an API key per importing
 * user, so a league can only be read through a user who has one. Each importing
 * user is tried in turn and a league with no working credential is SKIPPED with
 * an honest note — never guessed at. What IS shared with all three is
 * `applySchedule`, which defines what a `WeeklyMatchup` row MEANS and must never
 * fork.
 *
 * ⚠ ONLY PLAYED WEEKS ARE WRITTEN, the same decision the Fantrax and Fleaflicker
 * collectors document. `applySchedule` coerces a missing score to 0, every
 * reader treats 0-0 as unplayed, and `currentWeek` resolves to the earliest
 * unscored week — so a future fixture written as 0-0 is indistinguishable from a
 * real nil-all result. MFL makes this cleanly decidable: `extractMflMatchupSides`
 * leaves `score` UNDEFINED for an unplayed side rather than zero, so a week is
 * written only when both sides carry a finite number.
 */
import { prisma } from '@/lib/prisma'
import { applySchedule, type ScheduleWeekInput } from './externalMatchupParity'
import { fetchMflScheduleForSync } from '@/lib/league-import/mfl/MflLeagueFetchService'

const CACHE_KEY_PREFIX = 'mfl_matchup_sync'
/** One request per league, but credential probing is not free — refresh every 6h in season. */
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
const FAILURE_RETRY_MS = 30 * 60 * 1000
/** Bound credential probes per league; a league can have many importing users. */
const MAX_USER_CANDIDATES = 3

export interface MflMatchupConnection {
  /** `League.platformLeagueId` — MFL's own league id. */
  platformLeagueId: string
  season: number
  /** Importing users whose stored MFL credentials may unlock the league, in import order. */
  userIds: string[]
}

export interface MflMatchupLeagueResult {
  runKey: string
  status: 'synced' | 'skipped' | 'failed' | 'not_due'
  note?: string
  weeksWritten?: number
  weeksUnchanged?: number
}

export interface MflMatchupParityResult {
  enumerated: number
  synced: number
  skipped: number
  failed: number
  notDue: number
  results: MflMatchupLeagueResult[]
}

/**
 * Latest imported season per MFL league, with every same-season mirror's user
 * collected as a credential candidate.
 */
export async function enumerateMflMatchupConnections(): Promise<MflMatchupConnection[]> {
  const rows = await prisma.league.findMany({
    where: { platform: 'mfl', platformLeagueId: { not: '' } },
    select: { platformLeagueId: true, season: true, userId: true },
    orderBy: [{ season: 'desc' }, { createdAt: 'asc' }],
  })

  const byLeague = new Map<string, MflMatchupConnection>()
  for (const row of rows) {
    const platformLeagueId = String(row.platformLeagueId ?? '').trim()
    if (!platformLeagueId) continue
    const existing = byLeague.get(platformLeagueId)
    if (!existing) {
      byLeague.set(platformLeagueId, {
        platformLeagueId,
        season: row.season,
        userIds: [row.userId],
      })
    } else if (existing.season === row.season && !existing.userIds.includes(row.userId)) {
      existing.userIds.push(row.userId)
    }
  }
  return Array.from(byLeague.values())
}

/**
 * The franchise ids `LeagueTeam` already holds for this league, VERBATIM.
 *
 * 🛑 NO TRIMMING OF LEADING ZEROS, NO `Number()`, NO CANONICALISATION. This set is
 * compared against what MFL returns, and both sides must stay in MFL's own id
 * space for the comparison to mean anything. `.trim()` removes surrounding
 * whitespace only — it cannot alter "0001".
 *
 * Returns null when the league has no teams at all: writing matchup rows then
 * produces a scoreboard whose every team is unnameable, which is worse than the
 * empty board it replaces.
 */
async function readKnownFranchiseIds(platformLeagueId: string): Promise<Set<string> | null> {
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

function cacheKeyFor(connection: MflMatchupConnection): string {
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
  /* ⚠ FAILS OPEN, like every sibling collector: an unreadable cadence row must not
     stop a league syncing forever. Worst case is one extra read; the alternative is
     a league that goes quiet with nothing reporting why. */
  if (!row?.expiresAt) return true
  return row.expiresAt.getTime() <= now.getTime()
}

/** A finite number, or null. Never coerces `undefined` to 0 — see the header. */
function scoreOf(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Fetch the schedule through the first importing user whose credentials work.
 *
 * ⚠ ANY error from a candidate moves on to the next, rather than only a typed
 * connection error. `getMflAuthForUser` throws several shapes for "this user has
 * no usable MFL credential", and the cost of being wrong in each direction is
 * asymmetric: trying one more user is one request, while treating a
 * credential problem as a hard failure retires a live league. The last message
 * is kept so the skip note says something true rather than "unknown".
 *
 * ⚠ NEVER LOG THE URL OR THE ERROR'S FULL BODY. `buildMflEndpointUrl` puts
 * `APIKEY` in the query string, so a naive log leaks a credential — the same
 * trap this repo records for Rolling Insights' `RSC_token`.
 */
async function fetchScheduleWithCandidates(
  connection: MflMatchupConnection,
): Promise<{ schedule: ScheduleWeekInput[] } | { skipNote: string }> {
  const candidates = connection.userIds.slice(0, MAX_USER_CANDIDATES)
  let lastNote: string | null = null

  for (const userId of candidates) {
    try {
      const { schedule } = await fetchMflScheduleForSync(
        userId,
        connection.platformLeagueId,
        connection.season,
      )
      return {
        schedule: schedule.map((w) => ({
          week: w.week,
          season: w.season,
          matchups: w.matchups.map((m) => ({
            teamId1: m.franchiseId1,
            teamId2: m.franchiseId2,
            points1: m.points1,
            points2: m.points2,
          })),
        })),
      }
    } catch (err) {
      lastNote = err instanceof Error ? err.message.slice(0, 160) : 'credential probe failed'
      continue
    }
  }
  return { skipNote: lastNote ?? 'no importing user with working MFL credentials' }
}

export async function runMflMatchupParity(input?: {
  now?: Date
  /** Bound the tick: each league costs one credentialed request. Default 3. */
  maxLeagues?: number
}): Promise<MflMatchupParityResult> {
  const now = input?.now ?? new Date()
  const maxLeagues = input?.maxLeagues ?? 3

  const connections = await enumerateMflMatchupConnections()
  const summary: MflMatchupParityResult = {
    enumerated: connections.length,
    synced: 0,
    skipped: 0,
    failed: 0,
    notDue: 0,
    results: [],
  }

  let budget = maxLeagues
  for (const connection of connections) {
    const runKey = `mfl:${connection.platformLeagueId}:${connection.season}`
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

    /* Per-league isolation, mirroring every sibling: one league's failure never
       blocks another's. */
    try {
      budget--

      const knownIds = await readKnownFranchiseIds(connection.platformLeagueId)
      if (!knownIds) {
        const note = 'no LeagueTeam rows for this league — import it before syncing matchups'
        summary.skipped++
        summary.results.push({ runKey, status: 'skipped', note })
        await recordSyncState(cacheKey, FAILURE_RETRY_MS, { status: 'skipped', note })
        continue
      }

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

      /*
       * Keep only weeks where BOTH sides scored and BOTH map to a known franchise.
       * A one-sided pairing is dropped whole: a row against nobody renders a
       * matchup with an unnameable opponent.
       */
      const schedule: ScheduleWeekInput[] = []
      for (const week of fetched.schedule) {
        const matchups = week.matchups.filter((m) => {
          if (!knownIds.has(m.teamId1) || !knownIds.has(m.teamId2)) return false
          return scoreOf(m.points1) != null && scoreOf(m.points2) != null
        })
        if (matchups.length > 0) schedule.push({ ...week, matchups })
      }

      if (schedule.length === 0) {
        const note = 'no played week available for this league yet'
        summary.skipped++
        summary.results.push({ runKey, status: 'skipped', note })
        await recordSyncState(cacheKey, SYNC_INTERVAL_MS, {
          status: 'skipped',
          note,
          at: now.toISOString(),
        })
        continue
      }

      const { weeksWritten, weeksUnchanged } = await applySchedule(
        /*
         * 🛑 IDENTITY, DELIBERATELY — the one place every other collector coerces.
         * The id has already been checked against `LeagueTeam` above, and any
         * transformation here would undo the whole reason this writer could
         * finally be built. `"0001"` in, `"0001"` out.
         */
        (id) => (id ? id : null),
        connection.platformLeagueId,
        schedule,
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
      const note = err instanceof Error ? err.message.slice(0, 200) : 'sync failed'
      summary.failed++
      summary.results.push({ runKey, status: 'failed', note })
      await recordSyncState(cacheKey, FAILURE_RETRY_MS, { status: 'failed', note }).catch(() => {})
    }
  }

  return summary
}
