import 'server-only'

import { createHash } from 'node:crypto'
import {
  formatAgo,
  formatCountdown,
  getDash34Data,
  type Dash34LeagueRow,
  type Dash34Result,
} from '@/lib/core-app/dash34'
import {
  getCrossLeagueExposure,
  getRivalRecords,
  type ExposureData,
  type PanelState,
  type RivalsData,
} from '@/lib/core-app/dash3aPanels'
import { toPlayedLeagues } from '@/lib/core-app/playedLeagues'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { readThrough, type DurableCacheTier } from '@/lib/sports-os/layeredCache'
import { invalidateScreenSummary, registerScreenSummary, summaryCacheKey } from '@/lib/sports-os/summaries'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'
import type { FreshnessSource } from '@/lib/sports-os/freshness'

/**
 * The /core home's portfolio summaries — prebuilt per-user records instead of re-joining every
 * league, roster and result on every render (the general-view brief, item 4, 2026-09-16).
 *
 * THREE RECORDS, ONE RULEBOOK. Each is the whole-portfolio result of one of the home's
 * cross-league joins, stored as a Sports OS screen summary (`lib/sports-os/summaries.ts`):
 *   home-portfolio  `getDash34Data` — claimed teams, rosters, every rostered player's identity, and
 *                   every one of them matched against the injury feed in memory. Also read by the
 *                   tab badges on EVERY other /core screen, which re-ran the whole join every ten
 *                   minutes per user to read two counts.
 *   home-exposure   `getCrossLeagueExposure` — the same claims and rosters again, plus identities.
 *   home-rivals     `getRivalRecords` — every team in every league, and every `WeeklyMatchup` row
 *                   the user's leagues have ever had.
 *
 * ⚠ THREE RECORDS, NOT ONE, BECAUSE THE HOME STREAMS. Each card waits only for its own read
 * (components/core-app/home/HomeCards.tsx). One record holding all three would make the exposure
 * card wait for the injury match on every cold read — the regression the streaming work removed.
 *
 * HOW EACH STAYS RIGHT. Read-through: a missing, expired or invalidated record costs one rebuild on
 * the next read, never a blank or wrong card. On top of the TTL, on EVERY read:
 *   1. The league list's FINGERPRINT (`portfolioFingerprint`) — every field the joins read from the
 *      rows, `lastSyncedAt` included. A new import, a removed league and a finished sync each change
 *      it, so the next render rebuilds without any writer having to remember to invalidate.
 *   2. A crossed TIME BOUNDARY (home-portfolio only) — the kickoff it counts down to, or a game in
 *      its next-24-hours list, has started.
 *   3. NOW-RELATIVE TEXT is recomputed from the stored instants (home-portfolio only): the countdown
 *      and every "reported 30 min ago".
 *
 * 🛑 A BUILD THAT SAW A FAILED READ IS SERVED, NEVER STORED. Every one of these joins degrades
 * instead of throwing — a failed roster read renders as "no empty slots", a failed injury read as
 * "nobody hurt", a failed matchup read as "no meetings yet". For the one render that shows it that
 * is the existing behaviour; cached, it would repeat a transient outage for the whole TTL and
 * stale-while-revalidate window. The joins report every such read (`onReadError`), and a build that
 * got one is handed to this reader but never written to either tier.
 *
 * ⚠ THE WHOLE PORTFOLIO ONLY. A scoped home (lib/core-app/homeScope.ts) reads its joins live: the
 * result for a subset of leagues is not a filter of the whole one, and a scoped render must never
 * write whole-portfolio state.
 *
 * ⚠ JSON-PLAIN, ALWAYS. The durable tier stores JSON and the memory tier stores the object as given.
 * A `Date` in a record would come back as a `Date` from memory and as a string from Postgres — two
 * shapes from one key, depending on which replica answered. Every build is round-tripped first.
 */

export const HOME_PORTFOLIO_SCREEN = 'home-portfolio'
export const HOME_EXPOSURE_SCREEN = 'home-exposure'
export const HOME_RIVALS_SCREEN = 'home-rivals'
/**
 * Bump on ANY change to `StoredSummary` or to a record's data shape — it is in the cache key.
 * v2: the envelope field was renamed `result` → `data` when the exposure and rivals records joined.
 */
