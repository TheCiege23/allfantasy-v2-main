import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const draftFactFindFirst = vi.fn()
const draftFactDeleteMany = vi.fn()
const draftFactCreateMany = vi.fn()
const draftFactFindMany = vi.fn(async () => [] as unknown[])
const draftFactUpdateMany = vi.fn()
const leagueTeamFindMany = vi.fn(async () => [] as unknown[])
const rosterSnapshotFindFirst = vi.fn()
const rosterSnapshotCreate = vi.fn()
const rosterSnapshotDeleteMany = vi.fn()
const leagueFindUnique = vi.fn()
const leagueSeasonFindFirst = vi.fn()
const dynastySeasonFindUnique = vi.fn()
const transactionMock = vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: (...args: unknown[]) => leagueFindUnique(...args) },
    /*
     * ⚠ ADDED WHEN THE SERVICE STARTED READING ROSTERS. Without it the call hit
     * undefined and the service caught its own TypeError, returning
     * `{ attempted: true, error: "Cannot read properties of undefined (reading
     * 'findMany')" }` — no `seasonsConsidered`, no provider calls, and an
     * assertion that read as a completion-gate regression rather than a missing
     * stub. The service catching its own failure is correct; the fake being
     * short of a model is what made it look like a behaviour change.
     */
    roster: { findMany: (...args: unknown[]) => rosterFindMany(...args) },
    leagueTeam: { findMany: (...args: unknown[]) => leagueTeamFindMany(...args) },
    leagueSeason: { findFirst: (...args: unknown[]) => leagueSeasonFindFirst(...args) },
    draftFact: {
      findFirst: (...args: unknown[]) => draftFactFindFirst(...args),
      deleteMany: (...args: unknown[]) => draftFactDeleteMany(...args),
      createMany: (...args: unknown[]) => draftFactCreateMany(...args),
      findMany: (...args: unknown[]) => draftFactFindMany(...args),
      updateMany: (...args: unknown[]) => draftFactUpdateMany(...args),
    },
    /*
     * ⚠ ADDED WHEN THE SEASON-STATE SYNC STARTED READING THE STORED ROW — it needs the stored
     * `status` to tell a row written after completion from one written mid-season, and it merges
     * onto the stored metadata instead of replacing it. Without this stub the service catches its
     * own TypeError and every counter reads `undefined`, which looks like a gate regression.
     */
    leagueDynastySeason: { findUnique: (...args: unknown[]) => dynastySeasonFindUnique(...args) },
    rosterSnapshot: {
      findFirst: (...args: unknown[]) => rosterSnapshotFindFirst(...args),
      create: (...args: unknown[]) => rosterSnapshotCreate(...args),
      deleteMany: (...args: unknown[]) => rosterSnapshotDeleteMany(...args),
    },
    $transaction: (ops: unknown[]) => transactionMock(ops),
  },
}))

vi.mock('@/lib/sleeper-client', () => ({
  getLeagueDrafts: vi.fn(async () => []),
  getDraftPicks: vi.fn(async () => []),
  getLeagueUsers: vi.fn(async () => []),
  getLeagueRosters: vi.fn(async () => []),
}))

vi.mock('@/lib/league-import/sleeper/SleeperHistoricalLeagueChain', () => ({
  getSleeperHistoricalLeagueChain: vi.fn(),
}))

vi.mock('@/lib/dynasty-import/normalize-historical', () => ({
  persistDynastySeason: vi.fn(async () => undefined),
}))

import { getSleeperHistoricalLeagueChain } from '@/lib/league-import/sleeper/SleeperHistoricalLeagueChain'
import { getDraftPicks, getLeagueDrafts, getLeagueUsers, getLeagueRosters } from '@/lib/sleeper-client'
import { planDraftTeamRemap, syncSleeperHistoricalDraftFactsAfterImport } from '@/lib/league-import/sleeper/SleeperHistoricalDraftSyncService'
import { syncSleeperHistoricalSeasonStateAfterImport } from '@/lib/league-import/sleeper/SleeperHistoricalSeasonStateSyncService'
import { persistDynastySeason } from '@/lib/dynasty-import/normalize-historical'

