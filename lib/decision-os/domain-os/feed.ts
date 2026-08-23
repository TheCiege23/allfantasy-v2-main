import 'server-only'

import { createOsStore, safeRead, safeWrite, type OsStore } from './store'
import type { OsDomain, OsFactEnvelope, OsScopeLevel } from './types'

/**
 * Domain OS kernel — the read-through feed.
 *
 * A domain declares WHAT it gathers (a kind, the level it lives at, its TTL, and how to derive it
 * live). The kernel handles the rest identically for every domain, so lineup / waiver / trade do
 * not each grow their own subtly different caching rules.
 *
 * Order is always: fresh stored fact → live derivation → null. Null is a real answer the callers
 * already handle: the fact loaders in this codebase degrade absence to uncertainty entries rather
 * than to zeros, which is why "unavailable" must never be flattened into "none".
 */

export interface OsFactSource<TArgs, TFacts> {
  /** Stable name for this fact family within its domain. */
  kind: string
  /** Which of app / league / user this fact is addressed at. */
  level: OsScopeLevel
  ttlMs: number
  /** How the fact is addressed within its level. Producer and consumer share this, so they cannot disagree. */
  scopeKey: (args: TArgs) => string
  /** The sport partition — kept alongside so a feed can be pruned or audited per sport. */
  sport: (args: TArgs) => string
  /** Derive the fact from source. MUST resolve null rather than throw when a source is unavailable. */
  derive: (args: TArgs) => Promise<TFacts | null>
  /** Optional honesty metadata, mirroring the app/league/user learning trio. */
  measure?: (facts: TFacts) => { confidence?: number | null; sampleSize?: number | null }
}

export interface OsFeedOutcome {
  servedFrom: 'store' | 'live' | 'unavailable'
  level: OsScopeLevel
  ageMs: number | null
  confidence: number | null
  sampleSize: number | null
}

export interface OsFeed {
  /** Read one fact family, preferring maintained state. Never throws. */
  get<TArgs, TFacts>(source: OsFactSource<TArgs, TFacts>, args: TArgs): Promise<TFacts | null>
  /** Populate one fact family without reading. This is the "gathering" half; it needs a scheduler. */
  refresh<TArgs, TFacts>(source: OsFactSource<TArgs, TFacts>, args: TArgs): Promise<'written' | 'unavailable'>
  /** How each family was sourced on this pass — for telemetry and for judging whether the feed earns its keep. */
  drainOutcomes(): Record<string, OsFeedOutcome>
}

export function createOsFeed(domain: OsDomain, deps: { store?: OsStore } = {}): OsFeed {
  const store = deps.store ?? createOsStore()
  const outcomes: Record<string, OsFeedOutcome> = {}

  async function put<TArgs, TFacts>(source: OsFactSource<TArgs, TFacts>, args: TArgs, facts: TFacts) {
    const m = source.measure?.(facts) ?? {}
    await safeWrite(store, {
      domain,
      kind: source.kind,
      level: source.level,
      scopeKey: source.scopeKey(args),
      sport: source.sport(args),
      facts,
      confidence: m.confidence ?? null,
      sampleSize: m.sampleSize ?? null,
    })
    return m
  }

  return {
    async get(source, args) {
      const scopeKey = source.scopeKey(args)
      const hit = await safeRead<never>(store, {
        domain, kind: source.kind, level: source.level, scopeKey, ttlMs: source.ttlMs,
      })
      if (hit) {
        outcomes[source.kind] = {
          servedFrom: 'store', level: source.level, ageMs: hit.ageMs,
          confidence: hit.confidence, sampleSize: hit.sampleSize,
        }
        return hit.facts as never
      }

      const live = await source.derive(args).catch(() => null)
      if (!live) {
        outcomes[source.kind] = {
          servedFrom: 'unavailable', level: source.level, ageMs: null, confidence: null, sampleSize: null,
        }
        // Never cache an unavailable result: that turns a transient source outage into a TTL-long
        // blackout, and "unavailable" is a fact about the SOURCE, not about the league.
        return null
      }

      const m = await put(source, args, live)
      outcomes[source.kind] = {
        servedFrom: 'live', level: source.level, ageMs: 0,
        confidence: m.confidence ?? null, sampleSize: m.sampleSize ?? null,
      }
      return live
    },

    async refresh(source, args) {
      const live = await source.derive(args).catch(() => null)
      if (!live) return 'unavailable'
      await put(source, args, live)
      return 'written'
    },

    drainOutcomes() {
      const copy = { ...outcomes }
      for (const k of Object.keys(outcomes)) delete outcomes[k]
      return copy
    },
  }
}

export type { OsFactEnvelope, OsScopeLevel, OsDomain }
