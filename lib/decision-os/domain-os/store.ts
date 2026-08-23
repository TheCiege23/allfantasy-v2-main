import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'
import type { OsDomain, OsFactEnvelope, OsScopeLevel } from './types'

type PrismaLike = typeof defaultPrisma

/**
 * Domain OS kernel — the store.
 *
 * IT NEVER SERVES STALE FACTS, AND THAT IS THE ENTIRE SAFETY ARGUMENT.
 *
 * Maintained state that stops refreshing is worse than slow-but-fresh derivation, because it lies
 * with confidence instead of merely being slow. That risk is concrete here, not theoretical: every
 * scheduled job in this repo is currently dead, so a store designed to be topped up by a cron would
 * quietly serve month-old facts and look healthy doing it.
 *
 * So a feed is an ACCELERATOR, never a source of record. Past its TTL an entry is reported as
 * absent and the caller derives live. The worst case is exactly the behaviour we already have, and
 * there is no case where a decision is made on data the system believes is fresher than it is.
 *
 * Expiry is enforced on READ, never by a sweeper — a sweeper that stops running would leave expired
 * rows servable, which is the one failure this design refuses to have.
 */

export interface OsStore {
  read<T>(args: {
    domain: OsDomain
    kind: string
    level: OsScopeLevel
    scopeKey: string
    ttlMs: number
  }): Promise<OsFactEnvelope<T> | null>

  write(args: {
    domain: OsDomain
    kind: string
    level: OsScopeLevel
    scopeKey: string
    sport: string
    facts: unknown
    confidence?: number | null
    sampleSize?: number | null
  }): Promise<void>
}

function delegateOf(db: PrismaLike) {
  return (db as unknown as {
    domainOsFacts?: {
      findUnique(args: unknown): Promise<Record<string, unknown> | null>
      upsert(args: unknown): Promise<unknown>
    }
  }).domainOsFacts
}

/**
 * The production store.
 *
 * Every method degrades to "no cached facts" on any failure. A cache that throws is worse than no
 * cache: it converts an accelerator into a new way for a decision to fail, and the fact loaders it
 * fronts are documented as never throwing.
 */
export function createOsStore(db: PrismaLike = defaultPrisma): OsStore {
  return {
    async read({ domain, kind, level, scopeKey, ttlMs }) {
      const delegate = delegateOf(db)
      // Absent until the migration is applied — callers fall through rather than crash.
      if (!delegate) return null
      try {
        const row = await delegate.findUnique({
          where: { domain_kind_level_scopeKey: { domain, kind, level, scopeKey } },
        })
        if (!row) return null
        const capturedAt = row.capturedAt as Date | undefined
        if (!capturedAt) return null
        const ageMs = Date.now() - capturedAt.getTime()
        if (ageMs > ttlMs) return null
        return {
          facts: row.facts as never,
          level,
          confidence: (row.confidence as number | null) ?? null,
          sampleSize: (row.sampleSize as number | null) ?? null,
          capturedAt,
          ageMs,
        }
      } catch {
        return null
      }
    },

    async write({ domain, kind, level, scopeKey, sport, facts, confidence, sampleSize }) {
      const delegate = delegateOf(db)
      if (!delegate) return
      try {
        const data = {
          sport,
          facts: facts ?? undefined,
          confidence: confidence ?? null,
          sampleSize: sampleSize ?? null,
          capturedAt: new Date(),
        }
        await delegate.upsert({
          where: { domain_kind_level_scopeKey: { domain, kind, level, scopeKey } },
          create: { domain, kind, level, scopeKey, ...data },
          update: data,
        })
      } catch {
        // Populating the cache must never fail the caller that produced the facts.
      }
    },
  }
}

/** Guarded access, so a feed's safety is a property of THIS seam and not of one store implementation. */
export async function safeRead<T>(
  store: OsStore,
  args: Parameters<OsStore['read']>[0],
): Promise<OsFactEnvelope<T> | null> {
  try {
    return await store.read<T>(args)
  } catch {
    return null
  }
}

export async function safeWrite(store: OsStore, args: Parameters<OsStore['write']>[0]): Promise<void> {
  try {
    await store.write(args)
  } catch {
    // opportunistic
  }
}
