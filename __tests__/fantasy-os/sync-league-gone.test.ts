/**
 * A league the provider says is gone stops costing provider reads.
 *
 * 🛑 THE LOADER'S OWN TESTS WERE GREEN THE WHOLE TIME. `multi-provider-sync-collector` pins that
 * `fetchNormalizedForConnection` throws `SyncLeagueGoneError`, and nothing pinned what the collector
 * did with it — which was retry it on every scope. Measured on production 2026-09-14: two Sleeper
 * leagues deleted after import were read up to twelve times per run at 74 and 33 consecutive
 * failures. So the tests here go through `syncConnectedLeague`, not the helper alone.
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
      upsert: vi.fn(async (_args: unknown) => ({ checkpoints: {}, consecutiveFailures: 74 })),
      update: vi.fn(async (_args: unknown) => ({})),
    },
    syncJobRun: { create: vi.fn(async (_args: unknown) => ({ id: 'run-1' })) },
  },
  ensureMatchupsCached: vi.fn(async () => undefined),
  ingestScores: vi.fn(async () => ({})),
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

import {
  isInLeagueGoneBackoff,
  isLeagueGoneState,
  LEAGUE_GONE_ERROR_PREFIX,
  LEAGUE_GONE_RECHECK_MS,
} from '@/lib/import-os/collector/leagueGone'
import { SyncLeagueGoneError } from '@/lib/import-os/collector/normalizedLoader'
import { syncConnectedLeague } from '@/lib/import-os/collector/syncConnectedSleeperLeague'
import { createPrismaSleeperSyncStore } from '@/lib/import-os/collector/prismaSyncStore'
import { enumerateConnectedLeagues } from '@/lib/import-os/collector/enumerate'
import type { RunResult } from '@/lib/import-os/runner'
import type { LeagueSyncConnection } from '@/lib/import-os/collector/types'

/* In season, so the post-run Sleeper enrichment WOULD run for an ordinary run. */
const NOW = new Date('2026-09-14T12:00:00Z')
const HOUR = 60 * 60_000

const CONNECTION: LeagueSyncConnection = {
  runKey: 'sleeper:1395068198813978624:2026',
  provider: 'sleeper',
  externalLeagueId: '1395068198813978624',
  season: 2026,
  sport: 'NFL',
}

const goneRow = (attemptedAgoMs: number) => ({
  syncStatus: 'skipped',
  lastError: `${LEAGUE_GONE_ERROR_PREFIX}sleeper: League not found.`,
  lastAttemptedSyncAt: new Date(NOW.getTime() - attemptedAgoMs),
})

const noSleep = async () => undefined

beforeEach(() => {
  vi.clearAllMocks()
  h.prisma.leagueSyncState.findUnique.mockResolvedValue(null)
  h.prisma.leagueSyncState.findMany.mockResolvedValue([])
  h.prisma.leagueSyncState.upsert.mockResolvedValue({ checkpoints: {}, consecutiveFailures: 74 })
})

describe('isInLeagueGoneBackoff', () => {
  it('holds a gone league for the recheck window, then releases it', () => {
    expect(isInLeagueGoneBackoff(goneRow(HOUR), NOW)).toBe(true)
    expect(isInLeagueGoneBackoff(goneRow(LEAGUE_GONE_RECHECK_MS + 1), NOW)).toBe(false)
  })

  /*
   * ⚠ THE CREDENTIAL PRE-FLIGHT ALSO WRITES `skipped`. It must keep re-checking every heartbeat,
   * so the recorded note — not the status — is what marks a league gone.
   */
  it('does not hold a credential skip, a plain failure, or a row with no attempt', () => {
    const credentialSkip = {
      syncStatus: 'skipped',
      lastError: 'no importing user has stored espn credentials for this league',
      lastAttemptedSyncAt: new Date(NOW.getTime() - HOUR),
    }
    expect(isInLeagueGoneBackoff(credentialSkip, NOW)).toBe(false)
    expect(isInLeagueGoneBackoff({ ...goneRow(HOUR), syncStatus: 'failed' }, NOW)).toBe(false)
    expect(isLeagueGoneState({ ...goneRow(HOUR), lastAttemptedSyncAt: null })).toBe(false)
    expect(isInLeagueGoneBackoff(null, NOW)).toBe(false)
  })
})

