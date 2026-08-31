/**
 * The "Sync now" continuation loop, as a pure driver.
 *
 * ⚠ IT LIVES OUTSIDE THE COMPONENT SO IT CAN BE EXECUTED BY A TEST. This is the
 * only part of the sync feature that can do UNBOUNDED work against live vendor
 * APIs — it posts, reads `remaining`, and posts again. Everything else in the
 * feature fails safe; this is the piece where a termination bug means an
 * open-ended stream of provider calls made on a user's behalf. Buried inside a
 * React event handler it was unprovable without rendering, which in practice
 * meant unproven. `post` is injected for exactly that reason.
 *
 * ⚠ TERMINATION RESTS ON A SERVER GUARANTEE, AND THAT GUARANTEE RESTS ON THE
 * ENDPOINT RUNNING ITS PROVIDER GROUPS CONCURRENTLY. `/api/core/sync` starts
 * every platform group at t≈0 under one shared deadline, so each group's FIRST
 * candidate always clears the budget check and every round attempts at least one
 * league per platform. Were those groups ever made SEQUENTIAL, a later group
 * could start already over budget and contribute nothing — the floor would
 * silently weaken from ">=1 per platform per round" to ">=1 per round", and this
 * loop's progress argument would weaken with it. The concurrency there is
 * load-bearing for termination, not only for speed.
 *
 * Three independent stops, because one is not enough for a loop like this:
 *   1. `remaining` empties — the honest terminator, and the normal one.
 *   2. A round attempts nothing (`attempted === 0`) — a server making no
 *      progress, which would otherwise spin forever.
 *   3. `maxRounds` — the backstop. It must NEVER end a normal run.
 *
 * ⚠ HITTING THE BACKSTOP IS REPORTED AS INCOMPLETE, NEVER AS SUCCESS. The
 * ">=1 per platform per round" floor is a floor, not a quota: a single-platform
 * account with more leagues than `maxRounds` can genuinely run out of rounds.
 * When that happens the run says so and invites another press.
 */

/** One round's answer from `POST /api/core/sync`. Every field is optional: it is a wire payload. */
export type SyncRoundResponse = {
  ok?: boolean
  totalCandidates?: number
  attempted?: number
  synced?: number
  locked?: number
  failed?: number
  remaining?: string[]
  error?: string
}

/** What one POST produced. `httpOk` is separate so a 5xx with a JSON body is still readable. */
export type SyncPostResult = {
  httpOk: boolean
  round: SyncRoundResponse | null
}

export type SyncRunOutcome = {
  /**
   * `done`      every candidate synced cleanly
   * `empty`     nothing to sync — not a failure
   * `partial`   the run finished but leagues were locked or failed
   * `incomplete` a stop fired before the work was done; another press continues
   * `failed`    a round did not come back usable
   */
  status: 'done' | 'empty' | 'partial' | 'incomplete' | 'failed'
  /** `attention` is anything the user should not read as a clean success. */
  tone: 'ok' | 'attention'
  message: string
  total: number
  synced: number
  locked: number
  failed: number
  rounds: number
  exhausted: boolean
}

/** The backstop. Not a cap on work — see the header. */
export const MAX_ROUNDS = 40

export type RunSyncRoundsDeps = {
  /** Posts one round. `only` is null on the first round, then the previous `remaining`. */
  post: (only: string[] | null) => Promise<SyncPostResult>
  /** Progress between rounds. A 50-league account is minutes of work. */
  onProgress?: (text: string) => void
  /** Overridable so a test can reach the backstop without 40 fabricated rounds. */
  maxRounds?: number
}

export async function runSyncRounds(deps: RunSyncRoundsDeps): Promise<SyncRunOutcome> {
  const maxRounds = deps.maxRounds ?? MAX_ROUNDS

  let only: string[] | null = null
  let total = 0
  let synced = 0
  let locked = 0
  let failed = 0
  let rounds = 0
  let exhausted = false

  while (rounds < maxRounds) {
    rounds += 1

    const { httpOk, round } = await deps.post(only)

    if (!httpOk || !round?.ok) {
      /*
       * ⚠ PARTIAL WORK IS REPORTED EVEN WHEN THE RUN DIES. Earlier rounds
       * already completed server-side; saying only "sync failed" would hide
       * leagues that genuinely did advance.
       */
      return {
        status: 'failed',
        tone: 'attention',
        message:
          synced > 0
            ? `Stopped after ${synced} of ${total}`
            : (round?.error ?? 'Sync did not run. Try again shortly.'),
        total,
        synced,
        locked,
        failed,
        rounds,
        exhausted,
      }
    }

    /* The denominator is fixed by the first round: later rounds recompute the
       same candidate set server-side, so it should not move under us. */
    if (rounds === 1) total = round.totalCandidates ?? 0
    synced += round.synced ?? 0
    locked += round.locked ?? 0
    failed += round.failed ?? 0

    if (total === 0) {
      return {
        status: 'empty',
        tone: 'ok',
        message: 'No connected leagues to sync',
        total,
        synced,
        locked,
        failed,
        rounds,
        exhausted,
      }
    }

    deps.onProgress?.(`Synced ${synced + locked + failed} of ${total}…`)

    const rest = Array.isArray(round.remaining) ? round.remaining : []
    /* Stop 1 — the honest terminator. */
    if (rest.length === 0) break
    /* Stop 2 — a server that reported work left but attempted none of it. */
    if (!round.attempted) {
      exhausted = true
      break
    }
    only = rest
    /* Stop 3 — the backstop, recorded here so the outcome can say "incomplete". */
    if (rounds >= maxRounds) exhausted = true
  }

  if (exhausted) {
    return {
      status: 'incomplete',
      tone: 'attention',
      message: `Synced ${synced} of ${total} — press again to finish`,
      total,
      synced,
      locked,
      failed,
      rounds,
      exhausted,
    }
  }

  const stragglers = locked + failed
  return {
    status: stragglers > 0 ? 'partial' : 'done',
    tone: stragglers > 0 ? 'attention' : 'ok',
    message: stragglers > 0 ? `Synced ${synced} of ${total}` : `Synced ${synced}`,
    total,
    synced,
    locked,
    failed,
    rounds,
    exhausted,
  }
}
