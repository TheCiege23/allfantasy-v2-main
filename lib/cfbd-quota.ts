import { prisma } from '@/lib/prisma'

/**
 * How many CFBD calls this month has left, and whether a BACKGROUND job may spend them.
 *
 * 🛑 THE QUOTA RAN OUT TWICE WITH NOTHING WATCHING IT. On 2026-08-25, and again on 2026-11-10 at
 * ~12:00 UTC, every CFBD call began returning `429 {"message":"Monthly call quota exceeded."}`. After
 * the second wall, college game stats stopped at week 10: about 8,200 rows for week 10, 1 for
 * week 11. The stats import kept running every six hours and finishing in about a minute with
 * nothing to write. The devy feeds (pool, per-school stats, intel, draft status) share the same
 * key and the same 75,000-call month, and nothing stopped them spending the calls the stats and
 * scores imports needed.
 *
 * Two things here, both deliberately small:
 *
 * 1. `noteCfbdResponse` reads `x-calllimit-remaining` off every CFBD response. CFBD sends it on
 *    each call, including the 429. That is the only quota signal we have, and until now every
 *    caller threw it away.
 * 2. `cfbdBackgroundAllowed` tells a background job to stand down once fewer than
 *    `CFBD_BACKGROUND_RESERVE` calls remain, so what is left goes to the stats and scores imports.
 *    Those are `essential` and are never gated here: a stats import that stops itself is the
 *    outage this module exists to prevent.
 *
 * ⚠ FAIL OPEN. A quota we cannot read never blocks anything, because an unknown is not a wall. A
 * reading from an earlier UTC month is unknown too, since the allowance has reset since it was taken.
 *
 * Shared across processes through one `sportsDataCache` row (the worker runs two replicas), written
 * at most once a minute, and immediately when a reading crosses a warning line.
 */

const CACHE_KEY = 'cfbd:quota:v1'
const PERSIST_EVERY_MS = 60_000
/** A reading older than this is re-read from the shared row rather than trusted from memory. */
const MEMORY_FRESH_MS = 10 * 60_000

/** Calls kept back for the stats and scores imports. 20% of the 75,000-call plan in use on 2026-11-21. */
export const DEFAULT_BACKGROUND_RESERVE = 15_000
const WARN_AT = [15_000, 5_000, 1_000, 0]

export type CfbdQuotaReading = { remaining: number; observedAt: string }

let memory: CfbdQuotaReading | null = null
let lastPersistAt = 0
const warned = new Set<number>()

export function backgroundReserve(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.CFBD_BACKGROUND_RESERVE)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_BACKGROUND_RESERVE
}

/** Same UTC calendar month: CFBD's allowance is monthly. */
export function sameQuotaMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
}

/**
 * Pure: may a background job spend CFBD calls, given the latest reading?
 * Unknown, stale (an earlier month) or above the reserve → yes.
 */
export function decideBackground(args: {
  reading: CfbdQuotaReading | null
  reserve: number
  now: Date
}): { allowed: boolean; remaining: number | null; reason: string | null } {
  const r = args.reading
  if (!r) return { allowed: true, remaining: null, reason: null }
  const observed = new Date(r.observedAt)
  if (Number.isNaN(observed.getTime()) || !sameQuotaMonth(observed, args.now)) {
    return { allowed: true, remaining: null, reason: null }
  }
  if (r.remaining > args.reserve) return { allowed: true, remaining: r.remaining, reason: null }
  return {
    allowed: false,
    remaining: r.remaining,
    reason: `CFBD quota reserve: ${r.remaining} calls left this month, at or below the ${args.reserve} kept for stats and scores`,
  }
}

/** Parse the header. Null when absent or not a number, so a missing header never reads as 0. */
export function parseRemaining(headers: { get(name: string): string | null }): number | null {
  const raw = headers.get('x-calllimit-remaining')
  if (raw == null || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

/**
 * Record what a CFBD response says about the quota. Call it on EVERY CFBD response, success or not.
 * Synchronous for the caller: the shared write happens in the background and never throws.
 */
export function noteCfbdResponse(res: { status: number; headers?: { get(name: string): string | null } | null }, now = new Date()): void {
  // Never throws into a provider call: a test double or odd response without headers just records nothing.
  let remaining: number | null = null
  try {
    remaining = res?.headers && typeof res.headers.get === 'function' ? parseRemaining(res.headers) : null
  } catch {
    remaining = null
  }
  // A 429 with no header is still a wall for this month.
  if (remaining == null && res?.status === 429) remaining = 0
  if (remaining == null) return

  const previous = memory?.remaining ?? null
  memory = { remaining, observedAt: now.toISOString() }

  const crossed = WARN_AT.find((line) => remaining! <= line && (previous == null || previous > line) && !warned.has(line))
  if (crossed != null) {
    warned.add(crossed)
    console.warn(
      remaining === 0
        ? '[cfbd-quota] CFBD monthly quota is exhausted: every CFBD call will fail until it resets or the plan is raised.'
        : `[cfbd-quota] CFBD quota low: ${remaining} calls left this month. Background devy jobs stop at ${backgroundReserve()}.`,
    )
  }

  if (crossed != null || now.getTime() - lastPersistAt >= PERSIST_EVERY_MS) {
    lastPersistAt = now.getTime()
    const data = { remaining, observedAt: memory.observedAt }
    const expiresAt = new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000)
    try {
      void Promise.resolve(
        prisma.sportsDataCache.upsert({ where: { cacheKey: CACHE_KEY }, create: { cacheKey: CACHE_KEY, data, expiresAt }, update: { data, expiresAt } }),
      ).catch(() => undefined)
    } catch {
      /* A shared write must never break the provider call that produced the reading. */
    }
  }
}

/** `fetch`, plus `noteCfbdResponse`. For CFBD URLs only. */
export async function cfbdFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  noteCfbdResponse(res)
  return res
}

/** The latest reading: this process's if recent, else the shared row. Null when none is known. */
export async function readCfbdQuota(now = new Date()): Promise<CfbdQuotaReading | null> {
  if (memory && now.getTime() - new Date(memory.observedAt).getTime() < MEMORY_FRESH_MS) return memory
  try {
    const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: CACHE_KEY }, select: { data: true } })
    const d = row?.data as { remaining?: unknown; observedAt?: unknown } | null | undefined
    if (d && typeof d.remaining === 'number' && typeof d.observedAt === 'string') {
      const shared = { remaining: d.remaining, observedAt: d.observedAt }
      // Whichever is newer wins: another replica may have seen a later response.
      return !memory || shared.observedAt > memory.observedAt ? shared : memory
    }
  } catch {
    /* fail open */
  }
  return memory
}

/** May a BACKGROUND CFBD job run now? Essential imports (stats, scores) do not ask. */
export async function cfbdBackgroundAllowed(now = new Date()) {
  return decideBackground({ reading: await readCfbdQuota(now), reserve: backgroundReserve(), now })
}

/** Test seam only. */
export function __resetCfbdQuotaForTests(): void {
  memory = null
  lastPersistAt = 0
  warned.clear()
}
