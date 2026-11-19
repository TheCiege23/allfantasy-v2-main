// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSleeperNormalized } from '../fantasy-os/fixtures/sleeperNormalizedFixture'

const h = vi.hoisted(() => ({
  findLeagues: vi.fn(), findProfile: vi.fn(), findCache: vi.fn(), saveCache: vi.fn(),
  acquire: vi.fn(), release: vi.fn(), dispatch: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findMany: h.findLeagues }, userProfile: { findUnique: h.findProfile },
  sportsDataCache: { findUnique: h.findCache, upsert: h.saveCache },
} }))
vi.mock('@/lib/automation/locks', () => ({ acquireAutomationLock: h.acquire, releaseAutomationLock: h.release }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
import { processSleeperImportedAlerts } from '@/lib/imported-league-alerts/sleeperAlerts'

const connection = { runKey: 'sleeper:111:2026', provider: 'sleeper' as const, externalLeagueId: '111', season: 2026, sport: 'NFL' }
const before = new Date('2026-11-17T18:00:00Z')
const after = new Date('2026-11-17T18:10:00Z')
let cache: Record<string, { data: unknown; expiresAt: Date }>
function fixture() {
  const n = makeSleeperNormalized({ season: 2026 })
  n.league.current_week = 1
  n.draft_picks = []
  n.transactions = []
  return n
}
beforeEach(() => {
  vi.resetAllMocks()
  cache = {}
  h.findLeagues.mockResolvedValue([{ id: 'af-1', userId: 'owner' }])
  h.findProfile.mockResolvedValue({ sleeperUserId: 'u1' })
  h.acquire.mockResolvedValue({ ok: true })
  h.release.mockResolvedValue(undefined)
  h.findCache.mockImplementation(({ where }) => cache[where.cacheKey] ?? null)
  h.saveCache.mockImplementation(({ where, create }) => { cache[where.cacheKey] = create; return Promise.resolve(create) })
  h.dispatch.mockResolvedValue({ requested: 1, delivered: 1, failed: 0, suppressed: 0 })
})

describe('Sleeper imported alert producer', () => {
  it('baselines then delivers to the importer with source label, league link and stable idempotency key', async () => {
    const n = fixture()
    await processSleeperImportedAlerts(connection, n, before)
    expect(h.dispatch).not.toHaveBeenCalled()
    n.schedule[0].matchups[0].points_1 = 107
    await processSleeperImportedAlerts(connection, n, after)
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['owner'], leagueId: 'af-1', category: 'imported_scoring',
      title: expect.stringContaining('Sleeper ·'), actionHref: '/league/af-1', dedupePrefix: expect.stringMatching(/^imported-sleeper:/),
    }))
    await processSleeperImportedAlerts(connection, n, new Date('2026-11-17T18:20:00Z'))
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })
  it('preserves the baseline on delivery failure and retries with the same delivery key', async () => {
    const n = fixture()
    await processSleeperImportedAlerts(connection, n, before)
    n.schedule[0].matchups[0].points_1 = 107
    h.dispatch.mockResolvedValueOnce({ failed: 1 })
    await expect(processSleeperImportedAlerts(connection, n, after)).rejects.toThrow('delivery failed')
    const failedKey = h.dispatch.mock.calls[0][0].dedupePrefix
    expect(Object.values(cache)[0].data).toHaveProperty('observedAt', before.toISOString())
    await processSleeperImportedAlerts(connection, n, new Date('2026-11-17T18:20:00Z'))
    expect(h.dispatch.mock.calls[1][0].dedupePrefix).toBe(failedKey)
    expect(h.release).toHaveBeenCalledTimes(3)
  })
  it('advances the baseline when preferences deliberately suppress a delivery', async () => {
    const n = fixture()
    await processSleeperImportedAlerts(connection, n, before)
    n.schedule[0].matchups[0].points_1 = 107
    h.dispatch.mockResolvedValue({ requested: 1, delivered: 0, failed: 0, suppressed: 1 })
    await processSleeperImportedAlerts(connection, n, after)
    await processSleeperImportedAlerts(connection, n, new Date('2026-11-17T18:20:00Z'))
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })
  it('ignores partial provider observations, other providers, scope mismatches, and locked executions', async () => {
    const n = fixture()
    await processSleeperImportedAlerts({ ...connection, provider: 'espn' }, n, before)
    await processSleeperImportedAlerts({ ...connection, season: 2025 }, n, before)
    expect(h.findLeagues).not.toHaveBeenCalled()
    n.fetchWarnings = ['drafts timed out']
    await processSleeperImportedAlerts(connection, n, before)
    expect(h.findLeagues).not.toHaveBeenCalled()
    n.fetchWarnings = []
    h.acquire.mockResolvedValue({ ok: false })
    await processSleeperImportedAlerts(connection, n, before)
    expect(h.findCache).not.toHaveBeenCalled()
    expect(h.release).not.toHaveBeenCalled()
  })
  it('keeps each importing account and mirror separate, matching each actual Sleeper team', async () => {
    const n = fixture()
    h.findLeagues.mockResolvedValue([{ id: 'af-1', userId: 'alice' }, { id: 'af-2', userId: 'bob' }])
    h.findProfile.mockImplementation(({ where }) => Promise.resolve({ sleeperUserId: where.userId === 'alice' ? 'u1' : 'u2' }))
    await processSleeperImportedAlerts(connection, n, before)
    expect(Object.keys(cache)).toHaveLength(2)
    n.rosters[0].starter_ids = ['p1', 'p4']
    await processSleeperImportedAlerts(connection, n, after)
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][0].userIds).toEqual(['alice'])
  })
  it('continues other importing accounts when one mirror fails', async () => {
    const n = fixture()
    h.findLeagues.mockResolvedValue([{ id: 'af-1', userId: 'alice' }, { id: 'af-2', userId: 'bob' }])
    await processSleeperImportedAlerts(connection, n, before)
    n.schedule[0].matchups[0].points_1 = 107
    h.dispatch.mockResolvedValueOnce({ failed: 1 })
    await expect(processSleeperImportedAlerts(connection, n, after)).rejects.toThrow('delivery failed')
    expect(h.dispatch).toHaveBeenCalledTimes(2)
    expect(cache['imported-alerts:v1:sleeper:af-1:alice'].data).toHaveProperty('observedAt', before.toISOString())
    expect(cache['imported-alerts:v1:sleeper:af-2:bob'].data).toHaveProperty('observedAt', after.toISOString())
  })
  it('ignores an older overlapping observation and never guesses roster ownership', async () => {
    const n = fixture()
    h.findProfile.mockResolvedValue({ sleeperUserId: 'unmatched' })
    await processSleeperImportedAlerts(connection, n, after)
    n.schedule[0].matchups[0].points_1 = 107
    await processSleeperImportedAlerts(connection, n, before)
    await processSleeperImportedAlerts(connection, n, new Date('2026-11-17T18:20:00Z'))
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})
