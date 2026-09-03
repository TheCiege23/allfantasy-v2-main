/**
 * BUG-3 — a user who imports an already-profiled league saw nothing.
 *
 * 🛑 THE FILED PREMISE IS WRONG, AND THE CORRECTION IS THE POINT. BUG-3 reads "duplicate
 * league rows share one platformLeagueId … a fuzzy name-match decides which a user gets."
 * Measured against production:
 *
 *   - They are NOT duplicates. A League row is per importing USER, by design —
 *     `enumerate.ts` says so: "Multiple `League` rows (one per importing user) can mirror the
 *     same external league+season." The three rows for the cited league have three DIFFERENT
 *     userIds, and each carries a full 12 rosters, 12 teams and the same 960 draft facts.
 *   - No fuzzy name-match serves them. A user's leagues resolve by `userId`; the name matching
 *     in the tree is search/admin/discovery, not the serving path.
 *
 * What IS real: profiling is keyed on the League ROW, so the second and third importer get
 * nothing until the profiler's rotation reaches their row — while byte-identical profiles for
 * the same twelve managers already exist. 23 users were in that state across 19 of the 23
 * mirrored leagues in production.
 *
 * The fix is read-side only. Nothing is merged, deduped or deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn(), findMany: vi.fn() },
    managerPsychProfile: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))

import {
  listProfilesByLeague,
  getProfileByLeagueAndManager,
} from '@/lib/psychological-profiles/ManagerBehaviorQueryService'

const OWN = 'league-own'
const SIB = 'league-sibling'

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    leagueId: SIB,
    managerId: 'mgr-1',
    sport: 'NFL',
    profileLabels: [],
    aggressionScore: 50,
    activityScore: 50,
    tradeFrequencyScore: 50,
    waiverFocusScore: 50,
    riskToleranceScore: 50,
    updatedAt: new Date('2026-09-02T00:00:00Z'),
    _count: { evidence: 10 },
    evidence: [],
    ...overrides,
  }
}

/** The caller's own row is unprofiled; one sibling mirror of the same external league has data. */
function mirroredLeagueWithProfiledSibling() {
  h.prisma.league.findUnique.mockResolvedValue({
    platform: 'sleeper',
    platformLeagueId: '1335730625293844480',
    season: 2026,
  })
  h.prisma.league.findMany.mockResolvedValue([{ id: SIB }])
  h.prisma.managerPsychProfile.findFirst.mockResolvedValue({ leagueId: SIB })
}

/**
 * ⚠ `resetAllMocks`, NOT `clearAllMocks`. `clearAllMocks` clears recorded CALLS but leaves the
 * `mockResolvedValueOnce` queue intact, so a test whose queued values are not all consumed
 * leaks the remainder into the next test.
 *
 * That is not hypothetical here — it was measured. These tests queue two `Once` values (own
 * row, then sibling). With the fallback working both are consumed and the leak is invisible;
 * the moment a mutation disables the fallback the second value survives into the following
 * test, which then fails on a row it never mocked. It turned a precise 5-of-10 mutation result
 * into a meaningless 9-of-10 and would have made the control look stronger than it was.
 */
beforeEach(() => {
  vi.resetAllMocks()
  h.prisma.managerPsychProfile.findMany.mockResolvedValue([])
  h.prisma.managerPsychProfile.findUnique.mockResolvedValue(null)
  h.prisma.managerPsychProfile.findFirst.mockResolvedValue(null)
  h.prisma.league.findUnique.mockResolvedValue(null)
  h.prisma.league.findMany.mockResolvedValue([])
})

