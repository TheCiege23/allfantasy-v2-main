import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Per-sport telemetry for the injuries cron.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * On 2026-09-08, asked to confirm NFL injuries refresh every 30 minutes, NOBODY
 * COULD ANSWER IT — not from the database, not from the code. The cron fires on
 * schedule (observed `GET /api/cron/import-injuries 200` in 104s), but whether
 * it reached NFL on any given run was unrecorded:
 *
 *   - `ProviderSyncState` held zero injury rows; only apifootball and
 *     rolling_insights/player were instrumented.
 *   - `SportsInjury.updatedAt` cannot stand in. It DOES move on every run (both
 *     writers upsert `update: data` with `fetchedAt: now`), but it moves only
 *     for rows that were WRITTEN — so it is silent about a sport the run never
 *     reached.
 *   - The route already computes `deferredForBudget` and returns it in the HTTP
 *     response, where it is read by nobody and kept by nothing.
 *
 * 🛑 AND THE THING THAT NEEDED MEASURING IS REAL. `resolveSports` returns
 * `rotateForFairness(ALL_SPORTS)`, whose period defaults to TWENTY-FOUR HOURS.
 * Seven sports run sequentially against a 200s budget, so NFL leads roughly one
 * day in seven and on other days refreshes only if the budget reaches it. That
 * is a per-day cadence, not a per-30-minute one, and going into week 1 the
 * difference matters. This records which it actually was.
 */

const upsert = vi.fn()

vi.mock('@/lib/prisma', () => ({ prisma: { providerSyncState: { upsert: (...a: unknown[]) => upsert(...a) } } }))

async function subject() {
  return await import('@/lib/injuries/injurySyncState')
}

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({ id: 'x' })
})
afterEach(() => vi.restoreAllMocks())

describe('injury sync telemetry', () => {
  it('records a successful run with its written count', async () => {
    const { recordInjurySyncRun } = await subject()
    await recordInjurySyncRun({ sport: 'NFL', written: 1225, fetched: 1300, failed: false })

    expect(upsert).toHaveBeenCalledTimes(1)
    const arg = upsert.mock.calls[0][0]
    expect(arg.create.sport).toBe('NFL')
    expect(arg.create.entityType).toBe('injuries')
    expect(arg.update.recordsUpdated).toBe(1225)
    expect(arg.update.lastSuccessAt).toBeInstanceOf(Date)
    expect(arg.update.lastErrorAt).toBeUndefined()
  })

  it('records a failed run as an error, and does NOT stamp lastSuccessAt', async () => {
    const { recordInjurySyncRun } = await subject()
    await recordInjurySyncRun({ sport: 'NFL', written: 0, fetched: 0, failed: true, error: 'RI 500' })
    const arg = upsert.mock.calls[0][0]
    expect(arg.update.lastErrorAt).toBeInstanceOf(Date)
    expect(arg.update.lastSuccessAt).toBeUndefined()
    expect(arg.update.lastError).toContain('RI 500')
  })

  /*
   * 🛑 THE KEY MUST BE NON-NULL. `ProviderSyncState` is unique on
   * [provider, entityType, sport, key], and in Postgres NULLs do not conflict —
   * so a null `key` makes every upsert INSERT a new row instead of updating the
   * existing one, and the table grows forever while `lastSuccessAt` never moves
   * on the row an operator is reading. Silent, and exactly the kind of thing
   * that makes telemetry lie.
   */
  it('uses a non-null key, so the upsert updates rather than inserting forever', async () => {
    const { recordInjurySyncRun } = await subject()
    await recordInjurySyncRun({ sport: 'NFL', written: 1, fetched: 1, failed: false })
    const arg = upsert.mock.calls[0][0]
    const whereKey = arg.where.provider_entityType_sport_key
    expect(whereKey.key).toBeTruthy()
    expect(whereKey.key).not.toBeNull()
    expect(arg.create.key).toBe(whereKey.key)
  })

  /*
   * A sport the budget never reached is the case this whole module exists to
   * make visible — and it must NOT look like a run. Stamping `lastStartedAt`
   * would tell an operator NFL was attempted when it was skipped entirely.
   */
  it('records a budget deferral without pretending the sport ran', async () => {
    const { recordInjurySyncDeferred } = await subject()
    await recordInjurySyncDeferred('NFL')
    const arg = upsert.mock.calls[0][0]
    expect(arg.update.lastStartedAt).toBeUndefined()
    expect(arg.update.lastSuccessAt).toBeUndefined()
    expect(arg.update.lastErrorAt).toBeUndefined()
    expect(arg.update.recordsSkipped).toEqual({ increment: 1 })
  })

  /*
   * 🛑 TELEMETRY MUST NEVER BREAK THE JOB IT MEASURES. This runs inside a cron
   * that already reports honestly about zero-row runs; a throw here would turn a
   * successful injury import into a 500 and, worse, would do it for a reason
   * that has nothing to do with injuries.
   */
  it('swallows a database failure rather than failing the cron', async () => {
    upsert.mockRejectedValue(new Error('db down'))
    const { recordInjurySyncRun, recordInjurySyncDeferred } = await subject()
    await expect(recordInjurySyncRun({ sport: 'NFL', written: 0, fetched: 0, failed: false })).resolves.toBeUndefined()
    await expect(recordInjurySyncDeferred('NFL')).resolves.toBeUndefined()
  })

  it('truncates a long provider error rather than storing an essay', async () => {
    const { recordInjurySyncRun } = await subject()
    await recordInjurySyncRun({ sport: 'NFL', written: 0, fetched: 0, failed: true, error: 'x'.repeat(2000) })
    expect(String(upsert.mock.calls[0][0].update.lastError).length).toBeLessThanOrEqual(500)
  })
})
