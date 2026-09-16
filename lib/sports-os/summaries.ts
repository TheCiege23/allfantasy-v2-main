/**
 * Sports OS — point 4: screen-ready summaries, built after imports rather than per visit.
 *
 * A screen summary is the SHAPE A SCREEN RENDERS, not the rows it is derived from. `/core/standings`
 * should read one row that already says what each team's record is, not join four tables and reduce
 * them on every page view.
 *
 * Summaries are declared here and served through `layeredCache.readThrough`, which makes them
 * **read-through and self-populating**. That is the single most important property of this file, and
 * CLAUDE.md says why at length: `ingestCFBDStats` had no scheduled caller, so the columns a surface
 * had been pointed at were never refreshed, and it served nulls while looking correct. *"Pointing a
 * surface at a table nothing refreshes is worse than the live call it replaced."* Here a cold or
 * invalidated summary costs one rebuild on the next read. The event reactions in `./reactions.ts`
 * make that rebuild happen ahead of the visit; they are a latency win, not a correctness dependency.
 *
 * ⚠ A SUMMARY IS VERSIONED AND THE VERSION IS IN ITS CACHE KEY. Changing what `build` returns
 * without bumping `version` serves the OLD shape to a renderer expecting the new one, out of a cache
 * that has no idea anything changed — no error, no conflict, wrong screen.
 */

import { readThrough, invalidate, invalidatePrefix, type DurableCacheTier } from './layeredCache'
import type { Fresh } from './freshness'

/** What a summary is scoped to. Every field is optional; the key is built from what is present. */
export type SummaryScope = {
  leagueId?: string | null
  userId?: string | null
  seasonId?: string | null
  /** Period index — a week for NFL, a gameday elsewhere. Matches the event model's `period`. */
  period?: number | null
  sport?: string | null
  /**
   * Provider filter, for a screen whose answer narrows to one platform (`/core/career?platform=`).
   *
   * ⚠ APPENDED LAST IN `scopeKey` ON PURPOSE. `push` skips a null/undefined value entirely, so a
   * screen that does not set this emits the byte-identical key it emitted before this field existed
   * — which is what lets it be added without invalidating the four summaries already live.
   */
  platform?: string | null
}

export type ScreenSummaryDefinition<T = unknown> = {
  /** Matches the `/core/<screen>` segment, so a budget and a summary can be read under one name. */
  screen: string
  /** Bump whenever `build`'s RETURN SHAPE changes. It is part of the cache key. */
  version: number
  ttlMs: number
  /** How long past the TTL the previous summary may be served while the rebuild runs. */
  staleWhileRevalidateMs?: number
  build: (scope: SummaryScope) => Promise<T>
  /**
   * Domain event types that make this summary wrong. `./reactions.ts` turns an event into the set
   * of summaries to drop.
   */
  invalidatedBy: readonly string[]
  /**
   * Turn a domain event into the league key THIS screen's cache is scoped by. Defaults to the
   * event's own `leagueId`.
   *
   * 🛑 IT EXISTS BECAUSE A SCREEN'S CACHE KEY NEED NOT BE THE EVENT'S ID, AND STANDINGS IS EXACTLY
   * THAT CASE. A `DomainEvent` carries CANONICAL ids by contract (see `lib/events/types.ts`), so
   * its `leagueId` is our UUID — while the standings summary is keyed on the PROVIDER's league id,
   * because that is the id its underlying `WeeklyMatchup` rows use and the only one the sync has.
   * Without this hook the event-driven sweep would build a prefix out of the wrong id, match
   * nothing, and leave every board stale with nothing red anywhere.
   *
   * Typed structurally rather than against `DomainEvent` so this module stays free of the event
   * package.
   */
  leagueKeyForEvent?: (event: { leagueId: string | null }) => Promise<string | null> | string | null
}

const registry = new Map<string, ScreenSummaryDefinition<unknown>>()

export function registerScreenSummary<T>(definition: ScreenSummaryDefinition<T>): void {
  registry.set(definition.screen, definition as ScreenSummaryDefinition<unknown>)
}

export function getScreenSummaryDefinition(screen: string): ScreenSummaryDefinition<unknown> | null {
  return registry.get(screen) ?? null
}

export function registeredScreens(): string[] {
  return [...registry.keys()].sort()
}

/**
 * A bounded, deterministic key for a scope.
 *
 * ⚠ FIELD ORDER IS FIXED, NOT `Object.keys` ORDER. Two callers passing the same scope with the keys
 * written in a different order must land on ONE cache entry; iterating the object would give them
 * two, halving the hit rate in a way nothing would ever report.
 *
 * ⚠ EVERY FIELD ENDS WITH `&`, INCLUDING THE LAST ONE, AND THAT TRAILING SEPARATOR IS LOAD-BEARING.
 * It is what makes `summaryLeaguePrefix` safe: without it, the prefix `l=abc1` also matches
 * `l=abc10`, so invalidating one league would silently sweep another whose id merely starts the
 * same way. `scopeKeyStartsWithLeague` in the tests pins this.
 */