export const HOME_PORTFOLIO_VERSION = 2
export const HOME_EXPOSURE_VERSION = 1
export const HOME_RIVALS_VERSION = 2
export const HOME_PORTFOLIO_TTL_MS = 3 * 60_000
export const HOME_PORTFOLIO_SWR_MS = 10 * 60_000
/**
 * Rival records only change when a week's results are ingested, so they are held longer. The
 * fingerprint still rebuilds them the moment a sync moves a league's `lastSyncedAt`.
 */
export const HOME_RIVALS_TTL_MS = 10 * 60_000

/**
 * ⚠ A DURABLE READ SLOWER THAN THIS IS A MISS. Measured by the league-view session from Sentry
 * (7 days, `/core` home renders): renders whose slowest query was `SportsDataCache.findUnique` had
 * a p75 slowest-query time of 1,903 ms, against 205 ms for the one sampled `dash34` card. A cache
 * that can take longer than the work it saves is not a cache, so the durable tier gets a deadline
 * and the join runs instead.
 */
export const DURABLE_READ_TIMEOUT_MS = 300

export type StoredSummary<T> = {
  fingerprint: string
  data: T
}

export type PortfolioSummaryMeta = {
  /** When the record was built, ISO. */
  builtAt: string
  /** `live` — built for this read; `cache` — inside its TTL; `last-known` — past it, rebuilding behind. */
  source: FreshnessSource
}

/** A join, told how to report a read that failed and fell back to empty. */
export type SummaryCompute<T> = (rows: Dash34LeagueRow[], onReadError: () => void) => Promise<T>

export type ReadSummaryDeps<T> = {
  /** `null` disables the durable tier (tests). Defaults to the bounded `SportsDataCache` tier. */
  durable?: DurableCacheTier | null
  compute?: SummaryCompute<T>
}

/* ── Pure pieces ──────────────────────────────────────────────────────────────────────────────── */

/** The fields of a league row the joins read — the fingerprint is exactly their input. */
const FINGERPRINT_FIELDS = [
  'id',
  'name',
  'platform',
  'sport',
  'season',
  'scoring',
  'leagueType',
  'isDynasty',
  'teamCount',
  'leagueSize',
  'status',
  'lifecycleState',
  'isCommissioner',
  'lastSyncedAt',
  'avatarUrl',
  'logoUrl',
  'platformLeagueId',
  'sleeperLeagueId',
  'hasUnifiedRecord',
] as const satisfies ReadonlyArray<keyof Dash34LeagueRow>

/**
 * A digest of everything the joins read from the league list, order-independent.
 *
 * ⚠ `lastSyncedAt` IS NORMALISED TO EPOCH MS. The list reaches here as `Date` objects from Prisma on
 * the page and could reach here as ISO strings from anywhere that serialized it; the same instant
 * must digest the same way or every read would look like a changed portfolio.
 */
export function portfolioFingerprint(rows: readonly Dash34LeagueRow[]): string {
  const normalised = rows
    .map((row) =>
      FINGERPRINT_FIELDS.map((field) => {
        const value = row[field]
        if (field === 'lastSyncedAt') {
          if (value == null) return null
          const ms = value instanceof Date ? value.getTime() : Date.parse(String(value))
          return Number.isNaN(ms) ? null : ms
        }
        return value ?? null
      }),
    )
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return createHash('sha256').update(JSON.stringify(normalised)).digest('hex').slice(0, 32)
}

