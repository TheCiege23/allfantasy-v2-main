import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * "Refresh my lineups" — the collector-side batch (lib/import-os/collector/lineupRefresh.ts).
 * Prisma and the collector's per-league sync are mocked at the module boundary; no provider is
 * ever reached.
 */

const mockTeamFindMany = vi.hoisted(() => vi.fn())
const mockStateFindMany = vi.hoisted(() => vi.fn())
const mockSync = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: mockTeamFindMany },
    leagueSyncState: { findMany: mockStateFindMany },
  },
}))
vi.mock('@/lib/import-os/collector/syncConnectedSleeperLeague', () => ({ syncConnectedLeague: mockSync }))

import { lineupRefreshCandidates, RECENT_ATTEMPT_MS, refreshLineupsNow } from '@/lib/import-os/collector/lineupRefresh'

const NOW = new Date('2026-09-27T16:40:00.000Z') // Sun 12:40p ET
const team = (platform: string, platformLeagueId: string, season = 2026) => ({ league: { platform, platformLeagueId, season, sport: 'NFL' } })

beforeEach(() => {
  vi.clearAllMocks()
  mockStateFindMany.mockResolvedValue([])
  mockSync.mockResolvedValue({ runKey: 'x', executed: true, seasonState: 'in_season', cadenceMinutes: 5, due: true, nextEligibleAt: '', status: 'completed' })
})

describe('lineupRefreshCandidates', () => {
  it("is the caller's own claimed leagues this season, one per provider league, on the active lane's key", async () => {
    mockTeamFindMany.mockResolvedValue([
      team('sleeper', '111'),
      team('sleeper', '111'), // a second claimed team row for the same league: one refresh
      team('espn', '919055222'),
      team('manual', ''), // native: nothing to pull
      team('nffc', '5'), // not a syncable provider
    ])
    const out = await lineupRefreshCandidates('me', NOW)
    expect(mockTeamFindMany.mock.calls[0][0].where).toEqual({ claimedByUserId: 'me', league: { season: 2026 } })
    expect(out.map((c) => c.runKey)).toEqual(['sleeper:111:2026:active', 'espn:919055222:2026:active'])
  })

  /*
   * Chimmy's "Refresh league data" names one league. The filter sits INSIDE the claimed-team query,
   * so it can only narrow: a league the caller holds no claimed team in returns nothing to refresh.
   */
  it('narrows to one league inside the claimed-team query, never around it', async () => {
    mockTeamFindMany.mockResolvedValue([team('sleeper', '111')])
    await refreshLineupsNow({ userId: 'me', leagueId: 'af-league-1', now: NOW })
    expect(mockTeamFindMany.mock.calls[0][0].where).toEqual({ claimedByUserId: 'me', league: { season: 2026, id: 'af-league-1' } })
    mockTeamFindMany.mockResolvedValue([])
    const none = await refreshLineupsNow({ userId: 'me', leagueId: 'someone-elses-league', now: NOW })
    expect(none).toEqual({ total: 0, attempted: [], remaining: 0 })
  })
})

describe('refreshLineupsNow', () => {
  it('refreshes only the rosters scope, forced, on the lane key, and reports each outcome', async () => {
    mockTeamFindMany.mockResolvedValue([team('sleeper', '1'), team('sleeper', '2'), team('sleeper', '3'), team('sleeper', '4')])
    mockSync
      .mockResolvedValueOnce({ status: 'completed' })
      .mockResolvedValueOnce({ status: 'locked' })
      .mockResolvedValueOnce({ status: 'skipped', reason: 'no credentials' })
      .mockRejectedValueOnce(new Error('https://api.example/x?RSC_token=secret'))
    const out = await refreshLineupsNow({ userId: 'me', now: NOW })
    expect(out.total).toBe(4)
    expect(out.remaining).toBe(0)
    expect(out.attempted.map((a) => a.status).sort()).toEqual(['busy', 'failed', 'refreshed', 'skipped'])
    // A thrown error never reaches the response text — a provider URL can carry a credential.
    expect(JSON.stringify(out)).not.toContain('secret')
    const [conn, , deps] = mockSync.mock.calls[0]
    expect(conn.runKey).toMatch(/:active$/)
    expect(deps).toMatchObject({ force: true, scopes: ['teams_rosters'], runTimeoutMs: 15_000 })
  })

  it('skips a league refreshed in the last few minutes, so a second click moves on', async () => {
    mockTeamFindMany.mockResolvedValue([team('sleeper', '1'), team('sleeper', '2')])
    mockStateFindMany.mockResolvedValue([{ runKey: 'sleeper:1:2026:active', lastAttemptedSyncAt: new Date(NOW.getTime() - RECENT_ATTEMPT_MS / 2) }])
    const out = await refreshLineupsNow({ userId: 'me', now: NOW })
    expect(mockSync).toHaveBeenCalledTimes(1)
    expect(mockSync.mock.calls[0][0].runKey).toBe('sleeper:2:2026:active')
    expect(out.remaining).toBe(0)
  })

  it('stops starting leagues when the time budget is spent and says how many remain', async () => {
    mockTeamFindMany.mockResolvedValue(Array.from({ length: 12 }, (_, i) => team('sleeper', String(i))))
    const out = await refreshLineupsNow({ userId: 'me', now: NOW, budgetMs: 0 })
    expect(mockSync).not.toHaveBeenCalled()
    expect(out.remaining).toBe(12)
  })

  it('does nothing for a user with no connected leagues', async () => {
    mockTeamFindMany.mockResolvedValue([])
    expect(await refreshLineupsNow({ userId: 'me', now: NOW })).toEqual({ total: 0, attempted: [], remaining: 0 })
  })
})
