import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Item 9, first slice: a second real member of an already-imported league joins the
 * EXISTING League row instead of creating a disconnected duplicate.
 *
 * 🛑 THE GAP THIS CLOSES. `League` is unique on `(userId, platform, platformLeagueId,
 * season)` — userId included — so the ONLY existing-league check in
 * `persistImportedLeagueFromNormalization` only ever catches the SAME account re-importing.
 * Ten real members of one Sleeper league, each hitting Import, got ten separate League rows:
 * ten independent syncs, ten copies of every roster, no relationship between them. The
 * membership model to attach a second member to an EXISTING league already existed and was
 * already used — `/api/league/invite/claim` claims a `LeagueTeam` by `platformUserId` and
 * writes a `LeagueManagerClaim` — but the import path never checked whether a target already
 * existed before creating one.
 *
 * `claimExistingLeagueForMember` reaches the same claim from the other door: a real member
 * does not need an invite link if the commissioner gate upstream already proved membership
 * (`importerSourceManagerId` — the caller's own manager id on the source platform, provided
 * by the provider, never typed in by the user).
 */

const h = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn() },
    leagueTeam: { findFirst: vi.fn(), update: vi.fn(async () => ({})) },
    leagueManagerClaim: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => unknown)(h.prisma),
    ),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))

import { claimExistingLeagueForMember } from '@/lib/league-import/ImportedLeagueCommitService'

const ARGS = {
  userId: 'af-user-bob',
  provider: 'sleeper' as const,
  platformLeagueId: '1359284500814647296',
  seasonYear: 2026,
  sourceManagerId: 'sleeper-user-bob',
}

const OTHER_LEAGUE = { id: 'league-abc', name: 'Bla bla bla', sport: 'NFL' }
const UNCLAIMED_TEAM = { id: 'team-1', externalId: 'roster-4' }

beforeEach(() => {
  vi.clearAllMocks()
  h.prisma.$transaction.mockImplementation(async (ops: unknown) =>
    Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => unknown)(h.prisma),
  )
})

describe('claimExistingLeagueForMember — the happy path', () => {
  it('attaches the member to the existing league rather than creating a duplicate', async () => {
    h.prisma.league.findFirst.mockResolvedValue(OTHER_LEAGUE)
    h.prisma.leagueTeam.findFirst.mockResolvedValue(UNCLAIMED_TEAM)

    const result = await claimExistingLeagueForMember(ARGS)

    expect(result).not.toBeNull()
    expect(result?.league.id).toBe('league-abc')
    expect(result?.joinedExisting).toBe(true)
    expect(result?.existed).toBe(false)
  })

  it('looks up the OTHER league by platform+externalId+season, excluding this user', async () => {
    h.prisma.league.findFirst.mockResolvedValue(OTHER_LEAGUE)
    h.prisma.leagueTeam.findFirst.mockResolvedValue(UNCLAIMED_TEAM)

    await claimExistingLeagueForMember(ARGS)

    expect(h.prisma.league.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: { not: 'af-user-bob' },
          platform: 'sleeper',
          platformLeagueId: '1359284500814647296',
          season: 2026,
        }),
      }),
    )
  })

  it('matches the team on platformUserId, unclaimed only — the same column the invite-claim route and the same-user self-claim both use', async () => {
    h.prisma.league.findFirst.mockResolvedValue(OTHER_LEAGUE)
    h.prisma.leagueTeam.findFirst.mockResolvedValue(UNCLAIMED_TEAM)

    await claimExistingLeagueForMember(ARGS)

    expect(h.prisma.leagueTeam.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId: 'league-abc', platformUserId: 'sleeper-user-bob', claimedByUserId: null },
      }),
    )
  })

  it('writes the claim exactly like the invite path: LeagueTeam.claimedByUserId + a LeagueManagerClaim row', async () => {
    h.prisma.league.findFirst.mockResolvedValue(OTHER_LEAGUE)
    h.prisma.leagueTeam.findFirst.mockResolvedValue(UNCLAIMED_TEAM)

    await claimExistingLeagueForMember(ARGS)

    expect(h.prisma.leagueTeam.update).toHaveBeenCalledWith({
      where: { id: 'team-1' },
      data: { claimedByUserId: 'af-user-bob', isOrphan: false },
    })
    expect(h.prisma.leagueManagerClaim.create).toHaveBeenCalledWith({
      data: {
        leagueId: 'league-abc',
        afUserId: 'af-user-bob',
        teamExternalId: 'roster-4',
        platformUserId: 'sleeper-user-bob',
        isConfirmed: true,
      },
    })
  })

  it('both writes happen inside one transaction, not as two independent calls', async () => {
    h.prisma.league.findFirst.mockResolvedValue(OTHER_LEAGUE)
    h.prisma.leagueTeam.findFirst.mockResolvedValue(UNCLAIMED_TEAM)

    await claimExistingLeagueForMember(ARGS)

    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1)
  })
})