function instant(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** Has time moved past something the stored portfolio was built around? */
export function crossedBoundary(result: Dash34Result, now: Date): boolean {
  const nowMs = now.getTime()
  const kickoff = instant(result.firstLock?.countdownTo ?? null)
  if (kickoff != null && kickoff <= nowMs) return true
  const briefKickoff = instant(result.chimmyBrief?.countdown?.to ?? null)
  if (briefKickoff != null && briefKickoff <= nowMs) return true
  for (const item of result.next24 ?? []) {
    const at = instant(item.time)
    if (at != null && at <= nowMs) return true
  }
  return false
}

/**
 * The stored portfolio with its now-relative text recomputed — the same formatters the loader uses,
 * so the server paint matches what the client tickers derive from the same instants.
 */
export function refreshRelative(result: Dash34Result, now: Date): Dash34Result {
  const nowMs = now.getTime()
  const kickoff = instant(result.firstLock?.countdownTo ?? null)
  const briefKickoff = instant(result.chimmyBrief?.countdown?.to ?? null)
  return {
    ...result,
    firstLock:
      result.firstLock && kickoff != null
        ? { ...result.firstLock, countdown: formatCountdown(kickoff - nowMs) }
        : result.firstLock,
    chimmyBrief:
      result.chimmyBrief?.countdown && briefKickoff != null
        ? {
            ...result.chimmyBrief,
            countdown: { ...result.chimmyBrief.countdown, initial: formatCountdown(briefKickoff - nowMs) },
          }
        : result.chimmyBrief,
    book: result.book
      ? result.book.map((row) => {
          const reported = instant(row.reportedAt ?? null)
          return reported == null ? row : { ...row, reportedAgo: formatAgo(nowMs - reported) }
        })
      : result.book,
  }
}

function jsonPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** The played leagues' ids — the shared rule (lib/core-app/playedLeagues.ts), the page's order. */
function playedIds(rows: readonly Dash34LeagueRow[]): string[] {
  return toPlayedLeagues(rows).map((row) => row.id)
}

/* ── The durable tier ─────────────────────────────────────────────────────────────────────────── */

/**
 * `SportsDataCache`, with a read deadline and a write that never holds the render.
 *
 * ⚠ THE WRITE IS NOT AWAITED BY THE READER. `readThrough` awaits the durable write before returning a
 * freshly built value, so a slow upsert of a portfolio-sized JSON row would sit in front of every
 * card that reads the record. The memory tier already holds the value; the durable copy is for the
 * other replica and the next deploy, and losing one write costs one rebuild.
 *
 * Removal stays awaited: an invalidation that reports success before the row is gone could let the
 * next read promote the row it was meant to drop.
 */
export function boundedDurableTier(
  inner: DurableCacheTier,
  readTimeoutMs: number = DURABLE_READ_TIMEOUT_MS,
): DurableCacheTier {
  return {
    async read(key) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), readTimeoutMs)
      })
      try {
        return await Promise.race([inner.read(key).catch(() => null), deadline])
      } finally {
        if (timer) clearTimeout(timer)
      }
    },
    async write(key, entry) {
      void inner.write(key, entry).catch(() => undefined)
    },
    remove: inner.remove ? (key) => inner.remove!(key) : undefined,
  }
}

let tier: DurableCacheTier | null = null
function summaryTier(): DurableCacheTier {
  return (tier ??= boundedDurableTier(sportsDataCacheTier()))
}

/* ── The summary factory ──────────────────────────────────────────────────────────────────────── */

/** Carries a build that saw a failed read out of `readThrough`, which stores whatever resolves. */
class IncompleteBuild<T> extends Error {
  constructor(readonly stored: StoredSummary<T>) {
    super('summary build saw a failed read; served, not stored')
  }
}

type SummarySpec<T> = {
  screen: string
  version: number
  ttlMs: number
  swrMs: number
  /** The whole-portfolio join, for one user. */
  compute: (userId: string) => SummaryCompute<T>
  /** A stored record that time has invalidated. */
  crossed?: (data: T, now: Date) => boolean
  /** The stored record as it should be served at `now`. */
  present?: (data: T, now: Date) => T
}

export type UserSummary<T> = {
  key: (userId: string) => string
  read: (
    userId: string,
    rows: readonly Dash34LeagueRow[],
    now?: Date,
    deps?: ReadSummaryDeps<T>,
  ) => Promise<{ data: T; meta: PortfolioSummaryMeta }>
  invalidate: (userId: string) => Promise<void>
}

