// @vitest-environment node
/**
 * Guards the writer half of P1 item 7 — per-attempt import history.
 *
 * 🛑 WHAT WAS LOST. A forced re-import REUSES the `import_runs` row, overwriting
 * the previous attempt's status, error, payload hash and summary. A league that
 * failed twice and then succeeded looked, forever after, like one that succeeded
 * once. The reuse itself is correct and stays; the per-attempt detail now lives
 * in `import_run_attempts`.
 *
 * ⚠ THE INTERESTING CASE IS THE RACE, NOT THE HAPPY PATH. Postgres reads at READ
 * COMMITTED, so two concurrent imports of the same league both see the same
 * `max(attemptNumber)` and compute the same next value. The unique constraint on
 * `(runId, attemptNumber)` is what turns that into a write error instead of two
 * rows both claiming to be attempt 3 — and the writer must RETRY rather than give
 * up or crash the import.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const aggregate = vi.fn()
const create = vi.fn()
const update = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    importRunAttempt: {
      aggregate: (...a: unknown[]) => aggregate(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}))

import { startImportAttempt, finishImportAttempt } from '@/lib/league-import/importRunAttempts'

/** The error Prisma raises when the unique constraint rejects a duplicate. */
function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  aggregate.mockResolvedValue({ _max: { attemptNumber: null } })
  create.mockResolvedValue({ id: 'attempt-1' })
  update.mockResolvedValue({})
})

describe('startImportAttempt — allocating the number', () => {
  it('the first attempt for a run is number 1', async () => {
    const id = await startImportAttempt('run-1', { rawPayloadHash: 'h' })
    expect(id).toBe('attempt-1')
    expect(create.mock.calls[0][0].data).toMatchObject({
      runId: 'run-1',
      attemptNumber: 1,
      status: 'running',
      rawPayloadHash: 'h',
    })
  })

  it('the next attempt continues from the highest existing number', async () => {
    aggregate.mockResolvedValue({ _max: { attemptNumber: 4 } })
    await startImportAttempt('run-1', {})
    expect(create.mock.calls[0][0].data.attemptNumber).toBe(5)
  })

  it('🛑 retries on P2002 and takes the next number — the race the constraint exists for', async () => {
    /*
     * Two concurrent imports both read max=2 and both try 3. One wins. The loser
     * must not crash the import and must not give up — it re-reads and takes 4.
     */
    aggregate
      .mockResolvedValueOnce({ _max: { attemptNumber: 2 } })
      .mockResolvedValueOnce({ _max: { attemptNumber: 3 } })
    create.mockRejectedValueOnce(p2002()).mockResolvedValueOnce({ id: 'attempt-4' })

    const id = await startImportAttempt('run-1', {})

    expect(id).toBe('attempt-4')
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][0].data.attemptNumber).toBe(3) // lost the race
    expect(create.mock.calls[1][0].data.attemptNumber).toBe(4) // took the next
  })

  it('gives up after a bounded number of retries rather than looping forever', async () => {
    /*
     * An unbounded retry against a genuinely broken constraint is an infinite loop
     * wearing a helpful hat. Bounded, and it returns null rather than throwing.
     */
    create.mockRejectedValue(p2002())
    const id = await startImportAttempt('run-1', {})
    expect(id).toBeNull()
    expect(create.mock.calls.length).toBeLessThanOrEqual(4)
    expect(create.mock.calls.length).toBeGreaterThan(1)
  })

  it('does NOT retry a non-race error — that is just slower failure', async () => {
    create.mockRejectedValue(new Error('connection reset'))
    const id = await startImportAttempt('run-1', {})
    expect(id).toBeNull()
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('failing soft — an audit row must never fail an import', () => {
  /*
   * 🛑 THE RULE THIS MODULE IS BUILT AROUND. Attempt history is an audit
   * improvement, not a precondition for importing a league. Reporting a
   * successful import as failed because its bookkeeping row could not be written
   * would be a strictly worse lie than the one this fixes.
   */
  it('startImportAttempt returns null instead of throwing', async () => {
    aggregate.mockRejectedValue(new Error('db down'))
    await expect(startImportAttempt('run-1', {})).resolves.toBeNull()
  })

  it('finishImportAttempt swallows a write failure', async () => {
    update.mockRejectedValue(new Error('db down'))
    await expect(finishImportAttempt('attempt-1', { status: 'completed' })).resolves.toBeUndefined()
  })

  it('finishImportAttempt accepts a null id without touching the database', async () => {
    /*
     * Not a caller bug — `startImportAttempt` returns null on soft failure, and
     * accepting that here is what keeps every call site from needing a branch.
     */
    await finishImportAttempt(null, { status: 'completed' })
    await finishImportAttempt(undefined, { status: 'failed', error: 'x' })
    expect(update).not.toHaveBeenCalled()
  })
})

describe('finishImportAttempt — closing the row', () => {
  it('records success', async () => {
    await finishImportAttempt('attempt-1', { status: 'completed' })
    const arg = update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'attempt-1' })
    expect(arg.data.status).toBe('completed')
    expect(arg.data.error).toBeNull()
    expect(arg.data.completedAt).toBeInstanceOf(Date)
  })

  it('records the failure MESSAGE, which is the thing that used to be overwritten', async () => {
    await finishImportAttempt('attempt-1', { status: 'failed', error: 'roster fetch 500' })
    expect(update.mock.calls[0][0].data).toMatchObject({
      status: 'failed',
      error: 'roster fetch 500',
    })
  })
})

describe('the service actually calls this on both paths', () => {
  /*
   * ⚠ THE ONE THING THE UNIT TESTS ABOVE CANNOT CATCH: someone removing the calls
   * from `importPersistenceService`. Every test here would stay green while the
   * feature silently did nothing.
   *
   * Comments are stripped first — this repo has been bitten four times tonight by
   * a source assertion matching the prose that explains it.
   */
  const raw = require('node:fs').readFileSync(
    'lib/league-import/importPersistenceService.ts',
    'utf8',
  ) as string
  const codeOnly = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

  it('self-control: the stripper keeps code and drops prose', () => {
    expect(codeOnly).toContain('persistImportWithCanonicalAudit')
    expect(codeOnly.replace(/\s/g, '').length).toBeGreaterThan(1000)
  })

  it('opens an attempt on BOTH import paths', () => {
    expect((codeOnly.match(/startImportAttempt\(run\.id/g) ?? []).length).toBe(2)
  })

  it('closes it on success AND failure, on both paths', () => {
    const calls = codeOnly.match(/finishImportAttempt\(attemptId/g) ?? []
    expect(calls.length).toBe(4)
    expect((codeOnly.match(/status: 'completed' \}\)/g) ?? []).length).toBe(2)
    expect((codeOnly.match(/status: 'failed', error: msg \}\)/g) ?? []).length).toBe(2)
  })
})