export function scopeKey(scope: SummaryScope): string {
  const parts: string[] = []
  const push = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined) return
    const raw = String(value).trim()
    if (!raw || raw.length > 64) return
    parts.push(`${label}=${raw}&`)
  }
  push('l', scope.leagueId)
  push('u', scope.userId)
  push('s', scope.seasonId)
  push('p', scope.period)
  push('sp', scope.sport ? String(scope.sport).toLowerCase() : null)
  /*
   * ⚠ LOWERCASED, LIKE `sport`, AND THE CASE-FOLD MUST MATCH WHAT THE BUILDER DOES WITH IT.
   * `getCareerData` normalises its filter with `.trim().toLowerCase() || null`; if the key folded
   * case and the builder did not, `?platform=Sleeper` and `?platform=sleeper` would share one entry
   * while meaning two different reads. They fold identically, so one entry is the correct answer.
   */
  push('pf', scope.platform ? String(scope.platform).toLowerCase() : null)
  return parts.length ? parts.join('') : 'global'
}

/** `sos:sum:<screen>:v<version>:<scope>`. The prefix is what `invalidateScreenSummary` sweeps. */
export function summaryCacheKey(screen: string, version: number, scope: SummaryScope): string {
  return `${summaryKeyPrefix(screen, version)}${scopeKey(scope)}`
}

export function summaryKeyPrefix(screen: string, version: number): string {
  return `sos:sum:${screen}:v${version}:`
}

export type ReadSummaryOptions = {
  durable?: DurableCacheTier | null
  forceRefresh?: boolean
  onRevalidateError?: (error: unknown) => void
}

/**
 * Read one screen's summary. Returns a `Fresh<T>`, so the caller always has the timestamp point 9
 * requires it to render.
 *
 * Throws only for an unregistered screen — a typo'd name must be loud, since the alternative is a
 * screen that silently renders nothing.
 */
export async function readScreenSummary<T>(
  screen: string,
  scope: SummaryScope,
  options: ReadSummaryOptions = {},
): Promise<Fresh<T>> {
  const definition = registry.get(screen)
  if (!definition) throw new Error(`No screen summary registered for "${screen}"`)
  return readThrough<T>({
    key: summaryCacheKey(screen, definition.version, scope),
    ttlMs: definition.ttlMs,
    staleWhileRevalidateMs: definition.staleWhileRevalidateMs,
    compute: () => definition.build(scope) as Promise<T>,
    durable: options.durable,
    forceRefresh: options.forceRefresh,
    onRevalidateError: options.onRevalidateError,
  })
}

/** Drop one scope's summary. */
export async function invalidateScreenSummary(
  screen: string,
  scope: SummaryScope,
  durable?: DurableCacheTier | null,
): Promise<void> {
  const definition = registry.get(screen)
  if (!definition) return
  await invalidate(summaryCacheKey(screen, definition.version, scope), durable)
}

/**
 * Drop EVERY scope of one screen's summary, in memory.
 *
 * ⚠ THE DURABLE TIER IS NOT SWEPT, and that is a deliberate limit rather than an oversight: a
 * prefix delete against Postgres or Redis is an unbounded write from whatever path called it. The
 * durable entries keep their own TTL and the memory tier is what a request reads first. If you need
 * a durable sweep, do it from a job.
 */
export function invalidateScreen(screen: string): number {
  const definition = registry.get(screen)
  if (!definition) return 0
  return invalidatePrefix(summaryKeyPrefix(screen, definition.version))
}

/**
 * The key prefix covering EVERY scope of one screen's summary for one league — all users, all
 * seasons, all periods.
 *
 * ⚠ THIS WORKS ONLY BECAUSE `leagueId` IS THE FIRST FIELD `scopeKey` EMITS, and only because every
 * field carries a trailing `&`. Both are asserted in the tests rather than left as a comment,
 * because a reordering would not fail anything else: the sweep would simply stop matching and the
 * cache would go on serving stale standings with nothing red.
 */
export function summaryLeaguePrefix(screen: string, version: number, leagueId: string): string {
  return `${summaryKeyPrefix(screen, version)}l=${leagueId}&`
}

/**
 * Drop every scope of one screen's summary for one league — the invalidation a writer performs when
 * it has just changed that league's underlying rows.
 *
 * ⚠ BOUNDED, UNLIKE `invalidateScreen`. This is why the durable tier CAN be swept here: the key
 * space is one league's members × seasons, not the whole table. `removePrefix` is optional on the
 * tier, and a tier without it simply keeps its entries until their own TTL — the read stays correct
 * either way, because a summary is read-through.
 *
 * Returns the number of MEMORY keys dropped. The durable count is not reported: the tier may not
 * support a prefix sweep at all, and a caller that treated 0 as failure would be wrong.
 */
export async function invalidateScreenForLeague(
  screen: string,
  leagueId: string,
  durable?: DurableCacheTier | null,
): Promise<number> {
  const definition = registry.get(screen)
  if (!definition || !leagueId) return 0
  const prefix = summaryLeaguePrefix(screen, definition.version, leagueId)
  const removed = invalidatePrefix(prefix)
  if (durable?.removePrefix) {
    try {
      await durable.removePrefix(prefix)
    } catch {
      // An invalidation that throws would fail the sync that triggered it. Memory is already
      // clear and the durable entries still carry their own TTL.
    }
  }
  return removed
}

/** Which registered screens an event type makes wrong. */
export function screensInvalidatedBy(eventType: string): string[] {
  const screens: string[] = []
  for (const [screen, definition] of registry) {
    if (definition.invalidatedBy.includes(eventType)) screens.push(screen)
  }
  return screens.sort()
}

/** Test seam. Never call from application code. */
export function __resetSummaryRegistryForTests(): void {
  registry.clear()
}