describe('claimExistingLeagueForMember — every path that must fall through to an ordinary import', () => {
  /*
   * Every case here returns null on purpose. This function may only ADD a shortcut for a
   * case it is confident about; it must never block or downgrade the import that would
   * otherwise have happened.
   */
  it('no league exists yet for this platform+externalId+season at all', async () => {
    h.prisma.league.findFirst.mockResolvedValue(null)

    const result = await claimExistingLeagueForMember(ARGS)

    expect(result).toBeNull()
    expect(h.prisma.leagueTeam.findFirst).not.toHaveBeenCalled()
  })

  it('the league exists but no team matches this manager id (id-space mismatch)', async () => {
    h.prisma.league.findFirst.mockResolvedValue(OTHER_LEAGUE)
    // Neither the unclaimed lookup nor the "already mine" fallback finds anything.
    h.prisma.leagueTeam.findFirst.mockResolvedValue(null)

    const result = await claimExistingLeagueForMember(ARGS)

    expect(result).toBeNull()
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('the matching team is already claimed by a DIFFERENT AF account — a real conflict, not silently reassigned or duplicated past', async () => {
    h.prisma.league.findFirst.mockResolvedValue(OTHER_LEAGUE)
    // First call (unclaimed lookup) finds nothing; second call (is it already mine?) also
    // finds nothing, because the holder is a different userId than ARGS.userId.
    h.prisma.leagueTeam.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const result = await claimExistingLeagueForMember(ARGS)

    expect(result).toBeNull()
    expect(h.prisma.leagueTeam.update).not.toHaveBeenCalled()
    expect(h.prisma.leagueManagerClaim.create).not.toHaveBeenCalled()
  })

  it('a concurrent claim wins the race between the read and the write — falls through, does not crash', async () => {
    h.prisma.league.findFirst.mockResolvedValue(OTHER_LEAGUE)
    h.prisma.leagueTeam.findFirst.mockResolvedValue(UNCLAIMED_TEAM)
    h.prisma.$transaction.mockRejectedValueOnce(new Error('Unique constraint failed'))

    const result = await claimExistingLeagueForMember(ARGS)

    expect(result).toBeNull()
  })
})

describe('claimExistingLeagueForMember — idempotent on a repeat click by the same, already-joined user', () => {
  /*
   * 🛑 THE BUG THIS TEST WAS WRITTEN TO CATCH BEFORE IT SHIPPED. The unclaimed-lookup query
   * filters `claimedByUserId: null`, so once this user's OWN first call succeeds, their own
   * team no longer matches it. Re-import, "Import another", or a bulk retry over the same
   * discovered list would find nothing and fall through to CREATING THE DUPLICATE this
   * function exists to avoid — the opposite of idempotent. A second lookup asking "is this
   * already held by ME" must run before concluding the team belongs to someone else.
   */
  it('recognises its own prior claim and reports joined rather than falling through', async () => {
    h.prisma.league.findFirst.mockResolvedValue(OTHER_LEAGUE)
    h.prisma.leagueTeam.findFirst
      .mockResolvedValueOnce(null) // unclaimed lookup: no longer null, already theirs
      .mockResolvedValueOnce({ id: 'team-1', externalId: 'roster-4' }) // "is it mine" lookup

    const result = await claimExistingLeagueForMember(ARGS)

    expect(result).not.toBeNull()
    expect(result?.joinedExisting).toBe(true)
    expect(result?.existed).toBe(true) // this account DOES already have this, this time
    expect(h.prisma.leagueTeam.update).not.toHaveBeenCalled() // no-op, not a re-claim
    expect(h.prisma.leagueManagerClaim.create).not.toHaveBeenCalled()
  })

  it('the "is it mine" lookup is scoped to this exact user', async () => {
    h.prisma.league.findFirst.mockResolvedValue(OTHER_LEAGUE)
    h.prisma.leagueTeam.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(UNCLAIMED_TEAM)

    await claimExistingLeagueForMember(ARGS)

    expect(h.prisma.leagueTeam.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { leagueId: 'league-abc', platformUserId: 'sleeper-user-bob', claimedByUserId: 'af-user-bob' },
      }),
    )
  })
})

