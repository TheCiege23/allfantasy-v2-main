/** @vitest-environment node */
/**
 * `backfillIdentityMapForSport` — the budget signal must cut a scan short MID-SPORT.
 *
 * 🛑 WHAT THIS PINS, AND WHY IT WENT UNNOTICED FOR MONTHS. `/api/cron/import-stat-lines` carried a
 * 240s `createRunBudget` the whole time, but it was only ever consulted BETWEEN sports — and
 * `backfillIdentityMaps` gated entry the same way. That bounds how MANY sports run, never how long
 * ONE takes. With `READ_PAGE` at 5,000 and a 20,000-row limit, one sport is four pages of per-row
 * updates, and NCAAB (18,209 rows) leads the rotation. Measured on the worker 2026-09-08:
 *
 *   {"ok":true,"sports":[],"deferredForBudget":["NCAAB","SOCCER","NFL","NBA","NHL","MLB","NCAAF"]}
 *   import-stat-lines ... OK 200 (270212ms)
 *
 * Zero sports imported, all seven deferred, HTTP 200, every six hours — with
 * `player_game_log_cache` frozen at 7 NFL rows since 2026-06-24.
 *
 * So the assertion that matters is not "it stopped" but "it stopped WITHOUT having read every
 * page": a guard that only fires after the work is done is the bug it replaces.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const identityFindMany = vi.fn()
const identityUpdate = vi.fn()
const identityCreateMany = vi.fn()
const sportsPlayerFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: {
      findMany: (...a: unknown[]) => identityFindMany(...a),
      update: (...a: unknown[]) => identityUpdate(...a),
      createMany: (...a: unknown[]) => identityCreateMany(...a),
    },
    sportsPlayer: { findMany: (...a: unknown[]) => sportsPlayerFindMany(...a) },
  },
}))

import { backfillIdentityMapForSport } from '@/lib/sports-data/multiSportIdentityMap'

const PAGE = 5_000

/** A page of source rows whose names cannot match anything, so no writes are attempted. */
function page(n: number, offset: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `sp-${offset + i}`,
    externalId: `ri-${offset + i}`,
    name: `Player ${offset + i}`,
    position: 'G',
    team: 'XXX',
    status: 'active',
    dob: null,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  identityFindMany.mockResolvedValue([])   // no existing identity rows
  identityUpdate.mockResolvedValue({})
  identityCreateMany.mockResolvedValue({ count: 0 })
  // Four full pages then empty — the NCAAB shape that consumed the window.
  let call = 0
  sportsPlayerFindMany.mockImplementation(async () => {
    call += 1
    return call <= 4 ? page(PAGE, (call - 1) * PAGE) : []
  })
})

describe('backfillIdentityMapForSport — shouldStop', () => {
  it('scans every page when nothing asks it to stop', async () => {
    // Positive control for the negative below: without a stop signal the loop really does read
    // all four pages, so "one page" in the next test is the guard working and not a short feed.
    const r = await backfillIdentityMapForSport('NCAAB', { limit: 20_000 })
    // Four fetches, not five: 4 x READ_PAGE reaches the 20,000 limit, and the limit break fires
    // before a fifth round-trip. Four pages of per-row work is the cost that ate the window.
    expect(sportsPlayerFindMany).toHaveBeenCalledTimes(4)
    expect(r.scanned).toBe(20_000)
    expect(r.stoppedEarly).toBeFalsy()
  })

  it('stops after the page in flight, not after the whole sport', async () => {
    let stop = false
    // Flip the signal once the first page has been read, exactly as an elapsed budget would.
    sportsPlayerFindMany.mockImplementationOnce(async () => {
      stop = true
      return page(PAGE, 0)
    })

    const r = await backfillIdentityMapForSport('NCAAB', { limit: 20_000, shouldStop: () => stop })

    expect(sportsPlayerFindMany).toHaveBeenCalledTimes(1)
    expect(r.scanned).toBe(PAGE)
    expect(r.stoppedEarly).toBe(true)
  })

  it('reports the cut so a partial pass cannot read as a converged one', async () => {
    // `scanned` alone is ambiguous: a sport with nothing left to do and a sport that ran out of
    // time both come back short. Callers need to tell those apart — they need opposite responses.
    const stopped = await backfillIdentityMapForSport('NCAAB', { limit: 20_000, shouldStop: () => true })
    expect(stopped.stoppedEarly).toBe(true)
    expect(stopped.scanned).toBe(0)

    vi.clearAllMocks()
    identityFindMany.mockResolvedValue([])
    sportsPlayerFindMany.mockResolvedValue([]) // converged: nothing left to scan
    const converged = await backfillIdentityMapForSport('NCAAB', { limit: 20_000 })
    expect(converged.stoppedEarly).toBeFalsy()
    expect(converged.scanned).toBe(0)
  })

  it('never consults the signal when none is given', async () => {
    // The parameter is optional; existing callers must be unaffected.
    const r = await backfillIdentityMapForSport('NFL', { limit: 20_000 })
    expect(r.stoppedEarly).toBeFalsy()
    expect(r.errors).toEqual([])
  })
})
