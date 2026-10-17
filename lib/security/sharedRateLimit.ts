/**
 * A fixed-window rate limit shared by every instance and surviving deploys.
 *
 * WHY. `lib/rate-limit.ts` is an in-process Map: each Railway replica keeps its
 * own counts, a deploy resets them all, and a 5k-entry cap evicts under load. For
 * a limit whose whole job is to stop password guessing, that is a speed bump —
 * spread attempts across replicas or wait for the next deploy and the budget
 * refills. This one counts in Upstash Redis (the same REST store session
 * revocation and the reset-code budget use).
 *
 * HOW. INCR first, then decide — never "read, then compare", which a parallel
 * burst walks straight through. An in-process counter is ALWAYS applied too and
 * the higher count wins, so a Redis outage degrades the limit to per-instance,
 * never to unlimited.
 */

const TIMEOUT_MS = 800
const local = new Map<string, { count: number; resetAt: number }>()
const LOCAL_CAP = 20_000

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  return url && token ? { url, token } : null
}

async function redis(args: (string | number)[]): Promise<unknown | undefined> {
  const cfg = redisConfig()
  if (!cfg) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) return undefined
    const json = (await res.json()) as { result?: unknown }
    return json.result
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

function consumeLocal(key: string, windowSec: number, now = Date.now()): number {
  const hit = local.get(key)
  if (!hit || hit.resetAt <= now) {
    if (local.size >= LOCAL_CAP) {
      for (const [k, v] of local) if (v.resetAt <= now) local.delete(k)
    }
    local.set(key, { count: 1, resetAt: now + windowSec * 1000 })
    return 1
  }
  hit.count += 1
  return hit.count
}

export type SharedRateLimitResult = { success: boolean; count: number }

/** Spend one unit of `key`'s budget. `success: false` once more than `max` were spent this window. */
export async function consumeSharedRateLimit(key: string, max: number, windowSec: number): Promise<SharedRateLimitResult> {
  const fullKey = `af:rl:${key}`
  const localCount = consumeLocal(fullKey, windowSec)
  const shared = await redis(["INCR", fullKey])
  const sharedCount = typeof shared === "number" ? shared : Number(shared)
  if (Number.isFinite(sharedCount) && sharedCount === 1) {
    await redis(["EXPIRE", fullKey, windowSec])
  }
  const count = Math.max(localCount, Number.isFinite(sharedCount) ? sharedCount : 0)
  return { success: count <= max, count }
}

/** Forget `key` — e.g. after a successful sign-in, so a user's own typos do not accumulate. */
export async function clearSharedRateLimit(key: string): Promise<void> {
  const fullKey = `af:rl:${key}`
  local.delete(fullKey)
  await redis(["DEL", fullKey])
}

export function __resetSharedRateLimitForTests(): void {
  local.clear()
}