describe('persistImportedLeagueFromNormalization — wired to the join path end to end', () => {
  /*
   * The public entry point, not the extracted helper: proves the early return actually
   * happens where it needs to, before any of the heavy bootstrap machinery
   * (bootstrapLeagueFromImport, rank calculation, historical backfill) ever runs. If the
   * wiring were missing or the early return did not fire, this test would fail loudly —
   * the unmocked bootstrap path reaches real dynamic imports and real prisma calls this
   * mock does not provide, rather than silently succeeding.
   */
  it('joins the existing league and never reaches league creation', async () => {
    const { persistImportedLeagueFromNormalization } = await import(
      '@/lib/league-import/ImportedLeagueCommitService'
    )

    // First call: the per-user existing-league check — this account has no copy of its own.
    // Second call: claimExistingLeagueForMember's lookup for another account's copy.
    h.prisma.league.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(OTHER_LEAGUE)
    h.prisma.leagueTeam.findFirst.mockResolvedValue(UNCLAIMED_TEAM)

    const normalized = {
      source: { source_league_id: '1359284500814647296', source_provider: 'sleeper' },
      league: { season: 2026 },
    } as never

    const result = await persistImportedLeagueFromNormalization({
      userId: 'af-user-bob',
      provider: 'sleeper',
      normalized,
      importerSourceManagerId: 'sleeper-user-bob',
    })

    expect(result.joinedExisting).toBe(true)
    expect(result.league.id).toBe('league-abc')
    // No League row was created — league.create is never called on this mock at all, and if
    // the code path had fallen through to normal creation it would have thrown reaching
    // unmocked prisma calls (leagueTeam.create, roster writes, …) long before returning.
  })

  it('a first-time import (no other account has this league) is unaffected — falls through normally', async () => {
    const { persistImportedLeagueFromNormalization, ImportedLeagueConflictError } = await import(
      '@/lib/league-import/ImportedLeagueCommitService'
    )
    h.prisma.league.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const normalized = {
      source: { source_league_id: '1359284500814647296', source_provider: 'sleeper' },
      league: { season: 2026 },
    } as never

    // No bootstrap mocks are configured, so if the join check did not correctly return null
    // and fall through, the real (unmocked) creation path throws — which is itself the
    // proof that "falls through" reaches real league-creation code, not a second shortcut.
    let caught: unknown = null
    try {
      await persistImportedLeagueFromNormalization({
        userId: 'af-user-bob',
        provider: 'sleeper',
        normalized,
        importerSourceManagerId: 'sleeper-user-bob',
      })
    } catch (e) {
      caught = e
    }
    // Proves it is not the join shortcut and not the same-user conflict guard...
    expect(caught).not.toBeInstanceOf(ImportedLeagueConflictError)
    expect(caught).not.toBeNull()
    // ...and that it failed PAST the join check, deep in the real normal-creation path: the
    // minimal `normalized` stub has no `rosters`/`draft_picks`/etc. arrays, and code reading
    // `.length` off one of those only runs after league-size/roster resolution, well beyond
    // anything `claimExistingLeagueForMember` itself touches (source_league_id, league.season
    // only). A vacuous throw from THIS function's own early-return logic would not look like
    // this — it would be the join-shortcut succeeding or a clean fall-through, not a crash
    // several steps further into fields this test never populated.
    expect(String((caught as Error)?.message ?? caught)).toMatch(/reading 'length'/i)
  })
})