const rosterFindMany = vi.fn(async () => [] as unknown[])
const chainMock = vi.mocked(getSleeperHistoricalLeagueChain)

/*
 * ── 🛑 THESE FIXTURES GAINED A `status`, AND THAT IS THE WHOLE POINT ─────────────────────────
 *
 * They used to be `{ season: '2025' }` with no status, and the assertions below read "skips
 * seasons that already have DraftFact rows". That was the BUG, pinned as the spec: the gate
 * tested whether rows existed, so importing mid-season stamped rows for the season being PLAYED
 * and every later run skipped it. A user's live draft and roster froze at the instant they
 * imported, while a counter named `seasonsSkippedAlreadyComplete` reported it as finished.
 *
 * `seasonCompletion.ts` fixed the gate to ask Sleeper whether the season is actually over. This
 * suite was NOT updated in that commit and went red on main — caught here rather than by the
 * attestation, which ran the new test and not the existing one covering the changed code.
 *
 * The chain walks newest-first, so element 0 is the season in progress. That ordering is what
 * makes the regression test below meaningful.
 */
function threeSeasonChain() {
  return [
    { season: 2025, externalLeagueId: 'lg-2025', league: { season: '2025', status: 'in_season' } },
    { season: 2024, externalLeagueId: 'lg-2024', league: { season: '2024', status: 'complete' } },
    { season: 2023, externalLeagueId: 'lg-2023', league: { season: '2023', status: 'complete' } },
  ] as never
}

/** Every season finished — the only shape in which the gate may skip everything. */
function allCompleteChain() {
  return [
    { season: 2025, externalLeagueId: 'lg-2025', league: { season: '2025', status: 'complete' } },
    { season: 2024, externalLeagueId: 'lg-2024', league: { season: '2024', status: 'complete' } },
    { season: 2023, externalLeagueId: 'lg-2023', league: { season: '2023', status: 'complete' } },
  ] as never
}

describe('Sleeper historical draft sync — completion gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFindUnique.mockResolvedValue({
      id: 'league-1',
      platform: 'sleeper',
      platformLeagueId: 'lg-current',
      sport: 'nfl',
    })
    chainMock.mockResolvedValue(threeSeasonChain())
    // The draft sync maps history onto today's managers and does nothing without any.
    rosterFindMany.mockResolvedValue([{ platformUserId: 'u1', playerData: { source_team_id: '1', source_manager_id: 'u1' } }])
  })
  afterEach(() => {
    rosterFindMany.mockResolvedValue([])
  })

  it('skips a FINISHED season that already has DraftFact rows, and no others', async () => {
    // Rows exist for 2025 and 2024; 2023 is missing. Only 2024 is both finished AND imported.
    draftFactFindFirst.mockImplementation(async ({ where }: { where: { season: number } }) => {
      return where.season === 2023 ? null : { id: `existing-${where.season}` }
    })

    const result = await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1' })

    expect(result.seasonsConsidered).toBe(3)
    expect(result.seasonsSkippedAlreadyComplete).toBe(1)
    expect(result.providerCallsAvoided).toBe(1)
    // 2025 (in progress, refetched) and 2023 (finished but never imported).
    expect(getLeagueDrafts).toHaveBeenCalledTimes(2)
    expect(getLeagueDrafts).toHaveBeenCalledWith('lg-2025', { strict: true })
    expect(getLeagueDrafts).toHaveBeenCalledWith('lg-2023', { strict: true })
  })

  it('🛑 REGRESSION: the season being PLAYED is refetched even though it has rows', async () => {
    /*
     * The bug this gate exists to prevent, pinned directly. Every season has rows; only 2025 is
     * still in progress. The old row-existence gate skipped all three and reported them
     * "already complete" — which is how a user's live draft froze at import.
     *
     * ⚠ Note this test would PASS against a gate that skips nothing at all, which is why the
     * test above pins the skip counter as well. Neither is sufficient alone.
     */
    draftFactFindFirst.mockResolvedValue({ id: 'existing' })

    const result = await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1' })

    expect(result.seasonsSkippedAlreadyComplete).toBe(2) // 2024 + 2023
    expect(getLeagueDrafts).toHaveBeenCalledTimes(1)
    expect(getLeagueDrafts).toHaveBeenCalledWith('lg-2025', { strict: true })
  })

  it('does not call the provider at all when every season is finished and imported', async () => {
    chainMock.mockResolvedValue(allCompleteChain())
    draftFactFindFirst.mockResolvedValue({ id: 'existing' })

    const result = await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1' })

    expect(result.skipped).toBe(true)
    expect(result.reason).toMatch(/already have imported draft data/)
    expect(result.seasonsSkippedAlreadyComplete).toBe(3)
    expect(getLeagueDrafts).not.toHaveBeenCalled()
    expect(draftFactDeleteMany).not.toHaveBeenCalled()
  })

  it('force=true re-fetches every season even when DraftFact rows already exist', async () => {
    draftFactFindFirst.mockResolvedValue({ id: 'existing' })

    await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1', force: true })

    // findFirst (the gate check) must never be consulted when forcing.
    expect(draftFactFindFirst).not.toHaveBeenCalled()
    expect(getLeagueDrafts).toHaveBeenCalledTimes(3)
  })
})

