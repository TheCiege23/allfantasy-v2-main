/**
 * 2C — Centralized, context-aware freshness. There is NO single global TTL and NO scattered per-route TTLs:
 * every reuse decision runs through this one policy table + classifier. Static/historical analysis stays
 * reusable for a long time; draft/waiver/lineup/matchup are short; injury/weather/live/game-day contexts are
 * `liveSensitive` — they are NEVER served stale, only recomputed. A version-tag change or a materially-changed
 * evidence fingerprint (folded into the identity key) invalidates reuse even before the wall-clock TTL.
 */
import type { FreshnessClass, IntelligenceRunRecord } from './types'

export type FreshnessPolicy = {
  /** Seconds a succeeded result is considered FRESH (immediately reusable). */
  ttlSeconds: number
  /** Seconds AFTER expiry a stale result may be served while a single refresh runs (0 = never serve stale). */
  staleWhileRevalidateSeconds: number
  /** Whether serving a stale result is ever allowed for this context. */
  allowStale: boolean
  /** Injury / live scoring / weather / game-day lineup — NEVER present stale as current. Forces allowStale=false. */
  liveSensitive: boolean
}

const DAY = 86_400
const HOUR = 3_600
const MIN = 60

/** Base policies keyed by a normalized decision bucket. */
const POLICY_TABLE: Record<string, FreshnessPolicy> = {
  // Live / urgent — never stale.
  live: { ttlSeconds: 2 * MIN, staleWhileRevalidateSeconds: 0, allowStale: false, liveSensitive: true },
  injury: { ttlSeconds: 2 * MIN, staleWhileRevalidateSeconds: 0, allowStale: false, liveSensitive: true },
  weather: { ttlSeconds: 5 * MIN, staleWhileRevalidateSeconds: 0, allowStale: false, liveSensitive: true },
  lineup: { ttlSeconds: 5 * MIN, staleWhileRevalidateSeconds: 0, allowStale: false, liveSensitive: true },
  start_sit: { ttlSeconds: 5 * MIN, staleWhileRevalidateSeconds: 0, allowStale: false, liveSensitive: true },
  // Time-sensitive but not live — short, no stale serving.
  waiver: { ttlSeconds: 10 * MIN, staleWhileRevalidateSeconds: 0, allowStale: false, liveSensitive: false },
  add_drop: { ttlSeconds: 10 * MIN, staleWhileRevalidateSeconds: 0, allowStale: false, liveSensitive: false },
  matchup: { ttlSeconds: 15 * MIN, staleWhileRevalidateSeconds: 5 * MIN, allowStale: true, liveSensitive: false },
  // Slower-moving analysis — stale-while-revalidate is safe.
  trade: { ttlSeconds: 30 * MIN, staleWhileRevalidateSeconds: 10 * MIN, allowStale: true, liveSensitive: false },
  commissioner: { ttlSeconds: 30 * MIN, staleWhileRevalidateSeconds: 10 * MIN, allowStale: true, liveSensitive: false },
  draft: { ttlSeconds: HOUR, staleWhileRevalidateSeconds: 15 * MIN, allowStale: true, liveSensitive: false },
  // Static / historical — reusable for a long time.
  static: { ttlSeconds: DAY, staleWhileRevalidateSeconds: HOUR, allowStale: true, liveSensitive: false },
  history: { ttlSeconds: DAY, staleWhileRevalidateSeconds: HOUR, allowStale: true, liveSensitive: false },
}

const DEFAULT_POLICY: FreshnessPolicy = {
  ttlSeconds: 15 * MIN,
  staleWhileRevalidateSeconds: 5 * MIN,
  allowStale: true,
  liveSensitive: false,
}

/** Ordered keyword → bucket matcher (first hit wins). Keeps live/urgent buckets ahead of slower ones. */
const KEYWORD_BUCKETS: Array<[RegExp, keyof typeof POLICY_TABLE]> = [
  [/injur/i, 'injury'],
  [/weather/i, 'weather'],
  [/live|in[_-]?game|game[_-]?day|score/i, 'live'],
  [/lineup|start[_-]?sit|start_sit/i, 'lineup'],
  [/waiver|add[_-]?drop|add_drop|pickup/i, 'waiver'],
  [/matchup/i, 'matchup'],
  [/trade/i, 'trade'],
  [/commish|commissioner|intervene|govern|fairness|collusion|integrity/i, 'commissioner'],
  [/draft/i, 'draft'],
  [/history|season[_-]?review|recap|static|archive/i, 'static'],
]

/** Resolve the freshness policy for a decision type (centralized — do not hardcode TTLs elsewhere). */
export function resolveFreshnessPolicy(decisionType: string): FreshnessPolicy {
  const key = String(decisionType || '').toLowerCase()
  if (POLICY_TABLE[key]) return POLICY_TABLE[key]
  for (const [re, bucket] of KEYWORD_BUCKETS) {
    if (re.test(key)) return POLICY_TABLE[bucket]
  }
  return DEFAULT_POLICY
}

/** Expiry timestamp for a freshly-computed result, or null when the policy has no TTL. */
export function computeExpiry(policy: FreshnessPolicy, now: Date): Date | null {
  if (!policy.ttlSeconds || policy.ttlSeconds <= 0) return null
  return new Date(now.getTime() + policy.ttlSeconds * 1000)
}

/**
 * Classify a stored run against the current version + policy. A live-sensitive expired result is a MISS
 * (recompute), never stale. A stuck running lease is a MISS so the caller can take over.
 */
export function classifyStoredRun(input: {
  run: IntelligenceRunRecord | null
  policy: FreshnessPolicy
  now: Date
  currentVersionTag: string
}): FreshnessClass {
  const { run, policy, now, currentVersionTag } = input
  if (!run) return 'miss'

  // Version invalidation dominates: a prompt/schema/orchestration bump makes older results unusable.
  if (run.versionTag !== currentVersionTag) return 'invalidated'
  if (run.status === 'invalidated') return 'invalidated'

  if (run.status === 'running') {
    const leaseLive = run.leaseExpiresAt != null && run.leaseExpiresAt.getTime() > now.getTime()
    return leaseLive ? 'running' : 'miss' // stuck lease → caller takes over
  }

  if (run.status === 'failed') {
    return run.retryable ? 'failed_retryable' : 'failed_terminal'
  }

  if (run.status === 'succeeded') {
    const notExpired = run.expiresAt == null || run.expiresAt.getTime() > now.getTime()
    if (notExpired) return 'fresh'
    // Expired. Live-sensitive or stale-disallowed → must recompute.
    if (policy.liveSensitive || !policy.allowStale) return 'miss'
    // Within the stale-while-revalidate window → serve stale (clearly marked) and refresh once.
    const swrBoundaryMs =
      (run.expiresAt?.getTime() ?? 0) + policy.staleWhileRevalidateSeconds * 1000
    return now.getTime() < swrBoundaryMs ? 'stale' : 'miss'
  }

  return 'miss' // pending or unknown
}
