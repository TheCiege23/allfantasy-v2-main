import 'server-only'

import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { HOURS } from '../domain-os/types'
import { loadMarketValues } from '../value/marketAdapter'
import { loadDevyValues } from '../value/devyAdapter'
import type { ValueLookup } from '../value/contract'

/**
 * Value OS — maintained fact state for player valuations (2.5).
 *
 * ⚠ FEEDS Decision OS. `lib/commissioner-ui/*` points the other way.
 *
 * 2.2 built three adapters and 2.3 registered the domain, and for a while NOTHING WIRED THEM
 * INTO A FEED — the adapters were callable but outside the kernel, which is the
 * seam-with-no-consumer pattern the plan has criticised three times. This closes that.
 *
 * ── 🛑 TWO SOURCES, NOT THREE, AND THE OMISSION IS THE INTERESTING PART ─────────────────────
 * A source is cacheable only if its `derive` is satisfiable from its OWN scope key. That is the
 * rule 1.1b had to retrofit onto Waiver OS and Trade OS after both declared `level: 'league'` and
 * derived user-specific facts, and it is cheaper to obey than to unpick.
 *
 *   ✅ market  app level, keyed sport:format:qbFormat. Global by construction.
 *   ✅ devy    app level, keyed sport. Global by construction.
 *   ❌ IDP + KICKER — NOT A SOURCE HERE, deliberately.
 *
 * `loadIdpKickerValues` is parameterised by `rosterPlayerIds`: it prices a ROSTER, not a board.
 * A scope key would have to encode the roster set, so every roster move invalidates it and two
 * managers in one league share nothing — a cache entry per (league × roster × week) that is
 * almost always cold. And the values are league-derived, so filing them at app level would price
 * one league's linebackers for everybody, which `domain-os/types.ts` already warns about.
 *
 * Call `loadIdpKickerValues` directly. It is cheap relative to what caching it would cost, and an
 * honest absence beats a cache entry that is wrong for whoever did not populate it.
 */

/**
 * Market prices. 6h, because the writer is daily.
 *
 * `ingestPlayerValues` runs from `/api/cron/adp-refresh` at 10:00 UTC, so anything shorter than a
 * few hours re-derives a row that provably has not moved. 6h keeps at most a quarter-day of lag on
 * a fact that changes once a day.
 */
export type MarketValueArgs = { sport: string; format: string; qbFormat: string }

export const marketValueSource: OsFactSource<MarketValueArgs, ValueLookup[]> = {
  kind: 'market',
  level: 'app',
  ttlMs: 6 * HOURS,
  scopeKey: (a) => `${a.sport}:${a.format}:${a.qbFormat}`,
  sport: (a) => a.sport,
  derive: async (a) => {
    const r = await loadMarketValues(a).catch(() => [])
    // An empty array is not a fact. Returning it would cache "no market exists" for 6h over a
    // transient failure, and `createOsFeed` deliberately never caches an unavailable result.
    return r.length > 0 ? r : null
  },
}

/**
 * Devy board. 12h — slower-moving than the market and more expensive to build.
 *
 * The board is derived from the whole `DevyPlayer` pool on every call, and its inputs (pool seed,
 * stats, intel, Fantrax ADP) refresh on the 6-hourly import-players cadence at best.
 */
export type DevyValueArgs = { sport: string; currentSeason: number }

export const devyValueSource: OsFactSource<DevyValueArgs, ValueLookup[]> = {
  kind: 'devy',
  level: 'app',
  ttlMs: 12 * HOURS,
  scopeKey: (a) => `${a.sport}:${a.currentSeason}`,
  sport: (a) => a.sport,
  derive: async (a) => {
    const r = await loadDevyValues(a).catch(() => [])
    return r.length > 0 ? r : null
  },
}

export function createValueOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('value', deps)
}

/**
 * Read-through loaders.
 *
 * ⚠ BOTH ARE SCHEDULABLE — app-level, long TTL, derive satisfiable from the scope key alone — so
 * unlike League OS's 60s ruleset these ARE legitimate `refresh()` targets for
 * `/api/cron/domain-os-refresh`. They are not wired into it yet: that cron walks LEAGUES and these
 * are keyed on sport+format, so it needs a second walk rather than a bigger list. Named here so
 * the next person does not have to rediscover that the shapes differ.
 */
export function createValueOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createValueOs(deps)
  return {
    loadMarket: (a: MarketValueArgs) => feed.get(marketValueSource, a),
    loadDevy: (a: DevyValueArgs) => feed.get(devyValueSource, a),
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

export const valueOsSources = [marketValueSource, devyValueSource] as const
