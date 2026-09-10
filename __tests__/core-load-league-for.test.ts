/**
 * `loadLeagueFor` — the only way a `lib/core-app` module may read a League row.
 *
 * 🛑 THE LOAD-BEARING ASSERTION IS `not.toHaveBeenCalled()` ON THE LEAGUE READ.
 * A gate that refuses and reads the row anyway passes any test that only checks
 * the return value, and the row is the thing being protected: the disclosure was
 * never "the viewer learned they were refused", it was the league's name,
 * standings, trades and waivers rendered at 200.
 *
 * WHAT THIS REPLACES, measured with two real sessions on 2026-09-10. User B was
 * registered seconds earlier and was a non-member under all four canonical
 * paths. Counting B's occurrences of A's real league name:
 *
 *   before   /core 0   my-team 1   matchup 2   standings 2   trades 5   waivers 2
 *   after    0 of 8 screens                                  (A still sees 15-17)
 *
 * ⚠ THE REAL RESOLVER RUNS HERE. `resolveLeagueMembership` is deliberately not
 * mocked — only prisma beneath it — so these exercise the actual four membership
 * paths rather than a restatement of them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  redraftFindUnique: vi.fn(),
  rosterCount: vi.fn(),
  leagueTeamFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    redraftLeagueMember: { findUnique: mocks.redraftFindUnique },
    roster: { count: mocks.rosterCount },
    leagueTeam: { findFirst: mocks.leagueTeamFindFirst },
  },
}))

import { loadLeagueFor } from '@/lib/core-app/loadLeagueFor'

const LEAGUE_ID = 'league-under-test'
const VIEWER = 'app-user-uuid-viewer'
const OWNER = 'app-user-uuid-owner'
const SELECT = { id: true, name: true } as const

/** The membership probe's own read — `select: { id, sport, userId }`. */
const PROBE_ROW = { id: LEAGUE_ID, sport: 'NFL', userId: OWNER }
/** What the gated read returns once membership is proved. */
const LEAGUE_ROW = { id: LEAGUE_ID, name: 'Someone Else’s Dynasty' }

function denyAll() {
  mocks.leagueFindUnique.mockResolvedValue(PROBE_ROW)
  mocks.redraftFindUnique.mockResolvedValue(null)
  mocks.rosterCount.mockResolvedValue(0)
  mocks.leagueTeamFindFirst.mockResolvedValue(null)
}

/** Membership passed, so the SECOND league read is the gated one. */
function admitThenReturnRow() {
  mocks.leagueFindUnique.mockResolvedValueOnce(PROBE_ROW).mockResolvedValueOnce(LEAGUE_ROW)
}

beforeEach(() => {
  vi.clearAllMocks()
  denyAll()
})

describe('admits every canonical membership path', () => {
  it('allows the league owner (League.userId)', async () => {
    admitThenReturnRow()
    await expect(loadLeagueFor(OWNER, LEAGUE_ID, SELECT)).resolves.toEqual(LEAGUE_ROW)
  })

  it('allows a RedraftLeagueMember', async () => {
    admitThenReturnRow()
    mocks.redraftFindUnique.mockResolvedValue({ role: 'MANAGER' })
    await expect(loadLeagueFor(VIEWER, LEAGUE_ID, SELECT)).resolves.toEqual(LEAGUE_ROW)
  })

  it('allows a roster-backed member (Roster.platformUserId)', async () => {
    admitThenReturnRow()
    mocks.rosterCount.mockResolvedValue(1)
    await expect(loadLeagueFor(VIEWER, LEAGUE_ID, SELECT)).resolves.toEqual(LEAGUE_ROW)
  })

  it('allows a claimed-team member, commissioner or not', async () => {
    admitThenReturnRow()
    mocks.leagueTeamFindFirst.mockResolvedValue({ isCommissioner: false, isCoCommissioner: false })
    await expect(loadLeagueFor(VIEWER, LEAGUE_ID, SELECT)).resolves.toEqual(LEAGUE_ROW)
  })

  it('allows a CO-commissioner', async () => {
    /*
     * Pinned separately because it fails independently:
     * `lib/commissioner/permissions.ts` gates on `League.userId` alone, which
     * 403s every co-commissioner.
     */
    admitThenReturnRow()
    mocks.leagueTeamFindFirst.mockResolvedValue({ isCommissioner: false, isCoCommissioner: true })
    await expect(loadLeagueFor(VIEWER, LEAGUE_ID, SELECT)).resolves.toEqual(LEAGUE_ROW)
  })

  it('passes the caller’s select through unchanged', async () => {
    admitThenReturnRow()
    await loadLeagueFor(OWNER, LEAGUE_ID, SELECT)
    expect(mocks.leagueFindUnique).toHaveBeenLastCalledWith({
      where: { id: LEAGUE_ID },
      select: SELECT,
    })
  })
})

describe('refuses everyone else, and does not read the row', () => {
  /** The probe reads the league once; a SECOND call is the gated read leaking. */
  function expectRowNeverRead() {
    expect(
      mocks.leagueFindUnique.mock.calls.length,
      'the League row was read despite a refusal',
    ).toBeLessThanOrEqual(1)
  }

  it('refuses a signed-in non-member', async () => {
    await expect(loadLeagueFor(VIEWER, LEAGUE_ID, SELECT)).resolves.toBeNull()
    expectRowNeverRead()
  })

  it('refuses an anonymous viewer without reading anything at all', async () => {
    await expect(loadLeagueFor('', LEAGUE_ID, SELECT)).resolves.toBeNull()
    expect(mocks.leagueFindUnique).not.toHaveBeenCalled()
  })

  it('refuses a missing league', async () => {
    mocks.leagueFindUnique.mockResolvedValue(null)
    await expect(loadLeagueFor(VIEWER, 'no-such-league', SELECT)).resolves.toBeNull()
    expectRowNeverRead()
  })

  it('refuses a platform admin who is not a member', async () => {
    /*
     * 🛑 NO ADMIN BYPASS, BY CONTRACT. Nothing in the mocked world marks this
     * viewer as an admin precisely BECAUSE nothing in the code path may consult
     * that — the assertion is that admin-ness is never even asked for.
     */
    await expect(loadLeagueFor('platform-admin-uuid', LEAGUE_ID, SELECT)).resolves.toBeNull()
    expectRowNeverRead()
  })

  it('returns the same null for a missing league and an unauthorized one', async () => {
    /*
     * 🛑 THE ENUMERATION DEFENCE. A caller that could tell "no such league" from
     * "not your league" could discover which ids exist by watching which answer
     * came back. One value for both, by construction.
     */
    const nonMember = await loadLeagueFor(VIEWER, LEAGUE_ID, SELECT)

    vi.clearAllMocks()
    denyAll()
    mocks.leagueFindUnique.mockResolvedValue(null)
    const missing = await loadLeagueFor(VIEWER, 'no-such-league', SELECT)

    expect(missing).toBe(nonMember)
    expect(missing).toBeNull()
  })
})
