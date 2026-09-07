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
  projectImportedManagerSnapshotsMock, ingestSleeperImportedActivityMock, getLeagueRostersMock,
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
      // Rotation state (2026-09-07). `undefined` on purpose in most tests — `FeatureToggleService`
      // degrades a missing/erroring platformConfig read to `{}` rather than throwing, and that
      // degrade path is itself exercised by leaving this unset in the base mock.
      platformConfig: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    },
    relayRunMock,
    relayCtorMock: vi.fn(),
    projectImportedManagerSnapshotsMock: vi.fn(async () => ({
      managersWritten: 0, leaguesConsidered: 0, leaguesSkippedNative: 0,
    })),
    // Real per-league work is exercised by the rotation tests below — rosters must be non-empty
    // or `ingestOneLeague` short-circuits before ever reaching the ingest writer. Shape matches
    // what `ingestOneLeague` actually reads (`result.writer.{created,updated,skipped}`) — the
    // pre-existing mock here (`{ created, updated }` with no `.writer`) was never exercised
    // because rosters were always empty, so the mismatch never threw.
    ingestSleeperImportedActivityMock: vi.fn(async () => ({ writer: { created: 0, updated: 0, skipped: 0 } })),
    getLeagueRostersMock: vi.fn(async () => [{ owner_id: 'owner-1', roster_id: 1 }]),
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
  ingestSleeperImportedActivity: ingestSleeperImportedActivityMock,
}))
vi.mock('@/lib/decision-os/ingestion/importedActivityNormalizer', () => ({
  buildManagerIdentityIndex: vi.fn(() => ({})),
}))
vi.mock('@/lib/sleeper-client', () => ({
  getLeagueRosters: getLeagueRostersMock,
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
  prismaMock.platformConfig.findUnique.mockResolvedValue(null)
  prismaMock.platformConfig.upsert.mockResolvedValue({})
  relayRunMock.mockResolvedValue({
    fetched: 0, dispatched: 0, retried: 0, deadLettered: 0, failed: 0, dryRun: false, failures: [],
  })
  projectImportedManagerSnapshotsMock.mockResolvedValue({
    managersWritten: 0, leaguesConsidered: 0, leaguesSkippedNative: 0,
  })
  ingestSleeperImportedActivityMock.mockResolvedValue({ writer: { created: 0, updated: 0, skipped: 0 } })
  getLeagueRostersMock.mockResolvedValue([{ owner_id: 'owner-1', roster_id: 1 }])
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

  it('records the drain under its own job name, not the one the ingest uses', async () => {
    await GET(req('/api/cron/decision-os-activity-ingest?relayOnly=1'))
    expect(syncRuns).toHaveLength(1)
    // Both modes are the same route. A shared heartbeat name would let the daily ?discover=1 fire
    // report the drain healthy on a day it never ran -- the shared-probe false green fixed in #602.
    expect(syncRuns[0]!.ctx.jobName).toBe('cron-decision-os-relay-drain')
  })

  it('leaves the ingest fire on its original job name', async () => {
    await GET(req('/api/cron/decision-os-activity-ingest?discover=1'))
    // Pinned in BOTH directions: renaming the ingest would silently orphan its existing probe and
    // its history in sync_job_runs.
    expect(syncRuns[0]!.ctx.jobName).toBe('cron-decision-os-activity-ingest')
  })

  it('has a freshness probe pointing at the drain job name', async () => {
    const { PROBES } = await import('../scripts/cron-freshness-check.mjs')
    const probe = (PROBES as Record<string, { heartbeat?: string }>)['/api/cron/decision-os-activity-ingest?relayOnly=1']
    // A cron with no probe is an invisible cron, which is the condition this whole PR exists to end.
    expect(probe?.heartbeat).toBe('cron-decision-os-relay-drain')
  })
})

/**
 * Rotation selection (2026-09-07). See the route's own header note: a plain `updatedAt desc`
 * top-N read starved any league beyond roughly the top 40 of 238 forever, because `updatedAt`
 * bumps on ANY write to the row, not just ingest-relevant activity. `mergeRotation` itself
 * (`lib/league-import/rotationPolicy.ts`) is already exhaustively unit-tested as a pure function —
 * these tests pin the WIRING around it: that this route builds the starved ordering from the
 * persisted rotation config rather than from `updatedAt`, and that it persists correctly
 * afterward.
 */
describe('decision-os-activity-ingest rotation', () => {
  /** One league per updatedAt rank, oldest last. `tail` is the very oldest — excluded by any pure demand-desc top-90 slice of 100. */
  function buildEligibleLeagues(n: number) {
    const now = Date.parse('2026-09-07T12:00:00.000Z')
    return Array.from({ length: n }, (_, i) => ({
      id: i === n - 1 ? 'tail-league' : `hot-${i}`,
      platformLeagueId: i === n - 1 ? 'sleeper-tail' : `sleeper-hot-${i}`,
      season: 2026,
      updatedAt: new Date(now - i * 60_000), // each one minute older than the last
    }))
  }

  it('🛑 a league that is oldest by updatedAt (would be excluded by pure recency) is still attempted, because it is maximally starved', async () => {
    const leagues = buildEligibleLeagues(100)
    prismaMock.league.findMany.mockResolvedValue(leagues)
    // Every OTHER league already has a recent rotation timestamp; tail-league is absent from the
    // map entirely, which is what makes it rank first in the starved ordering.
    const rotationMap: Record<string, string> = {}
    for (const l of leagues) if (l.id !== 'tail-league') rotationMap[l.id] = '2026-09-07T11:00:00.000Z'
    prismaMock.platformConfig.findUnique.mockResolvedValue({ value: JSON.stringify(rotationMap) })

    await GET(req('/api/cron/decision-os-activity-ingest?discover=1'))

    const attemptedIds = ingestSleeperImportedActivityMock.mock.calls.map(
      (c) => (c[0] as { afLeagueId: string }).afLeagueId,
    )
    expect(attemptedIds).toContain('tail-league')
    // The cap (90) is still respected — not all 100 eligible leagues run in one fire.
    expect(attemptedIds.length).toBeLessThanOrEqual(90)
  })

  it('persists a fresh timestamp for every league actually attempted this fire', async () => {
    const leagues = buildEligibleLeagues(3)
    prismaMock.league.findMany.mockResolvedValue(leagues)
    prismaMock.platformConfig.findUnique.mockResolvedValue(null)

    await GET(req('/api/cron/decision-os-activity-ingest?discover=1'))

    expect(prismaMock.platformConfig.upsert).toHaveBeenCalledTimes(1)
    const call = prismaMock.platformConfig.upsert.mock.calls[0]![0] as { create: { value: string } }
    const persisted = JSON.parse(call.create.value) as Record<string, string>
    expect(Object.keys(persisted).sort()).toEqual(['hot-0', 'hot-1', 'tail-league'].sort())
    for (const id of Object.keys(persisted)) expect(Number.isNaN(Date.parse(persisted[id]!))).toBe(false)
  })

  it('a league NOT selected this fire (over the cap) keeps its OLD rotation timestamp rather than losing its place', async () => {
    const leagues = buildEligibleLeagues(100)
    prismaMock.league.findMany.mockResolvedValue(leagues)
    const oldTimestamp = '2026-08-01T00:00:00.000Z'
    const rotationMap: Record<string, string> = {}
    // Everyone (including tail-league) already has an OLD timestamp, so ordering among the
    // starved bucket falls back to array order — the point here is only that whoever does NOT
    // get chosen this fire (there are 100 eligible, cap is 90) keeps their prior value untouched.
    for (const l of leagues) rotationMap[l.id] = oldTimestamp
    prismaMock.platformConfig.findUnique.mockResolvedValue({ value: JSON.stringify(rotationMap) })

    await GET(req('/api/cron/decision-os-activity-ingest?discover=1'))

    const call = prismaMock.platformConfig.upsert.mock.calls[0]![0] as { create: { value: string } }
    const persisted = JSON.parse(call.create.value) as Record<string, string>
    const attemptedIds = new Set(
      ingestSleeperImportedActivityMock.mock.calls.map((c) => (c[0] as { afLeagueId: string }).afLeagueId),
    )
    const untouched = leagues.map((l) => l.id).filter((id) => !attemptedIds.has(id))
    expect(untouched.length).toBeGreaterThan(0) // sanity: the cap actually excluded someone
    for (const id of untouched) expect(persisted[id]).toBe(oldTimestamp)
    for (const id of attemptedIds) expect(persisted[id]).not.toBe(oldTimestamp)
  })
})