describe('BUG-3 · listProfilesByLeague falls back to a sibling mirror', () => {
  it('🛑 an unprofiled row serves the sibling profiles instead of nothing', async () => {
    mirroredLeagueWithProfiledSibling()
    h.prisma.managerPsychProfile.findMany
      .mockResolvedValueOnce([]) // own row: empty
      .mockResolvedValueOnce([profileRow()]) // sibling: has data

    const out = await listProfilesByLeague(OWN)
    expect(out).toHaveLength(1)
    expect(out[0].managerId).toBe('mgr-1')
  })

  it('marks the provenance so a caller can tell it did not come from its own league', async () => {
    mirroredLeagueWithProfiledSibling()
    h.prisma.managerPsychProfile.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([profileRow()])

    const out = await listProfilesByLeague(OWN)
    expect(out[0].servedFromSiblingLeagueId).toBe(SIB)
  })

  /**
   * ⚠ THE GUARD THAT KEEPS THIS HONEST. A partial result is this league's own answer. Topping
   * it up from a sibling would blend two profiling runs into one list with no way to tell which
   * manager came from where.
   */
  it('🛑 a NON-empty own result is never topped up from a sibling', async () => {
    mirroredLeagueWithProfiledSibling()
    h.prisma.managerPsychProfile.findMany.mockResolvedValueOnce([
      profileRow({ leagueId: OWN, managerId: 'mine' }),
    ])

    const out = await listProfilesByLeague(OWN)
    expect(out).toHaveLength(1)
    expect(out[0].managerId).toBe('mine')
    expect(out[0].servedFromSiblingLeagueId).toBeUndefined()
    // The sibling lookup must not even be attempted.
    expect(h.prisma.league.findUnique).not.toHaveBeenCalled()
  })

  it('a league with no mirrors returns empty, not an error', async () => {
    h.prisma.league.findUnique.mockResolvedValue({
      platform: 'sleeper',
      platformLeagueId: 'solo',
      season: 2026,
    })
    h.prisma.league.findMany.mockResolvedValue([])

    const out = await listProfilesByLeague(OWN)
    expect(out).toEqual([])
  })

  it('a league with no external id has no siblings and does not query for them', async () => {
    h.prisma.league.findUnique.mockResolvedValue({
      platform: 'manual',
      platformLeagueId: '',
      season: 2026,
    })

    const out = await listProfilesByLeague(OWN)
    expect(out).toEqual([])
    expect(h.prisma.league.findMany).not.toHaveBeenCalled()
  })

  it('mirrors exist but none is profiled — still empty', async () => {
    h.prisma.league.findUnique.mockResolvedValue({
      platform: 'sleeper',
      platformLeagueId: 'x',
      season: 2026,
    })
    h.prisma.league.findMany.mockResolvedValue([{ id: SIB }])
    h.prisma.managerPsychProfile.findFirst.mockResolvedValue(null)

    const out = await listProfilesByLeague(OWN)
    expect(out).toEqual([])
  })

  /**
   * With three mirrors two can be profiled at different times; serving the older one would be a
   * silent downgrade, so the resolver orders by updatedAt desc.
   */
  it('picks the FRESHEST profiled sibling, not merely the first found', async () => {
    h.prisma.league.findUnique.mockResolvedValue({
      platform: 'sleeper',
      platformLeagueId: 'x',
      season: 2026,
    })
    h.prisma.league.findMany.mockResolvedValue([{ id: 'older' }, { id: 'newer' }])
    h.prisma.managerPsychProfile.findFirst.mockResolvedValue({ leagueId: 'newer' })
    h.prisma.managerPsychProfile.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([profileRow({ leagueId: 'newer' })])

    const out = await listProfilesByLeague(OWN)
    expect(out[0].servedFromSiblingLeagueId).toBe('newer')
    expect(h.prisma.managerPsychProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: 'desc' } }),
    )
  })

  it('scopes the sibling search to the same platform, external id AND season', async () => {
    mirroredLeagueWithProfiledSibling()
    h.prisma.managerPsychProfile.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await listProfilesByLeague(OWN)
    const where = h.prisma.league.findMany.mock.calls[0][0].where
    expect(where.platform).toBe('sleeper')
    expect(where.platformLeagueId).toBe('1335730625293844480')
    expect(where.season).toBe(2026)
    expect(where.id).toEqual({ not: OWN })
  })
})

describe('BUG-3 · getProfileByLeagueAndManager falls back the same way', () => {
  it('serves a sibling profile for a manager the own row has not profiled', async () => {
    mirroredLeagueWithProfiledSibling()
    h.prisma.managerPsychProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(profileRow())

    const out = await getProfileByLeagueAndManager(OWN, 'mgr-1')
    expect(out?.managerId).toBe('mgr-1')
    expect(out?.servedFromSiblingLeagueId).toBe(SIB)
  })

  it('never overrides a profile the own league already has', async () => {
    mirroredLeagueWithProfiledSibling()
    h.prisma.managerPsychProfile.findUnique.mockResolvedValueOnce(
      profileRow({ leagueId: OWN, aggressionScore: 99 }),
    )

    const out = await getProfileByLeagueAndManager(OWN, 'mgr-1')
    expect(out?.aggressionScore).toBe(99)
    expect(out?.servedFromSiblingLeagueId).toBeUndefined()
    expect(h.prisma.league.findUnique).not.toHaveBeenCalled()
  })
})