function createUserSummary<T>(spec: SummarySpec<T>): UserSummary<T> {
  const key = (userId: string) => summaryCacheKey(spec.screen, spec.version, { userId })

  const buildFor =
    (rows: readonly Dash34LeagueRow[], compute: SummaryCompute<T>) => async (): Promise<StoredSummary<T>> => {
      let failed = false
      const data = await compute([...rows], () => {
        failed = true
      })
      const stored = jsonPlain({ fingerprint: portfolioFingerprint(rows), data })
      if (failed) throw new IncompleteBuild(stored)
      return stored
    }

  /*
   * Registered so the record has a name the Sports OS layer can invalidate and a job can warm. A
   * registered build only receives a scope, so it reads the league list itself; the home passes the
   * list it already holds through `read` instead, under the same key.
   */
  registerScreenSummary<StoredSummary<T>>({
    screen: spec.screen,
    version: spec.version,
    ttlMs: spec.ttlMs,
    staleWhileRevalidateMs: spec.swrMs,
    build: async (scope) => {
      const userId = scope.userId
      if (!userId) throw new Error(`${spec.screen} summary needs a userId scope`)
      const list = await getDashboardLeagueListForUser(userId)
      const rows = list.leagues as unknown as Dash34LeagueRow[]
      return buildFor(rows, spec.compute(userId))()
    },
    /*
     * None. The Sports OS reaction sweep is keyed by LEAGUE (`l=<id>&`) and these records by USER,
     * so a league sweep could never match one — listing events here would look like invalidation
     * and do nothing. They need none: a sync moves `lastSyncedAt`, which changes the fingerprint,
     * which rebuilds the record on its next read.
     */
    invalidatedBy: [],
  })

  const read: UserSummary<T>['read'] = async (userId, rows, now = new Date(), deps = {}) => {
    const durable = deps.durable === undefined ? summaryTier() : deps.durable
    const compute = deps.compute ?? spec.compute(userId)
    const fingerprint = portfolioFingerprint(rows)
    const build = buildFor(rows, compute)
    const present = (data: T) => (spec.present ? spec.present(data, now) : data)
    const live = (stored: StoredSummary<T>) => ({
      data: present(stored.data),
      meta: { builtAt: new Date().toISOString(), source: 'live' as const },
    })
    const usable = (stored: StoredSummary<T> | null | undefined): stored is StoredSummary<T> =>
      Boolean(stored && stored.fingerprint === fingerprint && stored.data !== undefined)

    const attempt = async (forceRefresh: boolean) => {
      try {
        const entry = await readThrough<StoredSummary<T>>({
          key: key(userId),
          ttlMs: spec.ttlMs,
          staleWhileRevalidateMs: spec.swrMs,
          compute: build,
          durable,
          forceRefresh,
        })
        return { entry, incomplete: null }
      } catch (error) {
        if (error instanceof IncompleteBuild) return { entry: null, incomplete: error.stored as StoredSummary<T> }
        throw error
      }
    }
    /** A build of THIS read's list, never stored. */
    const uncached = async () => {
      try {
        return live(await build())
      } catch (error) {
        if (error instanceof IncompleteBuild) return live(error.stored as StoredSummary<T>)
        throw error
      }
    }

    let outcome = await attempt(false)
    if (outcome.incomplete) return usable(outcome.incomplete) ? live(outcome.incomplete) : uncached()
    if (!usable(outcome.entry!.data) || spec.crossed?.(outcome.entry!.data.data, now)) {
      outcome = await attempt(true)
      if (outcome.incomplete) return usable(outcome.incomplete) ? live(outcome.incomplete) : uncached()
    }
    const entry = outcome.entry!
    /*
     * ⚠ A FORCED READ CAN JOIN ANOTHER REQUEST'S IN-FLIGHT BUILD — single-flight is per key, not per
     * fingerprint — and that build may be for a different league list. Such a record is never
     * served; this read builds its own, uncached.
     */
    if (!usable(entry.data)) return uncached()
    return {
      data: present(entry.data.data),
      meta: { builtAt: new Date(entry.fetchedAt).toISOString(), source: entry.source },
    }
  }

  const invalidate = async (userId: string) => {
    try {
      await invalidateScreenSummary(spec.screen, { userId }, summaryTier())
    } catch {
      // The TTL still bounds the record; an invalidation must never fail the write that triggered it.
    }
  }

  return { key, read, invalidate }
}