describe('Sleeper historical roster/season-state sync — completion gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFindUnique.mockResolvedValue({
      id: 'league-1',
      platform: 'sleeper',
      platformLeagueId: 'lg-current',
      sport: 'nfl',
    })
    chainMock.mockResolvedValue(threeSeasonChain())
    leagueSeasonFindFirst.mockResolvedValue(null)
    // The stored row was written after the season ended — the settled case.
    dynastySeasonFindUnique.mockResolvedValue({ metadata: { status: 'complete' } })
  })

  it('skips a FINISHED season with a roster snapshot, and refetches the one in progress', async () => {
    rosterSnapshotFindFirst.mockImplementation(async ({ where }: { where: { season: number } }) => {
      return where.season === 2023 ? null : { id: `existing-${where.season}` }
    })

    const result = await syncSleeperHistoricalSeasonStateAfterImport({ leagueId: 'league-1' })

    expect(result.seasonsConsidered).toBe(3)
    // Only 2024. 2025 is still being played and 2023 was never imported.
    expect(result.seasonsSkippedAlreadyComplete).toBe(1)
    expect(result.providerCallsAvoided).toBe(1)
    expect(getLeagueUsers).toHaveBeenCalledTimes(2)
    expect(getLeagueRosters).toHaveBeenCalledTimes(2)
  })

  it('🛑 REGRESSION: SEASON_END_ROSTER_SNAPSHOT_PERIOD must not freeze the live season', async () => {
    // The season-state half of the same bug: a mid-season import stamped "season end" rows for a
    // season that had not ended, and every later run then skipped it.
    rosterSnapshotFindFirst.mockResolvedValue({ id: 'existing' })

    const result = await syncSleeperHistoricalSeasonStateAfterImport({ leagueId: 'league-1' })

    expect(result.seasonsSkippedAlreadyComplete).toBe(2)
    expect(getLeagueRosters).toHaveBeenCalledTimes(1)
    expect(getLeagueRosters).toHaveBeenCalledWith('lg-2025')
  })

  it('force=true re-fetches every season even when a roster snapshot already exists', async () => {
    rosterSnapshotFindFirst.mockResolvedValue({ id: 'existing' })

    await syncSleeperHistoricalSeasonStateAfterImport({ leagueId: 'league-1', force: true })

    expect(rosterSnapshotFindFirst).not.toHaveBeenCalled()
    expect(getLeagueUsers).toHaveBeenCalledTimes(3)
  })

  /*
   * 🛑 A SNAPSHOT ALONE IS NOT "SETTLED". A season first stored mid-season already has a
   * "season end" snapshot holding a mid-season roster. Skipping on its existence freezes that
   * roster as the season's final one — the same shape as the matchup sync's bug (#995).
   */
  it('refreshes a completed season whose stored row was written before it finished', async () => {
    rosterSnapshotFindFirst.mockResolvedValue({ id: 'existing' })
    dynastySeasonFindUnique.mockResolvedValue({ metadata: { status: 'in_season' } })

    const result = await syncSleeperHistoricalSeasonStateAfterImport({ leagueId: 'league-1' })

    expect(result.seasonsSkippedAlreadyComplete).toBe(0)
    expect(result.completedSeasonsRefreshed).toBe(2)
    // All three seasons are fetched: the two finished ones are re-read, the live one always is.
    expect(getLeagueRosters).toHaveBeenCalledTimes(3)
  })

  /*
   * 🛑 MERGE, NEVER REPLACE. `persistDynastySeason` writes the whole metadata column, and the
   * matchup sync owns `playoffStructure` / `matchupHistory` in the same row. Replacing destroyed
   * them, and since #995 the matchup sync no longer rewrites a settled season, so nothing would
   * put them back.
   */
  it('keeps the matchup sync playoff structure when it writes settings', async () => {
    rosterSnapshotFindFirst.mockResolvedValue(null)
    dynastySeasonFindUnique.mockResolvedValue({
      metadata: {
        status: 'complete',
        playoffStructure: { championRosterId: 7, runnerUpRosterId: 8, bracketPlacementVersion: 2 },
        matchupHistory: { weeksWithMatchups: [1, 2, 3] },
      },
    })

    await syncSleeperHistoricalSeasonStateAfterImport({ leagueId: 'league-1' })

    const calls = vi.mocked(persistDynastySeason).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      const metadata = call[4] as Record<string, unknown>
      expect(metadata.playoffStructure).toEqual({ championRosterId: 7, runnerUpRosterId: 8, bracketPlacementVersion: 2 })
      expect(metadata.matchupHistory).toEqual({ weeksWithMatchups: [1, 2, 3] })
      // and it still writes its own half
      expect(metadata.sourceProvider).toBe('sleeper')
      expect(metadata.rawSettings).toBeDefined()
    }
  })
})

