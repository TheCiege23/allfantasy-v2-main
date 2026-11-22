// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSleeperNormalized } from '../fantasy-os/fixtures/sleeperNormalizedFixture'
const h = vi.hoisted(() => ({
  run: vi.fn(), alerts: vi.fn(), findState: vi.fn(), notes: [] as string[],
}))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueSyncState: { findUnique: h.findState } } }))
vi.mock('@/lib/import-os/runner', () => ({ runSync: h.run }))
vi.mock('@/lib/imported-league-alerts/sleeperAlerts', () => ({ processSleeperImportedAlerts: h.alerts }))
vi.mock('@/lib/import-os/collector/normalizedLoader', () => ({
  fetchNormalizedForConnection: vi.fn(), resolveStoredCredentialUserIds: vi.fn(), SyncLeagueGoneError: class extends Error {},
}))
vi.mock('@/lib/import-os/collector/prismaSyncStore', () => ({ createPrismaSleeperSyncStore: () => ({
  notes: h.notes, removedTotal: () => 0, rosterChangedLeagueIds: () => [],
}) }))
vi.mock('@/lib/import-os/collector/automationSyncLock', () => ({ createAutomationSyncLock: () => ({}) }))
vi.mock('@/lib/import-os/collector/enumerate', () => ({ resolveLeagueIdsForConnection: vi.fn(async () => []) }))
vi.mock('@/lib/events/producers', () => ({ getPlatformEvents: () => ({ emit: vi.fn() }) }))
vi.mock('@/lib/rankings-engine/sleeper-matchup-cache', () => ({ ensureMatchupsCached: vi.fn(async () => undefined) }))
vi.mock('@/lib/core-app/leagueStandingsSummary', () => ({ invalidateLeagueStandings: vi.fn(async () => undefined) }))
vi.mock('@/lib/sleeper/sync/ingestSleeperPlayerScores', () => ({ ingestSleeperPlayerScoresForWeek: vi.fn() }))
vi.mock('@/lib/sleeper/sync/sleeperScoreBackfillWeeks', () => ({ sleeperScoreBackfillWeeks: vi.fn(async () => []) }))
vi.mock('@/lib/sleeper/sync/sleeperScoreTargetWeeks', () => ({ sleeperScoreTargetWeeks: vi.fn(async () => []) }))
import { syncConnectedLeague } from '@/lib/import-os/collector/syncConnectedSleeperLeague'
const now = new Date('2026-11-17T18:00:00Z')
const connection = { runKey: 'sleeper:111:2026', provider: 'sleeper' as const, externalLeagueId: '111', season: 2026, sport: 'NFL' }
beforeEach(() => {
  vi.clearAllMocks()
  h.notes.length = 0
  h.findState.mockResolvedValue(null)
  h.alerts.mockResolvedValue(undefined)
  h.run.mockImplementation(async (options) => {
    await options.fetchScope('league_state', null, now)
    return { status: 'completed', advancedFreshness: true }
  })
})
describe('Imported alerts are connected to the live sync runner', () => {
  it('reuses the single provider load after a successful sync', async () => {
    const normalized = makeSleeperNormalized({ season: 2026 })
    const fetchNormalized = vi.fn(async () => normalized)
    await syncConnectedLeague(connection, now, { fetchNormalized, clock: { now: () => now } })
    expect(fetchNormalized).toHaveBeenCalledTimes(1)
    expect(h.alerts).toHaveBeenCalledWith(connection, normalized, now)
  })
  it.each(['partial', 'failed', 'locked', 'skipped'])('does not emit alerts after a %s sync', async (status) => {
    h.run.mockResolvedValue({ status, advancedFreshness: false })
    await syncConnectedLeague(connection, now, { fetchNormalized: vi.fn(async () => makeSleeperNormalized({ season: 2026 })) })
    expect(h.alerts).not.toHaveBeenCalled()
  })
  it('isolates alert failures and leaves a retry note without failing a successful sync', async () => {
    h.alerts.mockRejectedValue(new Error('notification store unavailable'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await syncConnectedLeague(connection, now, { fetchNormalized: vi.fn(async () => makeSleeperNormalized({ season: 2026 })) })
    expect(result.status).toBe('completed')
    expect(result.notes?.some((n) => n.includes('alerts could not be processed'))).toBe(true)
    vi.restoreAllMocks()
  })
  it('leaves ESPN and Fantrax syncs outside the Sleeper alert producer', async () => {
    for (const provider of ['espn', 'fantrax'] as const) {
      await syncConnectedLeague({ ...connection, provider }, now, { skipCredentialPreflight: true, fetchNormalized: vi.fn(async () => makeSleeperNormalized({ season: 2026 })) })
    }
    expect(h.alerts).not.toHaveBeenCalled()
  })
})