/* ── The three records ────────────────────────────────────────────────────────────────────────── */

export const homePortfolioSummary = createUserSummary<Dash34Result>({
  screen: HOME_PORTFOLIO_SCREEN,
  version: HOME_PORTFOLIO_VERSION,
  ttlMs: HOME_PORTFOLIO_TTL_MS,
  swrMs: HOME_PORTFOLIO_SWR_MS,
  compute: (userId) => (rows, onReadError) => getDash34Data(userId, rows, new Date(), { onReadError }),
  crossed: crossedBoundary,
  present: refreshRelative,
})

export const homeExposureSummary = createUserSummary<PanelState<ExposureData>>({
  screen: HOME_EXPOSURE_SCREEN,
  version: HOME_EXPOSURE_VERSION,
  ttlMs: HOME_PORTFOLIO_TTL_MS,
  swrMs: HOME_PORTFOLIO_SWR_MS,
  compute: (userId) => (rows, onReadError) => getCrossLeagueExposure(userId, playedIds(rows), 6, { onReadError }),
})

export const homeRivalsSummary = createUserSummary<PanelState<RivalsData>>({
  screen: HOME_RIVALS_SCREEN,
  version: HOME_RIVALS_VERSION,
  ttlMs: HOME_RIVALS_TTL_MS,
  swrMs: HOME_PORTFOLIO_SWR_MS,
  compute: (userId) => (rows, onReadError) => getRivalRecords(userId, playedIds(rows), 4, { onReadError }),
})

/* ── The readers the page uses ────────────────────────────────────────────────────────────────── */

export function homePortfolioKey(userId: string): string {
  return homePortfolioSummary.key(userId)
}

/**
 * The user's whole-portfolio `getDash34Data` result, for the league rows the caller already holds,
 * with where it came from. Rejects when the join rejects — the same failure the direct call had.
 */
export async function readHomePortfolio(
  userId: string,
  rows: readonly Dash34LeagueRow[],
  now: Date = new Date(),
  deps: ReadSummaryDeps<Dash34Result> = {},
): Promise<Dash34Result & { summary: PortfolioSummaryMeta }> {
  const { data, meta } = await homePortfolioSummary.read(userId, rows, now, deps)
  return { ...data, summary: meta }
}

/** The exposure card's panel, from its record. */
export async function readHomeExposure(
  userId: string,
  rows: readonly Dash34LeagueRow[],
  now: Date = new Date(),
  deps: ReadSummaryDeps<PanelState<ExposureData>> = {},
): Promise<PanelState<ExposureData>> {
  return (await homeExposureSummary.read(userId, rows, now, deps)).data
}

/** The rivalry card's panel, from its record. */
export async function readHomeRivals(
  userId: string,
  rows: readonly Dash34LeagueRow[],
  now: Date = new Date(),
  deps: ReadSummaryDeps<PanelState<RivalsData>> = {},
): Promise<PanelState<RivalsData>> {
  return (await homeRivalsSummary.read(userId, rows, now, deps)).data
}

/**
 * Drop one user's records — for a writer that knows the portfolio changed in a way the fingerprint
 * cannot see (a lineup set in-app, a claim) and wants the next read to rebuild rather than wait out
 * the TTL. Never throws.
 */
export async function invalidateHomePortfolio(userId: string): Promise<void> {
  await Promise.all([
    homePortfolioSummary.invalidate(userId),
    homeExposureSummary.invalidate(userId),
    homeRivalsSummary.invalidate(userId),
  ])
}

/*
 * ── Rollout ──
 *
 * No flag of its own. The page reads these records behind `sports-os.screen-summaries`, the flag the
 * standings and week summaries already share, bucketed on the same user id — so a user is wholly on
 * summaries or wholly off, never reading a cached portfolio beside a live week board. Two flags over
 * one home would be two experiments at once, and neither cleanly measurable.
 */
