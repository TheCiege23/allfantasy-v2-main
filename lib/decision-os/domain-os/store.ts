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

  /**
   * Persist one fact. Resolves TRUE only when the row was actually stored.
   *
   * 🛑 THE RETURN IS THE WHOLE POINT, AND IT WAS ADDED AFTER THIS LIED IN PRODUCTION FOR WEEKS.
   * This used to resolve `void`, so "stored" and "silently dropped" were the same observable
   * outcome. Measured 2026-09-01: `domain_os_facts` did not exist, every upsert threw P2021, every
   * throw was swallowed here, and `/api/cron/domain-os-refresh` reported `written: N` every 30
   * minutes for work that never happened.
   *
   * ⚠ A STORE MUST AFFIRM SUCCESS — anything other than `true` is read as failure by
   * {@link safeWrite}. Silence is not consent: an implementation that forgets to return is
   * reporting that it did not persist, which is the safe direction and the direction that made
   * this bug findable.
   */
  write(args: {
    domain: OsDomain
    kind: string
    level: OsScopeLevel
    scopeKey: string
    sport: string
    facts: unknown
    confidence?: number | null
    sampleSize?: number | null
  }): Promise<boolean>
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
      // Absent only when the generated client has no such model at all. ⚠ NOT the same as the
      // table being missing: the delegate exists whenever the model is in schema.prisma, so a
      // missing TABLE reaches the upsert below and throws P2021 — which is exactly how this went
      // unnoticed. Verified 2026-09-01, 24 `domainOsFacts` references in the generated client.
      if (!delegate) return false
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
        return true
      } catch {
        // Still swallowed — populating the cache must never fail the caller that produced the
        // facts. But it is now REPORTED rather than merely survived, so a caller whose entire job
        // is writing (OsFeed.refresh) can tell the difference. Callers that only wanted the fact
        // (OsFeed.get) ignore this and are unaffected.
        return false
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

/**
 * Guarded write. Resolves TRUE only when the store affirmed it persisted the row.
 *
 * ⚠ `=== true` IS DELIBERATE AND IS NOT DEFENSIVE PEDANTRY. A store that resolves `undefined` —
 * an older implementation, a test double written before this contract, one that simply forgot to
 * return — is reported as a FAILURE, not as a success. Treating `undefined` as "probably fine" is
 * the precise shape of the bug this function now exists to prevent, and it would let the next
 * unmigrated store go quiet in exactly the same way.
 *
 * A throwing store and a declining store are the same answer here: not persisted.
 */
export async function safeWrite(
  store: OsStore,
  args: Parameters<OsStore['write']>[0],
): Promise<boolean> {
  try {
    return (await store.write(args)) === true
  } catch {
    return false
  }
}
