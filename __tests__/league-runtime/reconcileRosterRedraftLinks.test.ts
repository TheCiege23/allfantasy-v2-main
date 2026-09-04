/**
 * The single enforcement point for `Roster.redraftRosterId`.
 *
 * 🛑 WHY THIS IS ONE FUNCTION AND WHY IT NEEDS REAL COVERAGE. `Roster` is created in at least
 * twelve places and `RedraftRoster` in eight. Setting the link at each would be twenty copies of one
 * rule, and the next site added breaks the invariant with nothing failing — which is precisely how
 * the two guillotine engines came to disagree about what a team is. The rule lives in one place, so
 * that place carries the whole burden of being right.
 *
 * ⚠ AND THE COLUMN DECAYS WITHOUT THE LAZY PATH. The migration backfilled 2,737 of 3,267 rosters on
 * 2026-09-04. Nothing else writes it, so every roster created afterwards holds NULL — and measured
 * that same day, the newest 45 rows linked at 36% against 84% for the established population. A
 * consumer reading the raw column would serve fewer and fewer teams while looking correct. That is
 * the `ingestCFBDStats` failure, and `resolveRedraftRosterId` is what stops it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rosterFindMany: vi.fn(),
  rosterFindUnique: vi.fn(),
  rosterUpdate: vi.fn(),
  redraftFindMany: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: h.rosterFindMany, findUnique: h.rosterFindUnique, update: h.rosterUpdate },
    redraftRoster: { findMany: h.redraftFindMany },
  },
}))

import {
  reconcileRosterRedraftLinks,
  resolveRedraftRosterId,
} from '@/lib/league-runtime/reconcileRosterRedraftLinks'

beforeEach(() => {
  vi.resetAllMocks()
  h.rosterUpdate.mockResolvedValue({})
  h.rosterFindMany.mockResolvedValue([])
  h.redraftFindMany.mockResolvedValue([])
})

describe('reconcileRosterRedraftLinks', () => {
  it('links a roster to the redraft roster with the same owner', async () => {
    h.rosterFindMany
      .mockResolvedValueOnce([{ id: 'r1', platformUserId: '111', redraftRosterId: null }])
      .mockResolvedValueOnce([]) // the already-taken query
    h.redraftFindMany.mockResolvedValue([{ id: 'rr1', ownerId: '111' }])

    const out = await reconcileRosterRedraftLinks('L1')

    expect(out).toEqual({ linked: 1, unlinked: 0, alreadyLinked: 0 })
    expect(h.rosterUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { redraftRosterId: 'rr1' },
    })
  })

  it('🛑 leaves an unresolvable roster NULL and counts it rather than guessing', async () => {
    h.rosterFindMany
      .mockResolvedValueOnce([{ id: 'r1', platformUserId: 'app-uuid', redraftRosterId: null }])
      .mockResolvedValueOnce([])
    h.redraftFindMany.mockResolvedValue([]) // no counterpart

    const out = await reconcileRosterRedraftLinks('L1')

    expect(out).toEqual({ linked: 0, unlinked: 1, alreadyLinked: 0 })
    expect(h.rosterUpdate).not.toHaveBeenCalled()
  })

  it('is idempotent — a second run writes nothing', async () => {
    h.rosterFindMany.mockResolvedValue([
      { id: 'r1', platformUserId: '111', redraftRosterId: 'rr1' },
    ])

    const out = await reconcileRosterRedraftLinks('L1')

    expect(out).toEqual({ linked: 0, unlinked: 0, alreadyLinked: 1 })
    expect(h.rosterUpdate).not.toHaveBeenCalled()
    // Nothing to resolve, so it must not even ask.
    expect(h.redraftFindMany).not.toHaveBeenCalled()
  })

  it('🛑 never lets two rosters claim one redraft roster', async () => {
    /*
     * `redraftRosterId` is UNIQUE, so a double-claim would throw. The right response is to leave
     * both alone and let the count show it, not to pick a winner. Production had zero double-claims
     * when the constraint was added, so this is a guard rather than a workaround — but a guard that
     * is never exercised is not a guard.
     */
    h.rosterFindMany
      .mockResolvedValueOnce([
        { id: 'r1', platformUserId: '111', redraftRosterId: null },
        { id: 'r2', platformUserId: '111', redraftRosterId: null },
      ])
      .mockResolvedValueOnce([])
    h.redraftFindMany.mockResolvedValue([{ id: 'rr1', ownerId: '111' }])

    const out = await reconcileRosterRedraftLinks('L1')

    expect(out.linked).toBe(1)
    expect(out.unlinked).toBe(1)
    expect(h.rosterUpdate).toHaveBeenCalledTimes(1)
  })

  it('🛑 scopes the match by league, so a manager is not linked across leagues', async () => {
    h.rosterFindMany
      .mockResolvedValueOnce([{ id: 'r1', platformUserId: '111', redraftRosterId: null }])
      .mockResolvedValueOnce([])
    h.redraftFindMany.mockResolvedValue([{ id: 'rr1', ownerId: '111' }])

    await reconcileRosterRedraftLinks('L1')

    /*
     * A platform user id is unique only WITHIN a league — the same manager appears in many. The
     * migration's backfill carried this guard and produced cross_league_links = 0; dropping it here
     * would wire a roster to that manager's team in a different league, which no test of the happy
     * path would notice.
     */
    expect(h.redraftFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leagueId: 'L1' }) }),
    )
    expect(h.rosterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leagueId: 'L1' }) }),
    )
  })

  it('does nothing on a league with no rosters', async () => {
    h.rosterFindMany.mockResolvedValue([])
    const out = await reconcileRosterRedraftLinks('L1')
    expect(out).toEqual({ linked: 0, unlinked: 0, alreadyLinked: 0 })
  })
})

