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
 * ⚠ THE CADENCE WORRY THAT MOTIVATED THIS WAS WRONG, AND THE FIRST TICKS SAID SO.
 * `resolveSports` returns `rotateForFairness(ALL_SPORTS)`, whose period defaults
 * to TWENTY-FOUR HOURS, and I predicted from that a sport would lead one day in
 * seven and starve in between. Measured on the first runs after this shipped
 * (2026-09-08, 18:47Z):
 *
 *   NFL 1277 written · MLB 532 · NBA 199 · NHL 183 · NCAAF 3 · NCAAB 0 · SOCCER 0
 *   recordsSkipped: 0 for every one of the seven
 *
 * All seven completed inside a single run. `rotateForFairness` sets the ORDER;
 * the 200s budget is what would starve a sport, and it is not being reached.
 * That is the whole reason to keep measuring rather than reasoning: the module
 * was written to confirm a starvation problem and its first output disproved it.
 *
 * So `lastSuccessAt` answers "when was NFL last actually refreshed", and
 * `recordsSkipped` — a STREAK, see its docs — answers "is the budget starting to
 * starve it". Today both say the feed is healthy.
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

/**
 * When the injuries feed last actually ran for a sport.
 *
 * ── Why a READER exists at all ──────────────────────────────────────────────
 *
 * The player card's injury slot says "no injury designation reported in the last
 * 14 days". That sentence is true and a reader cannot distinguish it from a feed
 * that quietly died — which is the same silence, and the more likely one, since
 * `api_sports` rows for rostered players sat frozen with ZERO fresher than seven
 * days when measured on 2026-09-08.
 *
 * Stamping the silence with when we last looked turns an assertion into
 * evidence. It is the only claim on that section a reader can check.
 *
 * ⚠ NULL MEANS "NO RECORD", WHICH IS NOT "NEVER RAN". This telemetry started on
 * 2026-09-08 and the worker picked it up at 18:25Z; before its first tick every
 * sport reads null. A card that rendered "last checked: never" off that would be
 * making a stronger claim than the data supports — so the caller renders NOTHING
 * when this is null, and only speaks when it has something to say.
 */
export type InjuryFeedFreshness = {
  /** Last run that completed without the providers erroring. */
  lastSuccessAt: Date | null
  /** Last run that failed. Never stamped in the same run as a success. */
  lastErrorAt: Date | null
  /**
   * CONSECUTIVE runs that never reached this sport, since the last one that
   * did. Zero whenever the most recent run reached it, success or failure.
   *
   * ⚠ IT IS A STREAK, NOT A TOTAL, and the distinction is the whole point — see
   * the reset in `recordInjurySyncRun`. A lifetime total answers "has this ever
   * been starved", which is not a question any surface needs; a streak answers
   * "is it starving now", which is the one the player card asks.
   */
  skipped: number
}

export async function readInjurySyncFreshness(sport: string): Promise<InjuryFeedFreshness | null> {
  const wanted = String(sport ?? '').trim()
  if (!wanted) return null

  try {
    /*
     * ⚠ `findFirst` + INSENSITIVE, NOT `findUnique` ON THE COMPOSITE KEY. The
     * writer takes its sport from the cron's `Sport` union ('NFL'); the card
     * takes its from `SportsPlayer.sport`, and `loadInjury` already reads that
     * column case-insensitively because the two have not always agreed. A
     * `findUnique` here would return null on a casing difference and be
     * indistinguishable from "the feed never ran" — the exact ambiguity this
     * module exists to remove.
     */
    const row = await prisma.providerSyncState.findFirst({
      where: {
        provider: PROVIDER,
        entityType: ENTITY,
        sport: { equals: wanted, mode: 'insensitive' },
        /*
         * ⚠ THE FOURTH COLUMN OF THE UNIQUE, AND LEAVING IT OUT MADE THIS READ
         * DEPEND ON A PROMISE NOTHING ENFORCES. The unique is
         * [provider, entityType, sport, key]; every writer above stamps
         * `key: KEY`. Filtering on only three of the four was correct ONLY while
         * `'rotation'` remains the sole key under this provider — so the moment
         * someone splits telemetry per source (rolling_insights vs espn vs
         * api_sports, an obvious next step), `findFirst` with no `orderBy`
         * returns an implementation-defined row and the card silently reports
         * another source's timestamps. No test would fail.
         *
         * `key` is our own constant, so pinning it costs nothing — unlike
         * `sport`, which comes from two different callers and must stay
         * case-insensitive.
         */
        key: KEY,
      },
      select: { lastSuccessAt: true, lastErrorAt: true, recordsSkipped: true },
    })
    if (!row) return null
    return {
      lastSuccessAt: row.lastSuccessAt ?? null,
      lastErrorAt: row.lastErrorAt ?? null,
      skipped: row.recordsSkipped ?? 0,
    }
  } catch {
    // See the header: this never breaks the surface it annotates.
    return null
  }
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
  /*
   * 🛑 `recordsSkipped` RESETS HERE, AND WITHOUT THIS IT IS NOT A SIGNAL.
   *
   * It is only ever `increment: 1`'d by `recordInjurySyncDeferred`. With no
   * reset it is a LIFETIME ACCUMULATOR: one bad afternoon in July, and every
   * player card in that sport reads "487 runs skipped for budget" forever, long
   * after the feed stabilised. A number that only climbs cannot distinguish
   * "starving right now" from "starved once, months ago" — which is the only
   * question the card asks it.
   *
   * ⚠ A FAILED RUN RESETS IT TOO, and that is deliberate. The counter means
   * "consecutive runs that never REACHED this sport". A run that reached the
   * sport and got a provider error did reach it — that is an outage, not
   * starvation, and `lastErrorAt` is what says so. Conflating the two would
   * make a broken provider look like a budget problem.
   */
  const update = args.failed
    ? {
        lastStartedAt: now,
        lastErrorAt: now,
        lastError: error,
        recordsUpdated: args.written,
        recordsSkipped: 0,
      }
    : {
        lastStartedAt: now,
        lastSuccessAt: now,
        lastCompletedAt: now,
        recordsUpdated: args.written,
        recordsSkipped: 0,
      }

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
