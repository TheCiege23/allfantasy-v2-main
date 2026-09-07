import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The 14-day recency gate on the injury designation.
 *
 * 🛑 THIS IS THE FILE THAT MAKES THE GATE REAL. `player-card-injury.test.tsx`
 * pins how a designation RENDERS; it says nothing about which rows are eligible,
 * and for a while its own header claimed otherwise. The gate is the correctness
 * of the whole section, so it needs a test that fails when it is widened.
 *
 * What the gate is protecting against, measured in production 2026-09-07:
 * `SportsInjury` holds 4,039 rows for rostered players, and `api_sports`
 * contributes 1,444 of them with ZERO fresher than 7 days — pre-season snapshots
 * stamped 2026-06-03 that still read "Questionable for Week 1 vs. Denver".
 * Rendering one as a current designation is a confident lie about whether a man
 * can play, which is the most damaging thing this card could say.
 */

const findMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsInjury: { findMany: (...a: unknown[]) => findMany(...a) },
  },
}))

const DAY = 86_400_000

async function subject() {
  const mod = await import('@/lib/core-app/playerCard')
  return mod.loadInjury
}

beforeEach(() => {
  findMany.mockReset()
  findMany.mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('loadInjury — the recency gate', () => {
  it('asks the database for a 14-day window, not for everything', async () => {
    const loadInjury = await subject()
    const before = Date.now()
    await loadInjury('9221', 'Jahmyr Gibbs', 'NFL')

    expect(findMany).toHaveBeenCalledTimes(1)
    const where = findMany.mock.calls[0][0].where
    // The date clause is the second AND arm; find the cutoff wherever it sits.
    const json = JSON.stringify(where)
    const iso = json.match(/"gte":"([^"]+)"/)?.[1]
    expect(iso, 'a `gte` cutoff must be sent to the database').toBeTruthy()

    const ageDays = (before - new Date(iso as string).getTime()) / DAY
    // 14 days, with a second of slack for the clock between the two reads.
    expect(ageDays).toBeGreaterThan(13.99)
    expect(ageDays).toBeLessThan(14.01)
  })

  it('matches on the sleeper id AND the name, because half the rows carry no id', async () => {
    const loadInjury = await subject()
    await loadInjury('9221', 'Jahmyr Gibbs', 'NFL')
    const json = JSON.stringify(findMany.mock.calls[0][0].where)
    expect(json).toContain('9221')
    expect(json).toContain('Jahmyr Gibbs')
  })

  it('omits the id arm entirely when the player has no sleeper id', async () => {
    const loadInjury = await subject()
    await loadInjury(null, 'Jahmyr Gibbs', 'NFL')
    const json = JSON.stringify(findMany.mock.calls[0][0].where)
    expect(json).toContain('Jahmyr Gibbs')
    expect(json).not.toContain('playerId')
  })

  /*
   * ⚠ "Active" IS NOT A DESIGNATION. The ESPN half of this table doubles as a
   * per-player transaction feed — 539 "Active" rows inside the window carrying
   * sentences like "The Giants signed Deguara to a contract Wednesday". Useful,
   * but it must never render in the slot a reader scans for "can I start him".
   */
  it('skips Active rows and takes the first real designation beneath them', async () => {
    findMany.mockResolvedValue([
      { status: 'Active', type: null, description: 'Signed to a contract Wednesday.', date: new Date(), updatedAt: new Date(), source: 'espn' },
      { status: 'Questionable', type: 'Hamstring', description: 'Hamstring - Questionable', date: new Date(), updatedAt: new Date(), source: 'espn' },
    ])
    const loadInjury = await subject()
    const res = await loadInjury('9221', 'Jahmyr Gibbs', 'NFL')
    expect(res.available).toBe(true)
    if (res.available) expect(res.data.status).toBe('QUESTIONABLE')
  })

  it('is unavailable — with a reason — when every row in the window is Active', async () => {
    findMany.mockResolvedValue([
      { status: 'Active', type: null, description: 'Signed.', date: new Date(), updatedAt: new Date(), source: 'espn' },
    ])
    const loadInjury = await subject()
    const res = await loadInjury('9221', 'Jahmyr Gibbs', 'NFL')
    expect(res.available).toBe(false)
    if (!res.available) expect(res.reason).toContain('14 days')
  })

  it('upper-cases the status and keeps the report date as the fact it is', async () => {
    const when = new Date(Date.now() - 3 * DAY)
    findMany.mockResolvedValue([
      { status: 'out', type: 'Knee', description: 'Knee - Out', date: when, updatedAt: new Date(), source: 'rolling_insights' },
    ])
    const loadInjury = await subject()
    const res = await loadInjury('9221', 'Jahmyr Gibbs', 'NFL')
    expect(res.available).toBe(true)
    if (res.available) {
      expect(res.data.status).toBe('OUT')
      expect(res.data.reportedAt).toBe(when.toISOString())
      expect(res.data.source).toBe('rolling_insights')
    }
  })

  /*
   * ⚠ FOUND AGAINST PRODUCTION, NOT AGAINST A FIXTURE. ESPN's `description` is
   * usually a sentence ("Henderson (ankle) remained sidelined at Monday's
   * practice") but is sometimes just the word "questionable", which rendered on
   * the card as "QUESTIONABLE questionable". My fixtures could not surface it
   * because I wrote them, and I wrote sentences. Verifying the real loader
   * against the real table is what caught it.
   */
  it('drops a note that only repeats the status', async () => {
    findMany.mockResolvedValue([
      { status: 'Questionable', type: null, description: 'questionable', date: new Date(), updatedAt: new Date(), source: 'espn' },
    ])
    const loadInjury = await subject()
    const res = await loadInjury('9221', 'Jahmyr Gibbs', 'NFL')
    expect(res.available).toBe(true)
    if (res.available) {
      expect(res.data.status).toBe('QUESTIONABLE')
      expect(res.data.note).toBeNull()
    }
  })

  it('keeps a note that says something the status does not', async () => {
    findMany.mockResolvedValue([
      { status: 'Out', type: 'Knee', description: 'Charbonnet (knee) looks unlikely to play Sunday.', date: new Date(), updatedAt: new Date(), source: 'espn' },
    ])
    const loadInjury = await subject()
    const res = await loadInjury('9221', 'Zach Charbonnet', 'NFL')
    expect(res.available).toBe(true)
    if (res.available) expect(res.data.note).toContain('unlikely to play')
  })

  /* A query that throws must not take the card down with it. */
  it('degrades to unavailable when the query fails', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    const loadInjury = await subject()
    const res = await loadInjury('9221', 'Jahmyr Gibbs', 'NFL')
    expect(res.available).toBe(false)
  })
})
