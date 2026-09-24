import { clientIpFromHeaders } from '@/lib/http/clientIp'

const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

const WINDOW_MS = 60 * 1000
const MAX_REQUESTS = 5

/** Returns the current number of entries in the in-process rate-limit map (observability). */
export function getRateLimitMapSize(): number {
  return rateLimitMap.size
}

// ── Memory safety ─────────────────────────────────────────────────────────────
// Hard cap on the in-process map. On Vercel, a single function instance may
// serve thousands of requests before restarting. Without eviction the map
// grows without bound (one entry per unique scope:action:user[:ip] triplet).
const RATE_LIMIT_MAP_MAX_SIZE = 5_000

/**
 * Evict expired entries first; if the map is still over `maxSize`,
 * remove the entries whose window resets soonest (LRU approximation).
 * O(n) only when the map actually exceeds the cap — not on every call.
 */
function evictIfOversized(maxSize: number): void {
  if (rateLimitMap.size <= maxSize) return
  const now = Date.now()
  // Pass 1: delete entries whose window has already expired
  for (const [k, v] of rateLimitMap) {
    if (now > v.resetTime) rateLimitMap.delete(k)
    if (rateLimitMap.size <= maxSize) return
  }
  // Pass 2: still over limit — evict the 20% of entries with the lowest resetTime
  if (rateLimitMap.size > maxSize) {
    const entries = Array.from(rateLimitMap.entries())
      .sort((a, b) => a[1].resetTime - b[1].resetTime)
    const evictCount = Math.ceil(entries.length * 0.2)
    for (let i = 0; i < evictCount; i++) {
      rateLimitMap.delete(entries[i]![0])
    }
  }
}

// --- Backward-compatible helpers (do not remove) ---
export function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = rateLimitMap.get(ip)

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + WINDOW_MS })
    return true
  }

  if (record.count >= MAX_REQUESTS) {
    return false
  }

  record.count++
  return true
}

export function rateLimit(
  ip: string,
  maxRequests: number = MAX_REQUESTS,
  windowMs: number = WINDOW_MS
): { success: boolean; remaining: number } {
  const now = Date.now()
  const record = rateLimitMap.get(ip)

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs })
    return { success: true, remaining: maxRequests - 1 }
  }

  if (record.count >= maxRequests) {
    return { success: false, remaining: 0 }
  }

  record.count++
  return { success: true, remaining: maxRequests - record.count }
}

// --- New unified strategy ---
export type RateLimitResult = {
  success: boolean
  remaining: number
  retryAfterSec: number
  resetTimeMs: number
  key: string
}

function normalizeKeyPart(v: string) {
  return (v || '').trim().toLowerCase().replace(/\s+/g, '')
}

/**
 * Unified rate limiter that supports:
 * - per-user throttling (sleeper_username)
 * - optional IP bucketing (for abuse)
 * - per-endpoint configs
 */
export function consumeRateLimit(args: {
  scope: string // e.g. "legacy"
  action: string // e.g. "rank_refresh" | "share" | "ai_coach"
  sleeperUsername?: string | null
  ip?: string | null
  maxRequests: number
  windowMs: number
  // if true, include IP in the bucket key (stricter). default false because you asked "instead of IP"
  includeIpInKey?: boolean
}): RateLimitResult {
  const now = Date.now()
  const scope = normalizeKeyPart(args.scope)
  const action = normalizeKeyPart(args.action)

  const u = args.sleeperUsername ? normalizeKeyPart(args.sleeperUsername) : 'anonymous'
  const ip = args.ip ? normalizeKeyPart(args.ip) : 'unknown'

  // Per-user throttling is the primary strategy
  // Optionally include IP to deter automated abuse while still being "per user"
  const key = args.includeIpInKey
    ? `${scope}:${action}:user:${u}:ip:${ip}`
    : `${scope}:${action}:user:${u}`

  // Guard against unbounded growth on long-lived serverless instances
  evictIfOversized(RATE_LIMIT_MAP_MAX_SIZE)

  const max = Math.max(1, Math.floor(args.maxRequests))
  const windowMs = Math.max(1000, Math.floor(args.windowMs))

  const record = rateLimitMap.get(key)

  if (!record || now > record.resetTime) {
    const resetTimeMs = now + windowMs
    rateLimitMap.set(key, { count: 1, resetTime: resetTimeMs })
    return {
      success: true,
      remaining: max - 1,
      retryAfterSec: 0,
      resetTimeMs,
      key,
    }
  }

  if (record.count >= max) {
    const retryAfterSec = Math.max(0, Math.ceil((record.resetTime - now) / 1000))
    return {
      success: false,
      remaining: 0,
      retryAfterSec,
      resetTimeMs: record.resetTime,
      key,
    }
  }

  record.count++
  const remaining = Math.max(0, max - record.count)
  return {
    success: true,
    remaining,
    retryAfterSec: 0,
    resetTimeMs: record.resetTime,
    key,
  }
}

/** The client's address for keying a limit; the rule itself lives in lib/http/clientIp. */
export function getClientIp(req: Request) {
  return clientIpFromHeaders(req.headers) ?? 'unknown'
}

/** Convenience: convert rl into milliseconds remaining (for UI countdowns). */
export function getRetryAfterMs(rl: Pick<RateLimitResult, 'retryAfterSec'>) {
  const s = Number(rl?.retryAfterSec ?? 0)
  return Math.max(0, Math.floor(s * 1000))
}

/** Standardized 429 payload shape (shared by AI Coach + Share + Rank Refresh if you want). */
export function buildRateLimit429(args: {
  message?: string
  rl: RateLimitResult
}) {
  const msg = args.message || 'Cooldown active. Please wait and try again.'
  return {
    ok: false,
    success: false,
    error: 'COOLDOWN',
    message: msg,
    retryAfterSec: args.rl.retryAfterSec,
    retryAfterMs: getRetryAfterMs(args.rl),
    remaining: args.rl.remaining,
    resetTimeMs: args.rl.resetTimeMs,
  }
}

// Cleanup expired buckets.
// Interval is capped at 15 s so stale entries don't accumulate between calls
// to consumeRateLimit on low-traffic instances.
const EVICTION_INTERVAL_MS = Math.min(WINDOW_MS, 15_000)
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of rateLimitMap) {
    if (now > v.resetTime) rateLimitMap.delete(k)
  }
}, EVICTION_INTERVAL_MS).unref?.() // .unref() keeps the process from staying alive just for this timer