describe('🛑 Sleeper historical draft sync — each pick records who owned the team that made it', () => {
  /*
   * `managerId` names a TEAM — the one that holds that manager's slot today — so it cannot say WHO
   * drafted. `metadata.ownerSleeperId` can, and Competitive Edge on Draft HQ reads nothing else
   * (lib/competitive-edge/draftEdgeLoader.ts).
   */
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFindUnique.mockResolvedValue({ id: 'league-1', platform: 'sleeper', platformLeagueId: 'lg-current', sport: 'nfl' })
    chainMock.mockResolvedValue([{ season: 2024, externalLeagueId: 'lg-2024', league: { season: '2024', status: 'complete' } }] as never)
    draftFactFindFirst.mockResolvedValue(null)
    // Today: sl-a holds slot 1, sl-b holds slot 3 (claimed, so the roster is keyed on the AF id).
    rosterFindMany.mockResolvedValue([
      { platformUserId: 'sl-a', playerData: { source_team_id: '1', source_manager_id: 'sl-a' } },
      { platformUserId: 'af-user-b', playerData: { source_team_id: '3', source_manager_id: 'sl-b' } },
    ])
    // The sync also counts traded picks with a direct fetch; keep it off the network.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    rosterFindMany.mockResolvedValue([])
  })

  it('writes that season’s roster owner onto each pick — and never `picked_by`, which is whoever clicked', async () => {
    vi.mocked(getLeagueRosters).mockResolvedValueOnce([
      { roster_id: 1, owner_id: 'sl-a' },
      { roster_id: 2, owner_id: null },
    ] as never)
    vi.mocked(getLeagueDrafts).mockResolvedValueOnce([{ draft_id: 'd-2024' }] as never)
    vi.mocked(getDraftPicks).mockResolvedValueOnce([
      { player_id: 'p1', round: 1, pick_no: 1, roster_id: 1, picked_by: 'sl-commish' },
      // An orphaned team that season: the commissioner picked for it.
      { player_id: 'p2', round: 1, pick_no: 2, roster_id: 2, picked_by: 'sl-commish' },
    ] as never)

    const result = await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1' })

    expect(result.refreshed).toBe(true)
    const rows = (draftFactCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data
    expect(rows.map((r) => r.playerId)).toEqual(['p1', 'p2'])
    expect(rows[0]!.metadata).toMatchObject({ ownerSleeperId: 'sl-a' })
    expect(rows[1]!.metadata).not.toHaveProperty('ownerSleeperId')
  })

  /*
   * 🛑 THE KEEPER FLAG WAS FETCHED AND THROWN AWAY (2026-09-28). Sleeper slots a kept player into
   * the draft with `is_keeper: true`, so his round IS what keeping him cost. Every keeper league we
   * grade is a Sleeper import, and without this flag none of them had a keeper cost on file.
   */
  it('keeps Sleeper’s keeper flag on a kept pick — and only on a kept pick', async () => {
    vi.mocked(getLeagueRosters).mockResolvedValueOnce([
      { roster_id: 1, owner_id: 'sl-a' },
      { roster_id: 2, owner_id: null },
    ] as never)
    vi.mocked(getLeagueDrafts).mockResolvedValueOnce([{ draft_id: 'd-2024' }] as never)
    vi.mocked(getDraftPicks).mockResolvedValueOnce([
      { player_id: 'p1', round: 5, pick_no: 49, roster_id: 1, is_keeper: true },
      { player_id: 'p2', round: 5, pick_no: 50, roster_id: 1, is_keeper: null },
      // A keeper on an orphaned team: the flag survives without an owner.
      { player_id: 'p3', round: 9, pick_no: 98, roster_id: 2, is_keeper: true },
    ] as never)

    await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1' })

    const rows = (draftFactCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data
    expect(rows[0]!.metadata).toMatchObject({ ownerSleeperId: 'sl-a', isKeeper: true })
    expect(rows[1]!.metadata).toMatchObject({ ownerSleeperId: 'sl-a' })
    expect(rows[1]!.metadata).not.toHaveProperty('isKeeper')
    expect(rows[2]!.metadata).toMatchObject({ isKeeper: true })
    expect(rows[2]!.metadata).not.toHaveProperty('ownerSleeperId')
  })

  it("🛑 credits a departed manager's picks to them, not to whoever holds their old slot now", async () => {
    vi.mocked(getLeagueRosters).mockResolvedValueOnce([
      { roster_id: 1, owner_id: 'sl-a' },
      { roster_id: 2, owner_id: 'sl-b' },
      { roster_id: 3, owner_id: 'sl-gone', co_owners: ['sl-helper'] },
      { roster_id: 4, owner_id: null },
    ] as never)
    vi.mocked(getLeagueDrafts).mockResolvedValueOnce([{ draft_id: 'd-2024' }] as never)
    vi.mocked(getDraftPicks).mockResolvedValueOnce([
      { player_id: 'p1', round: 1, pick_no: 1, roster_id: 1 },
      { player_id: 'p2', round: 1, pick_no: 2, roster_id: 2 },
      { player_id: 'p3', round: 1, pick_no: 3, roster_id: 3 },
      { player_id: 'p4', round: 1, pick_no: 4, roster_id: 4 },
    ] as never)

    await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1' })

    const rows = (draftFactCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data
    // sl-b moved from slot 2 to slot 3 and claimed the team; slot 3's 2024 owner has left.
    expect(rows.map((r) => r.managerId)).toEqual(['1', '3', 'former:sleeper:sl-gone', 'former:sleeper:slot:2024:4'])
    expect(rows[2]!.metadata).toMatchObject({ ownerSleeperId: 'sl-gone', coOwnerSleeperIds: ['sl-helper'] })
  })

  it('⚠ leaves a season alone when its rosters cannot be read', async () => {
    vi.mocked(getLeagueRosters).mockResolvedValueOnce([] as never)
    vi.mocked(getLeagueDrafts).mockResolvedValueOnce([{ draft_id: 'd-2024' }] as never)
    vi.mocked(getDraftPicks).mockResolvedValueOnce([{ player_id: 'p1', round: 1, pick_no: 1, roster_id: 2 }] as never)

    const result = await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1' })

    expect(result).toMatchObject({ seasonsSkippedNoRosters: 1, refreshed: false })
    expect(draftFactDeleteMany).not.toHaveBeenCalled()
    expect(draftFactCreateMany).not.toHaveBeenCalled()
  })

  it('moves stored picks of a finished season from the database alone when a slot changes hands', async () => {
    draftFactFindFirst.mockResolvedValue({ draftId: 'existing' })
    draftFactFindMany.mockResolvedValueOnce([
      // Stored while sl-gone held slot 2; slot 2 is nobody's now and sl-gone has left.
      { draftId: 'a', managerId: '2', metadata: { ownerSleeperId: 'sl-gone' } },
      { draftId: 'b', managerId: '2', metadata: { ownerSleeperId: 'sl-gone', isKeeper: true } },
      // Already right.
      { draftId: 'c', managerId: '1', metadata: { ownerSleeperId: 'sl-a' } },
      // sl-b moved to slot 3.
      { draftId: 'd', managerId: '2', metadata: { ownerSleeperId: 'sl-b' } },
      // No owner on file: never guessed.
      { draftId: 'e', managerId: '4', metadata: null },
    ])

    const result = await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1' })

    expect(result.picksRemapped).toBe(3)
    expect(getLeagueRosters).not.toHaveBeenCalled()
    expect(getLeagueDrafts).not.toHaveBeenCalled()
    const calls = draftFactUpdateMany.mock.calls.map((c) => c[0])
    expect(calls).toEqual([
      { where: { draftId: { in: ['a', 'b'] } }, data: { managerId: 'former:sleeper:sl-gone' } },
      { where: { draftId: { in: ['d'] } }, data: { managerId: '3' } },
    ])
  })

  it('never re-derives the CURRENT season: its roster ids are its teams', async () => {
    chainMock.mockResolvedValue([{ season: 2025, externalLeagueId: 'lg-current', league: { season: '2025', status: 'complete' } }] as never)
    draftFactFindFirst.mockResolvedValue({ draftId: 'existing' })
    await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1' })
    expect(draftFactFindMany).not.toHaveBeenCalled()
    expect(draftFactUpdateMany).not.toHaveBeenCalled()
  })

  it('⚠ does not map at all when no current manager is on file', async () => {
    rosterFindMany.mockResolvedValue([])
    const result = await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1' })
    expect(result).toMatchObject({ skipped: true, attempted: false })
    expect(chainMock).not.toHaveBeenCalled()
  })
})

describe('planDraftTeamRemap', () => {
  const current = new Map([['sl-a', '1'], ['sl-help', '7']])
  it('maps by the stored owner, then a co-owner, else the departed owner; ignores ownerless rows', () => {
    expect(
      planDraftTeamRemap(
        [
          { draftId: 'x', managerId: '9', metadata: { ownerSleeperId: 'sl-a' } },
          { draftId: 'y', managerId: '9', metadata: { ownerSleeperId: 'sl-gone', coOwnerSleeperIds: ['sl-help'] } },
          { draftId: 'z', managerId: '9', metadata: { ownerSleeperId: 'sl-gone' } },
          { draftId: 'w', managerId: '1', metadata: { ownerSleeperId: 'sl-a' } },
          { draftId: 'v', managerId: '9', metadata: { coOwnerSleeperIds: ['sl-help'] } },
          { draftId: 'u', managerId: '9', metadata: 'junk' },
        ],
        current,
      ),
    ).toEqual([
      { draftId: 'x', managerId: '1' },
      { draftId: 'y', managerId: '7' },
      { draftId: 'z', managerId: 'former:sleeper:sl-gone' },
    ])
  })
})


describe('Sleeper archive persistence', () => {
  it('persists separate same-season draft identities and the provider ownership records', async () => {
    vi.clearAllMocks()
    leagueFindUnique.mockResolvedValue({ id: 'league-1', platform: 'sleeper', platformLeagueId: 'lg-current', sport: 'nfl' })
    chainMock.mockResolvedValue([{ season: 2025, externalLeagueId: 'lg-current', league: { season: '2025', status: 'in_season', scoring_settings: { rec: 1 } } }] as never)
    rosterFindMany.mockResolvedValue([{ platformUserId: 'u1', playerData: { source_team_id: '1', source_manager_id: 'u1' } }])
    vi.mocked(getLeagueRosters).mockResolvedValue([{ roster_id: 1, owner_id: 'u1' }] as never)
    vi.mocked(getLeagueDrafts).mockResolvedValue([{ draft_id: 'startup', type: 'snake' }, { draft_id: 'rookie', type: 'linear' }])
    vi.mocked(getDraftPicks).mockResolvedValue([{ player_id: 'player', roster_id: 1, picked_by: 'u1', draft_slot: 1, round: 1, pick_no: 1, is_keeper: true, metadata: { first_name: 'Player', last_name: 'Then', team: 'OLD' } }])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 }]), { status: 200 })))
    try {
      const result = await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1', force: true })
      expect(result.error).toBeUndefined()
      expect(result.importedDraftCount).toBe(2)
      const rows = draftFactCreateMany.mock.calls[0][0].data
      expect(rows).toHaveLength(2)
      expect(rows.map((row: { metadata: { sourceDraftId: string } }) => row.metadata.sourceDraftId)).toEqual(['startup', 'rookie'])
      expect(rows[0].metadata).toMatchObject({ ownerSleeperId: 'u1', isKeeper: true, selectionRosterId: '1', archiveDraft: { format: 'snake', tradeCoverage: 'provider_ownership_snapshot', tradedPicks: [{ round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 }] } })
    } finally { vi.unstubAllGlobals() }
  })
})


