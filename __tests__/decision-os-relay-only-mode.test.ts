/**
 * `?relayOnly=1` contract for the Decision OS activity-ingest cron, added 2026-08-23.
 *
 * WHY THIS EXISTS
 * The outbox relay is the LAST phase of this handler, and `OutboxRelay.run()` checks
 * `shouldStop()` BEFORE its first `runOnce()`. Once the ingest phase spends the budget, the relay
 * breaks out having fetched nothing: `dispatched: 0`, no error, and `attempts` left at 0 on every
 * row. In the summary that is indistinguishable from "the outbox was empty".
 *
 * It was not empty. Measured on prod 2026-08-23: the handler ran 290,461ms against a 300s edge
 * ceiling, and `event_outbox` held 7,645 pending rows -- ALL with `attempts = 0`, none claimed,
 * none backed off, the oldest available since 2026-07-21. The relay had never touched a single row
 * since it landed in #518 on 2026-08-20, and every fire reported HTTP 200.
 *
 * A bigger shared budget cannot fix that: whichever phase runs last is the one starved. So the
 * drain gets its own fire via `?relayOnly=1`, the same second-vercel.json-entry pattern
 * `import-schedules?source=tsdb-only` already uses (no new route at the 2048-route ceiling).
 *
 * WHAT IS PINNED
 *   1. relayOnly SKIPS DISCOVERY. If it still queried leagues it would still be sharing a budget
 *      with ingest, which is the whole bug.
 *   2. relayOnly SKIPS THE MANAGER PROJECTION. The drain may legitimately use the full 240s, and
 *      that phase would push the handler back into the 300s edge 502.
 *   3. A NORMAL FIRE IS UNCHANGED -- still discovers, still ingests. This must not become a
 *      relay-only cron by accident.
 *   4. A STARVED RELAY IS NAMED. `relay.starved` must be set from the deadline BEFORE run() is
 *      called, because after the fact 0/0/no-error looks exactly like success.
 *
 * No DB and no network: Prisma, the Sleeper client, the relay and the projections are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type SyncCtx = { jobName: string; trigger?: string }

const {
  withSyncJobRunMock, syncRuns, prismaMock, relayRunMock, relayCtorMock,
  projectImportedManagerSnapshotsMock,
} = vi.hoisted(() => {
  const syncRuns: Array<{ ctx: SyncCtx; outcome: unknown }> = []
  const relayRunMock = vi.fn(async () => ({
    fetched: 0, dispatched: 0, retried: 0, deadLettered: 0, failed: 0, dryRun: false, failures: [],
  }))
  return {
    syncRuns,
    withSyncJobRunMock: vi.fn(
      async (ctx: SyncCtx, fn: () => Promise<unknown>, extract?: (r: unknown) => unknown) => {
        const result = await fn()
        syncRuns.push({ ctx, outcome: extract ? extract(result) : null })
        return result
      },
    ),
    prismaMock: {
      decisionOsImportedActivity: { findMany: vi.fn(), upsert: vi.fn() },
      league: { findMany: vi.fn(async () => []) },
    },
    relayRunMock,
    relayCtorMock: vi.fn(),
    projectImportedManagerSnapshotsMock: vi.fn(async () => ({
      managersWritten: 0, leaguesConsidered: 0, leaguesSkippedNative: 0,
    })),
  }
})

vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ withSyncJobRun: withSyncJobRunMock }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/events', () => ({
  OutboxRelay: class {
    constructor(...args: unknown[]) { relayCtorMock(...args) }
    run = relayRunMock
  },
  PrismaOutboxStore: class {},
  inProcessEventBus: {},
  createPrismaAuditFeedConsumer: vi.fn(() => ({})),
}))
vi.mock('@/lib/intelligence/projections/snapshotProjection', () => ({
  createIntelligenceSnapshotConsumer: vi.fn(() => ({})),
}))
vi.mock('@/lib/intelligence/projections/importedManagerProjection', () => ({
  projectImportedManagerSnapshots: projectImportedManagerSnapshotsMock,
}))
vi.mock('@/lib/decision-os/ingestion/prismaImportedActivityStore', () => ({
  PrismaImportedActivityStore: class {},
}))
vi.mock('@/lib/decision-os/ingestion/sleeperActivityEmitter', () => ({
  ingestSleeperImportedActivity: vi.fn(async () => ({ created: 0, updated: 0 })),
}))
vi.mock('@/lib/decision-os/ingestion/importedActivityNormalizer', () => ({
  buildManagerIdentityIndex: vi.fn(() => ({})),
}))
vi.mock('@/lib/sleeper-client', () => ({
  getLeagueRosters: vi.fn(async () => []),
  getLeagueTransactions: vi.fn(async () => []),
  getLeagueDrafts: vi.fn(async () => []),
  getDraftPicks: vi.fn(async () => []),
}))
vi.mock('@/scripts/decision-os-ingest-sleeper-activity-helpers', () => ({
  buildWeekRange: vi.fn(() => []),
  mapSleeperTransactionToRaw: vi.fn(),
  mapSleeperDraftPickResponseItem: vi.fn(),
  resolveDraftOccurredAt: vi.fn(),
  getDraftId: vi.fn(),
  buildSleeperManagerMapping: vi.fn(() => ({})),
  collectRosterOwnerIds: vi.fn(() => []),
}))

import { GET } from '@/app/api/cron/decision-os-activity-ingest/route'

const SECRET = 'test-cron-secret'
const ORIGINAL_ENV = { ...process.env }

function req(path: string): never {
  return new Request(`http://localhost${path}`, {
    headers: { authorization: `Bearer ${SECRET}` },
  }) as never
}

beforeEach(() => {
  syncRuns.length = 0
  vi.clearAllMocks()
  prismaMock.league.findMany.mockResolvedValue([])
  relayRunMock.mockResolvedValue({
    fetched: 0, dispatched: 0, retried: 0, deadLettered: 0, failed: 0, dryRun: false, failures: [],
  })
  projectImportedManagerSnapshotsMock.mockResolvedValue({
    managersWritten: 0, leaguesConsidered: 0, leaguesSkippedNative: 0,
  })
  process.env.CRON_SECRET = SECRET
  delete process.env.LEAGUE_CRON_SECRET
})

afterEach(() => { process.env = { ...ORIGINAL_ENV } })

describe('decision-os-activity-ingest ?relayOnly=1', () => {
  it('skips league discovery entirely', async () => {
    await GET(req('/api/cron/decision-os-activity-ingest?relayOnly=1'))
    // Discovery is what makes the relay share a budget with ingest. If this ever fires again on a
    // relay-only run, the mode has stopped doing the one thing it exists for.
    expect(prismaMock.league.findMany).not.toHaveBeenCalled()
    expect(relayRunMock).toHaveBeenCalledTimes(1)
  })

  it('skips the manager projection, which would push the handler back to the ceiling', async () => {
    await GET(req('/api/cron/decision-os-activity-ingest?relayOnly=1'))
    expect(projectImportedManagerSnapshotsMock).not.toHaveBeenCalled()
  })

  it('still discovers and projects on a NORMAL fire', async () => {
    await GET(req('/api/cron/decision-os-activity-ingest?discover=1'))
    // Guards the other direction: this must not silently become a relay-only cron.
    expect(prismaMock.league.findMany).toHaveBeenCalled()
    expect(projectImportedManagerSnapshotsMock).toHaveBeenCalled()
    expect(relayRunMock).toHaveBeenCalledTimes(1)
  })

  it('gives the relay a live window rather than an already-closed one', async () => {
    const res = await GET(req('/api/cron/decision-os-activity-ingest?relayOnly=1'))
    const body = await res.json()
    // The bug: `starved` true means run() broke out before its first batch. On a relay-only fire
    // the window opens at t=0, so this can only be false.
    expect(body.relay.starved).toBe(false)
  })

  it('passes a shouldStop that is NOT already true when the relay starts', async () => {
    await GET(req('/api/cron/decision-os-activity-ingest?relayOnly=1'))
    const opts = relayRunMock.mock.calls[0]![0] as { shouldStop?: () => boolean } | undefined
    // Directly pins the mechanism: run() checks shouldStop() BEFORE runOnce(), so a predicate
    // that is already true means zero fetched, zero dispatched, and no error to show for it.
    expect(opts?.shouldStop?.()).toBe(false)
  })

  it('reports the job under its existing telemetry name', async () => {
    await GET(req('/api/cron/decision-os-activity-ingest?relayOnly=1'))
    expect(syncRuns).toHaveLength(1)
    expect(syncRuns[0]!.ctx.jobName).toBe('cron-decision-os-activity-ingest')
  })
})
