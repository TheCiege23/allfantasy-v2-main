import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"

/** The subset of PrismaClient the Postgres lock path uses. Injectable so tests (and workers with their own
 *  client) can exercise the REAL lock code against a specific database. Defaults to the singleton. */
type LockPrisma = Pick<typeof prisma, "automationLock" | "$transaction">
const singleton = () => prisma as unknown as LockPrisma

export type AutomationLockAcquireResult =
  | { ok: true; backend: "redis" | "postgres" }
  | { ok: false; reason: string }

export type AutomationLockOptions = {
  /** Owner id (e.g. hostname, invocation id, random UUID per execution). */
  owner: string
  /** Milliseconds until lock expires (TTL). */
  ttlMs: number
  metadata?: Prisma.InputJsonValue
}

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

async function upstashRedisCommand(args: (string | number)[]): Promise<unknown> {
  if (!REDIS_URL || !REDIS_TOKEN) return null
  try {
    const res = await fetch(REDIS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { result?: unknown }
    return json.result ?? null
  } catch {
    return null
  }
}

async function acquireRedisLock(
  lockKey: string,
  owner: string,
  ttlSeconds: number
): Promise<boolean | null> {
  if (!REDIS_URL || !REDIS_TOKEN) return null
  const fullKey = `af:auto:${lockKey}`
  const result = await upstashRedisCommand(["SET", fullKey, owner, "NX", "EX", ttlSeconds])
  if (result === null) return null
  return result === "OK"
}

async function releaseRedisLock(lockKey: string, owner: string): Promise<void> {
  const fullKey = `af:auto:${lockKey}`
  const current = await upstashRedisCommand(["GET", fullKey])
  if (typeof current === "string" && current === owner) {
    await upstashRedisCommand(["DEL", fullKey])
  }
}

/**
 * Distributed lock — prefers Upstash Redis REST; falls back to `AutomationLock` in Postgres.
 * Safe when Redis is misconfigured: errors route to DB without crashing the request.
 */
export async function acquireAutomationLock(
  lockKey: string,
  options: AutomationLockOptions,
  db: LockPrisma = singleton()
): Promise<AutomationLockAcquireResult> {
  const ttlMs = Math.max(1, options.ttlMs)
  const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000))

  if (REDIS_URL && REDIS_TOKEN) {
    const redisResult = await acquireRedisLock(lockKey, options.owner, ttlSeconds)
    if (redisResult === true) return { ok: true, backend: "redis" }
    if (redisResult === false) return { ok: false, reason: "Lock held (redis)" }
  }

  const expiresAt = new Date(Date.now() + ttlMs)
  try {
    const outcome = await db.$transaction(async (tx) => {
      const existing = await tx.automationLock.findUnique({
        where: { lockKey },
      })
      const now = new Date()
      if (existing && existing.expiresAt > now) {
        if (existing.owner === options.owner) {
          await tx.automationLock.update({
            where: { lockKey },
            data: {
              expiresAt,
              metadata: options.metadata ?? undefined,
            },
          })
          return "acquired" as const
        }
        return "busy" as const
      }
      if (existing) {
        await tx.automationLock.delete({ where: { lockKey } })
      }
      await tx.automationLock.create({
        data: {
          lockKey,
          owner: options.owner,
          expiresAt,
          metadata: options.metadata ?? undefined,
        },
      })
      return "acquired" as const
    })

    if (outcome === "busy") {
      return { ok: false, reason: "Lock held (postgres)" }
    }
    return { ok: true, backend: "postgres" }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: `Postgres lock error: ${msg}` }
  }
}

/**
 * Owner-scoped renewal — extends the lease ONLY if `owner` still holds it and it has not expired. Doubles as a
 * heartbeat (keep a long-running holder alive) AND a fence (`ok:false` means ownership was lost — the caller
 * must stop touching shared state). A former owner can never renew a successor's lease: the WHERE clause matches
 * on owner AND unexpired, so once a successor has replaced the row the old owner's renewal affects 0 rows.
 */
export async function renewAutomationLock(
  lockKey: string,
  options: AutomationLockOptions,
  db: LockPrisma = singleton()
): Promise<{ ok: true; backend: "redis" | "postgres" } | { ok: false; reason: string }> {
  const ttlMs = Math.max(1, options.ttlMs)

  if (REDIS_URL && REDIS_TOKEN) {
    // Only the current owner may renew (compare-then-extend).
    const fullKey = `af:auto:${lockKey}`
    const current = await upstashRedisCommand(["GET", fullKey])
    if (current !== null) {
      if (current !== options.owner) return { ok: false, reason: "Lock owned by another (redis)" }
      const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000))
      await upstashRedisCommand(["SET", fullKey, options.owner, "XX", "EX", ttlSeconds])
      return { ok: true, backend: "redis" }
    }
    // Redis key gone (expired/evicted) → fall through to Postgres, which is the source of truth here.
  }

  const expiresAt = new Date(Date.now() + ttlMs)
  try {
    const affected = await db.automationLock.updateMany({
      where: { lockKey, owner: options.owner, expiresAt: { gt: new Date() } },
      data: { expiresAt, metadata: options.metadata ?? undefined },
    })
    if (affected.count === 1) return { ok: true, backend: "postgres" }
    return { ok: false, reason: "Lease lost (not owner or expired)" }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: `Postgres renew error: ${msg}` }
  }
}

export async function releaseAutomationLock(
  lockKey: string,
  owner: string,
  db: LockPrisma = singleton()
): Promise<void> {
  if (REDIS_URL && REDIS_TOKEN) {
    await releaseRedisLock(lockKey, owner)
  }

  await db.automationLock
    .deleteMany({
      where: { lockKey, owner },
    })
    .catch(() => undefined)
}

export async function withAutomationLock<T>(
  lockKey: string,
  options: AutomationLockOptions,
  fn: () => Promise<T>,
  db: LockPrisma = singleton()
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  const acquired = await acquireAutomationLock(lockKey, options, db)
  if (!acquired.ok) return acquired

  try {
    const value = await fn()
    return { ok: true, value }
  } finally {
    await releaseAutomationLock(lockKey, options.owner, db)
  }
}
