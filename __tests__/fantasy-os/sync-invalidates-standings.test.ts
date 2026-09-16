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
  emit: vi.fn(async () => undefined),
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
vi.mock('@/lib/events/producers', () => ({ getPlatformEvents: () => ({ emit: h.emit }) }))

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

describe('syncConnectedLeague — ingest.league.completed', () => {
  /*
   * 🛑 THE SYNC'S OWN SUITES DO NOT REACH THIS EITHER. They mock `prisma.league.findMany` to return
   * [], so the emit block runs and emits nothing — green, and proving nothing. Point 7 is "an
   * import triggers what it affects", and until something emits, the entire reaction path is inert
   * no matter how well the consumer is tested.
   */
  it('emits one event per AllFantasy league, carrying the CANONICAL id', async () => {
    h.prisma.league.findMany.mockResolvedValue([
      { id: 'af-uuid-1', userId: 'u1' },
      { id: 'af-uuid-2', userId: 'u2' },
    ])

    await syncConnectedLeague(CONNECTION, NOW, {
      fetchNormalized: vi.fn(ok),
      sleep: noSleep,
      scopes: ['league_state'],
    })

    const ingestCalls = h.emit.mock.calls.filter((c) => String(c[0]).startsWith('ingest.league'))
    expect(ingestCalls).toHaveLength(2)

    const [type, args] = ingestCalls[0] as [string, Record<string, unknown>]
    expect(type).toBe('ingest.league.completed')
    /*
     * ⚠ OUR UUID, NOT THE PROVIDER'S. A DomainEvent carries canonical ids by contract, and the
     * consumer's rollout bucket and cache-key resolver both read `leagueId`. Emitting the platform
     * id here would bucket on a foreign id and resolve to nothing.
     */
    expect(args.leagueId).toBe('af-uuid-1')
    expect(args.subjects).toEqual([{ kind: 'league', id: 'af-uuid-1' }])
    expect(args.source).toBe('ingestion:sleeper')

    const payload = args.payload as Record<string, unknown>
    expect(payload).toMatchObject({ leagueId: 'af-uuid-1', provider: 'sleeper' })
    // `provider` is a SOURCE NAME. A provider URL here would put RSC_token in the outbox table.
    expect(String(payload.provider)).not.toContain('http')
  })

  it('keys idempotency on the RUN, not just the connection', async () => {
    /*
     * ⚠ `runKey` IS `<provider>:<externalLeagueId>:<season>` — STABLE ACROSS EVERY RUN. A key built
     * from it alone would dedupe the second sync of a league against the first, forever, and the
     * reaction path would fire exactly once per league for all time.
     */
    h.prisma.league.findMany.mockResolvedValue([{ id: 'af-uuid-1', userId: 'u1' }])
    const later = new Date(NOW.getTime() + 3_600_000)

    await syncConnectedLeague(CONNECTION, NOW, { fetchNormalized: vi.fn(ok), sleep: noSleep, scopes: ['league_state'] })
    await syncConnectedLeague(CONNECTION, later, { fetchNormalized: vi.fn(ok), sleep: noSleep, scopes: ['league_state'] })

    const keys = h.emit.mock.calls
      .filter((c) => String(c[0]).startsWith('ingest.league'))
      .map((c) => (c[1] as Record<string, unknown>).idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('never lets a failed emit fail the sync', async () => {
    // The sync has already done its real work; it must not fail over an announcement.
    h.prisma.league.findMany.mockRejectedValue(new Error('db down'))
    await expect(
      syncConnectedLeague(CONNECTION, NOW, { fetchNormalized: vi.fn(ok), sleep: noSleep, scopes: ['league_state'] }),
    ).resolves.toBeDefined()
  })
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
