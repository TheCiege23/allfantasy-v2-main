import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Reading back when the injuries feed last ran, for the player card's stamp.
 *
 * ── The bug this closes is a SENTENCE, not a crash ──────────────────────────
 *
 * The card's injury slot says "No injury designation reported in the last 14
 * days" for most players. That sentence is byte-identical to what a DEAD FEED
 * produces, and until now the card had no way to tell them apart. It is not a
 * hypothetical: measured on production 2026-09-08, `api_sports` held 1,444 rows
 * for rostered players and ZERO of them were fresher than seven days. For that
 * source the dead-feed reading was the correct one, and the card said "no
 * injury" the whole time.
 *
 * 🛑 THE FAILURE MODE THIS SUITE GUARDS IS THE OPPOSITE ONE: a card that turns
 * a missing telemetry ROW into a claim about the FEED. Those are different
 * facts. This telemetry began on 2026-09-08 and the worker picked it up at
 * 18:25Z, so every sport read null before its first tick — and "last checked:
 * never" would have been a confident falsehood on every player card in the app
 * on the day it shipped.
 */

const findFirst = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { providerSyncState: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}))

async function subject() {
  return await import('@/lib/injuries/injurySyncState')
}

beforeEach(() => {
  findFirst.mockReset().mockResolvedValue(null)
})
afterEach(() => vi.restoreAllMocks())

describe('readInjurySyncFreshness', () => {
  it('returns the run stamps for a sport that has been recorded', async () => {
    const success = new Date('2026-09-08T19:00:00.000Z')
    findFirst.mockResolvedValue({ lastSuccessAt: success, lastErrorAt: null, recordsSkipped: 0 })

    const { readInjurySyncFreshness } = await subject()
    const out = await readInjurySyncFreshness('NFL')

    expect(out).toEqual({ lastSuccessAt: success, lastErrorAt: null, skipped: 0 })
  })

  /*
   * 🛑 NULL MEANS "NO RECORD", AND THE CALLER MUST BE ABLE TO SEE THAT. If this
   * ever returned a zero-valued object instead, the card would render "feed has
   * not completed a run" over a sport nobody has ever recorded — a claim about
   * the world made from a gap in our own bookkeeping.
   */
  it('returns null when nothing has been recorded for the sport', async () => {
    const { readInjurySyncFreshness } = await subject()
    expect(await readInjurySyncFreshness('NFL')).toBeNull()
  })

  /*
   * 🛑 CASE-INSENSITIVE, AND THIS IS THE ONE THAT WOULD HAVE SHIPPED BROKEN.
   * The WRITER takes its sport from the cron's `Sport` union ('NFL'); the READER
   * is called with `SportsPlayer.sport`. `loadInjury` already matches that column
   * insensitively precisely because the two have not always agreed — and a
   * `findUnique` on the composite key here would return null on a casing
   * mismatch, which this module reports as "no record". The feed would look dead
   * on every card while running perfectly.
   */
  it('matches the sport case-insensitively, so a casing drift cannot read as a dead feed', async () => {
    const { readInjurySyncFreshness } = await subject()
    await readInjurySyncFreshness('nfl')

    const where = findFirst.mock.calls[0][0].where
    expect(where.sport).toEqual({ equals: 'nfl', mode: 'insensitive' })
    expect(where.provider).toBe('injuries-cron')
    expect(where.entityType).toBe('injuries')
  })

  it('carries the skip count, which is the starvation signal', async () => {
    findFirst.mockResolvedValue({ lastSuccessAt: null, lastErrorAt: null, recordsSkipped: 11 })
    const { readInjurySyncFreshness } = await subject()
    expect((await readInjurySyncFreshness('NFL'))?.skipped).toBe(11)
  })

  /*
   * A run that failed keeps the PREVIOUS success stamp — the writer never sets
   * both in one run, on purpose. "last succeeded 6h ago, last errored 2m ago" is
   * the shape that shows a feed which is running and failing, and flattening it
   * to one timestamp would hide exactly that case.
   */
  it('reports success and error stamps together rather than collapsing them', async () => {
    const ok = new Date('2026-09-08T13:00:00.000Z')
    const bad = new Date('2026-09-08T19:00:00.000Z')
    findFirst.mockResolvedValue({ lastSuccessAt: ok, lastErrorAt: bad, recordsSkipped: 2 })

    const { readInjurySyncFreshness } = await subject()
    expect(await readInjurySyncFreshness('NFL')).toEqual({
      lastSuccessAt: ok,
      lastErrorAt: bad,
      skipped: 2,
    })
  })

  /*
   * ⚠ A READ THAT THROWS MUST NOT TAKE THE PLAYER CARD DOWN. This annotates the
   * injury section; it is not the section. The same rule the writers in this
   * module already follow, and for the same reason.
   */
  it('swallows a database failure rather than failing the card', async () => {
    findFirst.mockRejectedValue(new Error('db down'))
    const { readInjurySyncFreshness } = await subject()
    await expect(readInjurySyncFreshness('NFL')).resolves.toBeNull()
  })

  it('does not query at all for a blank sport', async () => {
    const { readInjurySyncFreshness } = await subject()
    expect(await readInjurySyncFreshness('   ')).toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
  })
})
