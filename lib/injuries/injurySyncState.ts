import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Per-sport telemetry for `/api/cron/import-injuries`.
 *
 * ── The question this exists to answer ──────────────────────────────────────
 *
 * "Are injuries being checked every 30 minutes?" On 2026-09-08 that could not
 * be answered from anything the system kept. The cron fires on schedule, but
 * whether a given run REACHED a given sport was recorded nowhere:
 *
 *   - `ProviderSyncState` held zero injury rows.
 *   - `SportsInjury.updatedAt` cannot stand in. It does move on every run —
 *     both writers upsert `update: data` with `fetchedAt: now`, so unchanged
 *     rows still bump — but only for rows that were WRITTEN. It is silent about
 *     a sport the run never got to, which is the case that matters.
 *   - The route computes `deferredForBudget` and returns it in the HTTP
 *     response, where nothing reads it and nothing keeps it.
 *
 * 🛑 AND THE CADENCE IS NOT WHAT THE `*​/30` SCHEDULE SUGGESTS. `resolveSports`
 * returns `rotateForFairness(ALL_SPORTS)`, whose period defaults to TWENTY-FOUR
 * HOURS. Seven sports run sequentially against a 200s budget, so a sport leads
 * roughly one day in seven and otherwise refreshes only if the budget reaches
 * it. `lastSuccessAt` here is the honest answer to "when was NFL last actually
 * refreshed", and a climbing `recordsSkipped` is the honest answer to "is it
 * being starved by the budget".
 *
 * ⚠ EVERY FUNCTION HERE FAILS SOFT. This measures a cron that already reports
 * honestly about zero-row runs; a telemetry write that threw would turn a
 * successful injury import into a 500, for a reason having nothing to do with
 * injuries. Losing a datapoint is strictly better.
 */

const PROVIDER = 'injuries-cron'
const ENTITY = 'injuries'

/**
 * 🛑 NON-NULL, AND THAT IS LOAD-BEARING. The unique is
 * [provider, entityType, sport, key] and Postgres does not treat NULLs as
 * conflicting — so a null `key` would make every upsert INSERT a fresh row
 * rather than update the existing one. The table would grow without bound while
 * the row an operator reads never moved. Silent, and it would make this module
 * lie about the very thing it was added to prove.
 */
const KEY = 'rotation'

/** Long enough to diagnose, short enough not to store an essay. */
const MAX_ERROR = 500

function whereKey(sport: string) {
  return { provider_entityType_sport_key: { provider: PROVIDER, entityType: ENTITY, sport, key: KEY } }
}

function base(sport: string) {
  return { provider: PROVIDER, entityType: ENTITY, sport, key: KEY }
}

export async function recordInjurySyncRun(args: {
  sport: string
  written: number
  fetched: number
  failed: boolean
  error?: string | null
}): Promise<void> {
  const now = new Date()
  const error = args.error ? String(args.error).slice(0, MAX_ERROR) : null

  /*
   * ⚠ `lastSuccessAt` AND `lastErrorAt` ARE NEVER BOTH STAMPED. Keeping the
   * previous value of the other one is the point: "last succeeded 6h ago, last
   * errored 2m ago" is a far more useful pair than either alone, and stamping
   * both on every run would destroy that.
   */
  const update = args.failed
    ? { lastStartedAt: now, lastErrorAt: now, lastError: error, recordsUpdated: args.written }
    : { lastStartedAt: now, lastSuccessAt: now, lastCompletedAt: now, recordsUpdated: args.written }

  try {
    await prisma.providerSyncState.upsert({
      where: whereKey(args.sport),
      update,
      create: { ...base(args.sport), ...update, lastError: args.failed ? error : null },
    })
  } catch {
    // See the header: telemetry never breaks the job it measures.
  }
}

/**
 * A sport the run budget never reached.
 *
 * ⚠ IT MUST NOT LOOK LIKE A RUN. No `lastStartedAt`, no success, no error —
 * stamping any of those would tell an operator the sport was attempted when it
 * was skipped outright, which is the single fact this function exists to make
 * visible. Only the skip counter moves.
 */
export async function recordInjurySyncDeferred(sport: string): Promise<void> {
  try {
    await prisma.providerSyncState.upsert({
      where: whereKey(sport),
      update: { recordsSkipped: { increment: 1 } },
      create: { ...base(sport), recordsSkipped: 1 },
    })
  } catch {
    // See the header.
  }
}
