/**
 * Per-attempt history for an import run — the writer half of P1 item 7.
 *
 * 🛑 WHAT WAS LOST. A forced re-import REUSES the `import_runs` row:
 * `importRun.update({ where: { idempotencyKey }, ... })`. That reuse is correct —
 * the key is unique so a fresh insert would collide, deleting the row would
 * discard the audit trail the table exists for, and salting the key would leave
 * unbounded near-duplicates. But each re-run OVERWROTE the previous attempt's
 * status, error, payload hash and summary. A league that failed twice and then
 * succeeded looked, forever after, like one that succeeded once.
 *
 * `ImportRun` keeps its identity; each attempt is recorded here.
 *
 * ⚠ EVERY FUNCTION HERE FAILS SOFT AND RETURNS null. Attempt history is an audit
 * improvement, not a precondition for importing a league. An import that
 * succeeded must never be reported as failed because its bookkeeping row could
 * not be written — that would be a strictly worse lie than the one this fixes.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** How many times to retry a lost race on `(runId, attemptNumber)`. */
const MAX_ALLOCATION_RETRIES = 4

/**
 * Open an attempt row and return its id.
 *
 * 🛑 THE ATTEMPT NUMBER IS ALLOCATED AGAINST A UNIQUE CONSTRAINT, NOT TRUSTED
 * FROM A COUNT. Postgres reads at READ COMMITTED, so two concurrent imports of
 * the same league both see the same `max(attemptNumber)` and both compute the
 * same next value — the very race `idempotencyKey` prevents one level up. Reading
 * the max and hoping is how you get two rows both claiming to be attempt 3, and
 * neither looks wrong afterwards.
 *
 * So the unique index on `(runId, attemptNumber)` is the arbiter: the loser gets
 * P2002, re-reads, and tries the next number. Bounded, because an unbounded retry
 * on a genuinely broken constraint is an infinite loop wearing a helpful hat.
 */
export async function startImportAttempt(
  runId: string,
  data: { rawPayloadHash?: string | null; canonicalSummary?: unknown },
): Promise<string | null> {
  for (let i = 0; i < MAX_ALLOCATION_RETRIES; i++) {
    try {
      const agg = await prisma.importRunAttempt.aggregate({
        where: { runId },
        _max: { attemptNumber: true },
      })
      const next = (agg._max.attemptNumber ?? 0) + 1

      const row = await prisma.importRunAttempt.create({
        data: {
          runId,
          attemptNumber: next,
          status: 'running',
          rawPayloadHash: data.rawPayloadHash ?? null,
          canonicalSummary: (data.canonicalSummary ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
        select: { id: true },
      })
      return row.id
    } catch (error) {
      /*
       * P2002 is the constraint doing its job — someone else took this number.
       * Loop and take the next one. Anything else is not a race, and retrying it
       * would just be slower failure.
       */
      const isRace =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
      if (!isRace) return null
    }
  }
  return null
}

/**
 * Close an attempt.
 *
 * ⚠ A NULL `attemptId` IS AN EXPECTED INPUT, not a caller bug: `startImportAttempt`
 * returns null when it could not record the attempt, and the caller is required to
 * carry on regardless. Accepting null here is what keeps that soft failure from
 * needing a branch at every call site.
 */
export async function finishImportAttempt(
  attemptId: string | null | undefined,
  outcome: { status: 'completed' | 'failed'; error?: string | null },
): Promise<void> {
  if (!attemptId) return
  await prisma.importRunAttempt
    .update({
      where: { id: attemptId },
      data: {
        status: outcome.status,
        error: outcome.error ?? null,
        completedAt: new Date(),
      },
    })
    .catch(() => {
      /* Soft by design — see the module header. */
    })
}
