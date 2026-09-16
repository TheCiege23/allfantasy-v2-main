/**
 * The league sync drops the cached standings boards for the league it just rewrote.
 *
 * 🛑 THIS TEST EXISTS BECAUSE THE SYNC'S OWN SUITES DO NOT REACH THE LINE. Measured by positive
 * control: throwing from `invalidateLeagueStandings` left `sleeper-sync-collector` and
 * `sleeper-sync-integration` completely green, so their pass says nothing whatever about this
 * wiring. The harness here is the one from `sync-league-gone`, which drives the real
 * `syncConnectedLeague` rather than a helper — for the same reason that file gives.
 *
 * What is actually at stake is the ID. `/core/standings` is cached keyed on the PROVIDER's league
 * id, because that is the only id in scope here and because `League.platformLeagueId` has no
 * standalone index. If this call site ever passes our UUID instead, nothing throws, nothing goes
 * red, and every board silently serves stale until its TTL — forever, on every sync.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  prisma: {
    league: {
      groupBy: vi.fn(async (_args: unknown) => [] as unknown[]),
      findMany: vi.fn(async (_args: unknown) => [] as unknown[]),
      updateMany: vi.fn(async (_args: unknown) => ({ count: 1 })),
    },
    leagueSyncState: {
      findUnique: vi.fn(async (_args: unknown) => null as unknown),
      findMany: vi.fn(async (_args: unknown) => [] as unknown[]),
      upsert: vi.fn(async (_args: unknown) => ({ checkpoints: {}, consecutiveFailures: 0 })),
      update: vi.fn(async (_args: unknown) => ({})),
    },
    syncJobRun: { create: vi.fn(async (_args: unknown) => ({ id: 'run-1' })) },
  },
  ensureMatchupsCached: vi.fn(async () => undefined),
  ingestScores: vi.fn(async () => ({})),
  invalidateLeagueStandings: vi.fn(async () => 3),
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/automation/locks', () => ({
  acquireAutomationLock: vi.fn(async () => ({ ok: true })),
  releaseAutomationLock: vi.fn(async () => undefined),
}))
vi.mock('@/lib/sleeper-client', () => ({ getAllPlayers: vi.fn(async () => ({})) }))
vi.mock('@/lib/rankings-engine/sleeper-matchup-cache', () => ({ ensureMatchupsCached: h.ensureMatchupsCached }))
vi.mock('@/lib/sleeper/sync/ingestSleeperPlayerScores', () => ({ ingestSleeperPlayerScoresForWeek: h.ingestScores }))
vi.mock('@/lib/sleeper/sync/sleeperScoreTargetWeeks', () => ({ sleeperScoreTargetWeeks: vi.fn(async () => [1]) }))
vi.mock('@/lib/core-app/leagueStandingsSummary', () => ({
  invalidateLeagueStandings: h.invalidateLeagueStandings,
}))

import { syncConnectedLeague } from '@/lib/import-os/collector/syncConnectedSleeperLeague'
import type { LeagueSyncConnection } from '@/lib/import-os/collector/types'

/* In season, so the post-run Sleeper enrichment runs. */
const NOW = new Date('2026-09-14T12:00:00Z')

const CONNECTION: LeagueSyncConnection = {
  runKey: 'sleeper:1395068198813978624:2026',
  provider: 'sleeper',
  externalLeagueId: '1395068198813978624',
  season: 2026,
  sport: 'NFL',
}

const noSleep = async () => undefined
const ok = async () => ({}) as never

beforeEach(() => {
  vi.clearAllMocks()
  h.prisma.leagueSyncState.findUnique.mockResolvedValue(null)
  h.prisma.leagueSyncState.findMany.mockResolvedValue([])
  h.prisma.leagueSyncState.upsert.mockResolvedValue({ checkpoints: {}, consecutiveFailures: 0 })
})

describe('syncConnectedLeague — cached standings invalidation', () => {
  it('invalidates with the PROVIDER league id, not our UUID', async () => {
    await syncConnectedLeague(CONNECTION, NOW, {
      fetchNormalized: vi.fn(ok),
      sleep: noSleep,
      scopes: ['league_state'],
    })

    expect(h.ensureMatchupsCached).toHaveBeenCalled()
    expect(h.invalidateLeagueStandings).toHaveBeenCalledWith('1395068198813978624')

    // Belt and braces: whatever it was handed must not look like one of our uuids.
    const passed = String(h.invalidateLeagueStandings.mock.calls[0]?.[0] ?? '')
    expect(passed).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i)
  })

  it('still invalidates when the matchup refresh REJECTED', async () => {
    // ⚠ `ensureMatchupsCached` deletes stale weeks BEFORE refetching them, so a failure partway
    // through still leaves the table changed. Skipping the sweep on error is how a cached board
    // survives pointing at rows that no longer exist.
    h.ensureMatchupsCached.mockRejectedValueOnce(new Error('sleeper 500'))

    await syncConnectedLeague(CONNECTION, NOW, {
      fetchNormalized: vi.fn(ok),
      sleep: noSleep,
      scopes: ['league_state'],
    })

    expect(h.invalidateLeagueStandings).toHaveBeenCalledWith('1395068198813978624')
  })

  it('does not invalidate for a non-Sleeper league', async () => {
    // The enrichment block is Sleeper-only: an ESPN league's WeeklyMatchup rows are written by the
    // parity collectors, so nothing here has changed and a sweep would be pure cache churn.
    await syncConnectedLeague(
      { ...CONNECTION, provider: 'espn', runKey: 'espn:x:2026', externalLeagueId: 'x' },
      NOW,
      { fetchNormalized: vi.fn(ok), sleep: noSleep, scopes: ['league_state'] },
    )

    expect(h.invalidateLeagueStandings).not.toHaveBeenCalled()
  })
})