describe('Sleeper archive failed refresh', () => {
  it('keeps stored history when one draft provider read fails', async () => {
    vi.clearAllMocks()
    leagueFindUnique.mockResolvedValue({ id: 'league-1', platform: 'sleeper', platformLeagueId: 'lg-current', sport: 'nfl' })
    chainMock.mockResolvedValue([{ season: 2025, externalLeagueId: 'lg-current', league: { season: '2025', status: 'in_season' } }] as never)
    rosterFindMany.mockResolvedValue([{ platformUserId: 'u1', playerData: { source_team_id: '1', source_manager_id: 'u1' } }])
    vi.mocked(getLeagueRosters).mockResolvedValue([{ roster_id: 1, owner_id: 'u1' }] as never)
    vi.mocked(getLeagueDrafts).mockResolvedValue([{ draft_id: 'missing', status: 'complete' }])
    vi.mocked(getDraftPicks).mockRejectedValueOnce(new Error('Provider temporarily unavailable'))
    const result = await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1', force: true })
    expect(getDraftPicks).toHaveBeenCalledWith('missing', { strict: true })
    expect(result.error).toContain('Provider temporarily unavailable')
    expect(draftFactDeleteMany).not.toHaveBeenCalled()
    expect(draftFactCreateMany).not.toHaveBeenCalled()
    vi.mocked(getDraftPicks).mockResolvedValueOnce([])
    const empty = await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1', force: true })
    expect(empty.error).toContain('selections unavailable')
    expect(draftFactDeleteMany).not.toHaveBeenCalled()
  })
})