describe('resolveRedraftRosterId — the guard against decay', () => {
  it('returns the stored link without reconciling', async () => {
    h.rosterFindUnique.mockResolvedValue({ redraftRosterId: 'rr1' })

    expect(await resolveRedraftRosterId('L1', 'r1')).toBe('rr1')
    // The whole point of storing it: no reconcile when the column already answers.
    expect(h.rosterFindMany).not.toHaveBeenCalled()
  })

  it('🛑 reconciles when the column is null, then returns the new link', async () => {
    /*
     * The decay guard. A roster created after the backfill holds NULL forever unless something
     * fills it, and this is that something — on the read path, where it cannot be forgotten.
     */
    h.rosterFindUnique
      .mockResolvedValueOnce({ redraftRosterId: null })
      .mockResolvedValueOnce({ redraftRosterId: 'rr-new' })
    h.rosterFindMany
      .mockResolvedValueOnce([{ id: 'r1', platformUserId: '111', redraftRosterId: null }])
      .mockResolvedValueOnce([])
    h.redraftFindMany.mockResolvedValue([{ id: 'rr-new', ownerId: '111' }])

    expect(await resolveRedraftRosterId('L1', 'r1')).toBe('rr-new')
    expect(h.rosterFindMany).toHaveBeenCalled()
  })

  it('returns null when there is genuinely no counterpart, even after reconciling', async () => {
    h.rosterFindUnique.mockResolvedValue({ redraftRosterId: null })
    h.rosterFindMany
      .mockResolvedValueOnce([{ id: 'r1', platformUserId: 'app-uuid', redraftRosterId: null }])
      .mockResolvedValueOnce([])
    h.redraftFindMany.mockResolvedValue([])

    // Null means "no known counterpart" — a caller must not read it as "not eliminated".
    expect(await resolveRedraftRosterId('L1', 'r1')).toBeNull()
  })

  it('returns null for a roster that does not exist', async () => {
    h.rosterFindUnique.mockResolvedValue(null)
    h.rosterFindMany.mockResolvedValue([])
    expect(await resolveRedraftRosterId('L1', 'nope')).toBeNull()
  })
})