describe('syncConnectedLeague — a league the provider says is gone', () => {
  it('asks the provider ONCE per run, records a skip, and skips the Sleeper enrichment', async () => {
    const fetchNormalized = vi.fn(async () => {
      throw new SyncLeagueGoneError('sleeper: League not found. Please check your League ID.')
    })

    const out = await syncConnectedLeague(CONNECTION, NOW, { fetchNormalized, sleep: noSleep })

    expect(fetchNormalized).toHaveBeenCalledTimes(1)
    expect(out.status).toBe('skipped')
    expect(out.result?.terminalError).toContain('League not found')
    expect(h.ensureMatchupsCached).not.toHaveBeenCalled()
    expect(h.ingestScores).not.toHaveBeenCalled()

    const stateWrite = h.prisma.leagueSyncState.update.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => 'syncStatus' in d)
    expect(stateWrite).toMatchObject({ syncStatus: 'skipped', consecutiveFailures: 74 })
    expect(String(stateWrite?.lastError)).toMatch(new RegExp(`^${LEAGUE_GONE_ERROR_PREFIX}`))
  })

  it('does not ask again inside the recheck window', async () => {
    h.prisma.leagueSyncState.findUnique.mockResolvedValue(goneRow(HOUR))
    const fetchNormalized = vi.fn(async () => {
      throw new Error('must not be called')
    })

    const out = await syncConnectedLeague(CONNECTION, NOW, { fetchNormalized, sleep: noSleep })

    expect(fetchNormalized).not.toHaveBeenCalled()
    expect(out.executed).toBe(false)
    expect(out.due).toBe(false)
    expect(out.nextEligibleAt).toBe(new Date(NOW.getTime() - HOUR + LEAGUE_GONE_RECHECK_MS).toISOString())
  })

  it('asks again once the window has passed, and a manual refresh ignores it', async () => {
    const gone = async () => {
      throw new SyncLeagueGoneError('sleeper: League not found.')
    }

    h.prisma.leagueSyncState.findUnique.mockResolvedValue(goneRow(LEAGUE_GONE_RECHECK_MS + 1))
    const afterWindow = vi.fn(gone)
    await syncConnectedLeague(CONNECTION, NOW, { fetchNormalized: afterWindow, sleep: noSleep })
    expect(afterWindow).toHaveBeenCalledTimes(1)

    h.prisma.leagueSyncState.findUnique.mockResolvedValue(goneRow(HOUR))
    const forced = vi.fn(gone)
    await syncConnectedLeague(CONNECTION, NOW, { fetchNormalized: forced, sleep: noSleep, force: true })
    expect(forced).toHaveBeenCalledTimes(1)
  })

  it('still retries a provider outage, which is not terminal', async () => {
    const fetchNormalized = vi.fn(async () => {
      throw new Error('sleeper normalize failed: rate limited')
    })

    const out = await syncConnectedLeague(CONNECTION, NOW, {
      fetchNormalized,
      sleep: noSleep,
      scopes: ['league_state'],
      maxRetries: 2,
    })

    expect(fetchNormalized).toHaveBeenCalledTimes(3)
    expect(out.status).toBe('failed')
  })
})

describe('prismaSyncStore — recording a gone league', () => {
  const run = (overrides: Partial<RunResult>): RunResult => ({
    runKey: CONNECTION.runKey,
    status: 'skipped',
    seasonState: 'regular_season',
    completedScopes: [],
    incompleteScopes: ['league_state'],
    checkpoint: {},
    accounting: {
      requestAttempts: 1, logicalRequests: 1, retries: 0, cacheHits: 0, successful: 0,
      notFound: 0, permanentFailures: 1, imported: 0, unchanged: 0, rejected: 0,
    },
    advancedFreshness: false,
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    warnings: [],
    ...overrides,
  })

  const store = () =>
    createPrismaSleeperSyncStore({
      connection: CONNECTION,
      loadNormalized: async () => {
        throw new Error('unused')
      },
      reconcileRemovals: true,
    })

  it('keeps the league flagged as failing for managers without counting a failure', async () => {
    await store().recordRun(run({ terminalError: 'sleeper: League not found.' }))

    const state = (h.prisma.leagueSyncState.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(state.consecutiveFailures).toBe(74)
    expect(state.lastError).toBe(`${LEAGUE_GONE_ERROR_PREFIX}sleeper: League not found.`)

    const job = (h.prisma.syncJobRun.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(job.status).toBe('skipped')

    expect(h.prisma.league.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { syncStatus: 'failed', syncError: `${LEAGUE_GONE_ERROR_PREFIX}sleeper: League not found.` },
      }),
    )
  })

  it('an ordinary failure still counts', async () => {
    await store().recordRun(run({ status: 'failed', warnings: ['scope "league_state" failed after 3 attempts: boom'] }))
    const state = (h.prisma.leagueSyncState.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(state.consecutiveFailures).toBe(75)
  })
})

describe('enumerateConnectedLeagues — a bounded tick does not spend a slot on a gone league', () => {
  it('leaves a league in its recheck window out of the batch', async () => {
    h.prisma.league.groupBy.mockResolvedValue([
      { platform: 'sleeper', platformLeagueId: 'gone', season: 2026, sport: 'NFL' },
      { platform: 'sleeper', platformLeagueId: 'b', season: 2026, sport: 'NFL' },
      { platform: 'sleeper', platformLeagueId: 'c', season: 2026, sport: 'NFL' },
    ])
    /* Attempted longest ago, so plain stalest-first ordering would put it at the head. */
    h.prisma.leagueSyncState.findMany.mockResolvedValue([
      { runKey: 'sleeper:gone:2026', ...goneRow(HOUR), lastAttemptedSyncAt: new Date(Date.now() - HOUR) },
      { runKey: 'sleeper:b:2026', syncStatus: 'completed', lastError: null, lastAttemptedSyncAt: new Date(Date.now() - 10_000) },
      { runKey: 'sleeper:c:2026', syncStatus: 'completed', lastError: null, lastAttemptedSyncAt: new Date(Date.now() - 5_000) },
    ])

    const out = await enumerateConnectedLeagues(['sleeper'], 2)

    expect(out.map((c) => c.runKey)).toEqual(['sleeper:b:2026', 'sleeper:c:2026'])
  })
})
