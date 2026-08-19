/**
 * Commissioner OS Surface Alignment — Phase B Increment 4.
 *
 * `captureLeagueSnapshotJob`/`captureLeagueSnapshotsBatchJob` are pure orchestration: real event
 * loading (`loadLeagueEvents`, mocked at the port layer exactly like `league-health-alignment.test.ts`)
 * feeds the ALREADY-BUILT, unchanged writer (`captureAndWriteBehavioralSnapshots`). This file proves
 * the job's own contract — idempotent same-day re-runs, trend-appending next-period runs, honest
 * empty capture, and per-league failure isolation in a batch — not the writer's or capture's own
 * math (covered by their existing suites).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { captureLeagueSnapshotJob, captureLeagueSnapshotsBatchJob } from '@/lib/decision-os/snapshot/captureLeagueSnapshotJob'
import { InMemoryBehavioralSnapshotStore } from '@/lib/decision-os/snapshot/behavioralSnapshotStore'
import * as port from '@/lib/decision-os/behavioral/port'
import * as realDataProvider from '@/lib/decision-os/behavioral/api/real-data-provider'
import * as snapshotStore from '@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore'
import type { RawWaiverClaimRow, RawDraftSessionRow, RawDraftPickRow } from '@/lib/decision-os/behavioral/port'

vi.mock('@/lib/decision-os/behavioral/port', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/behavioral/port')>(
    '@/lib/decision-os/behavioral/port',
  )
  return {
    ...actual,
    loadWaiverClaimRows: vi.fn(),
    loadLeagueTradeRows: vi.fn(),
    loadRosterMoveRows: vi.fn(),
    loadDraftRows: vi.fn(),
    loadRedraftTradeRows: vi.fn(),
    loadRedraftRosterPlayerRows: vi.fn(),
    loadRedraftRosterMoveRows: vi.fn(),
  }
})

vi.mock('@/lib/decision-os/behavioral/api/real-data-provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/behavioral/api/real-data-provider')>(
    '@/lib/decision-os/behavioral/api/real-data-provider',
  )
  return { ...actual, defaultLoadImportedActivityRows: vi.fn() }
})

// Not exercised by this job (only listTrend reads it), but importing the module transitively
// touches it via dashboard-intelligence's other exports — mock defensively, matching the
// established sibling suite's pattern.
vi.mock('@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore')>(
    '@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore',
  )
  return { ...actual, defaultListLeagueBehavioralTrend: vi.fn() }
})

const LG = 'league-snap-alpha'
const MGR = 'user-mgr-1'

const emptyDraftResult = () => Promise.resolve({ session: null as RawDraftSessionRow | null, picks: [] as RawDraftPickRow[] })

const makeWaiverRow = (o: Partial<RawWaiverClaimRow> = {}): RawWaiverClaimRow => ({
  id: 'wc-1', leagueId: LG, rosterId: 'roster-1', userId: MGR, addPlayerId: 'player-a', dropPlayerId: null,
  faabBid: 15, priorityOrder: 1, claimType: 'normal', status: 'awarded', processedAt: new Date('2026-07-05T12:00:00Z'),
  resultMessage: null, createdAt: new Date('2026-07-04T12:00:00Z'), ...o,
})

function mockEmptySources() {
  vi.mocked(port.loadWaiverClaimRows).mockResolvedValue([])
  vi.mocked(port.loadLeagueTradeRows).mockResolvedValue([])
  vi.mocked(port.loadRosterMoveRows).mockResolvedValue([])
  vi.mocked(port.loadDraftRows).mockImplementation(emptyDraftResult)
  vi.mocked(port.loadRedraftTradeRows).mockResolvedValue([])
  vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue([])
  vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue([])
  vi.mocked(realDataProvider.defaultLoadImportedActivityRows).mockResolvedValue([])
}

function mockWaiverActivity() {
  mockEmptySources()
  vi.mocked(port.loadWaiverClaimRows).mockResolvedValue([makeWaiverRow()])
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('captureLeagueSnapshotJob', () => {
  it('one-league capture calls the existing writer correctly: league + manager rows persisted, keyed to today', async () => {
    mockWaiverActivity()
    const store = new InMemoryBehavioralSnapshotStore()
    const now = new Date('2026-07-08T10:00:00Z')

    const result = await captureLeagueSnapshotJob(LG, { store, now })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.summary.league.status).toBe('created')
    expect(result.summary.managerCount).toBe(1)
    expect(result.summary.created).toBeGreaterThanOrEqual(1)

    const rows = store.snapshot()
    const leagueRow = rows.find((r) => r.scope === 'league')
    expect(leagueRow?.periodKey).toBe('2026-07-08')
    expect(leagueRow?.eventCount).toBeGreaterThan(0)
    const managerRow = rows.find((r) => r.scope === 'manager' && r.managerId === MGR)
    expect(managerRow).toBeDefined()
  })

  it('repeated same-day capture updates the existing rows, never duplicates', async () => {
    mockWaiverActivity()
    const store = new InMemoryBehavioralSnapshotStore()
    const now = new Date('2026-07-08T10:00:00Z')

    const first = await captureLeagueSnapshotJob(LG, { store, now })
    const second = await captureLeagueSnapshotJob(LG, { store, now: new Date('2026-07-08T18:00:00Z') })

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('unreachable')
    expect(first.summary.league.status).toBe('created')
    expect(second.summary.league.status).toBe('updated')

    const trend = await store.listTrend({ leagueId: LG })
    expect(trend).toHaveLength(1)
    expect(await store.count()).toBe(2) // 1 league row + 1 manager row, never duplicated
  })

  it('a next-period capture appends a new trend row instead of overwriting the prior one', async () => {
    mockWaiverActivity()
    const store = new InMemoryBehavioralSnapshotStore()

    await captureLeagueSnapshotJob(LG, { store, now: new Date('2026-07-08T10:00:00Z') })
    const secondDay = await captureLeagueSnapshotJob(LG, { store, now: new Date('2026-07-09T10:00:00Z') })

    expect(secondDay.ok).toBe(true)
    if (!secondDay.ok) throw new Error('unreachable')
    expect(secondDay.summary.league.status).toBe('created') // a genuinely new period key

    const trend = await store.listTrend({ leagueId: LG })
    expect(trend.map((r) => r.periodKey)).toEqual(['2026-07-08', '2026-07-09'])
  })

  it('an empty league still persists an honest zero snapshot with warnings: ["no_events"], and zero manager rows', async () => {
    mockEmptySources()
    const store = new InMemoryBehavioralSnapshotStore()

    const result = await captureLeagueSnapshotJob(LG, { store, now: new Date('2026-07-08T10:00:00Z') })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.summary.managerCount).toBe(0)

    const rows = store.snapshot()
    expect(rows).toHaveLength(1)
    expect(rows[0].scope).toBe('league')
    expect(rows[0].eventCount).toBe(0)
    expect(rows[0].facts.warnings).toContain('no_events')
  })

  it('degrades honestly (ok: false) instead of throwing when event loading fails', async () => {
    vi.mocked(port.loadWaiverClaimRows).mockRejectedValue(new Error('db_unreachable'))
    mockEmptySources() // sets defaults for the rest; the rejection above wins for loadWaiverClaimRows
    vi.mocked(port.loadWaiverClaimRows).mockRejectedValue(new Error('db_unreachable'))
    const store = new InMemoryBehavioralSnapshotStore()

    const result = await captureLeagueSnapshotJob(LG, { store, now: new Date('2026-07-08T10:00:00Z') })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBeTruthy()
    expect(await store.count()).toBe(0)
  })
})

describe('captureLeagueSnapshotsBatchJob', () => {
  it('captures every explicitly-listed league and isolates one failure from the rest', async () => {
    const store = new InMemoryBehavioralSnapshotStore()
    const failing = 'league-snap-failing'

    vi.mocked(port.loadWaiverClaimRows).mockImplementation((leagueId: string) =>
      leagueId === failing ? Promise.reject(new Error('boom')) : Promise.resolve([]),
    )
    vi.mocked(port.loadLeagueTradeRows).mockResolvedValue([])
    vi.mocked(port.loadRosterMoveRows).mockResolvedValue([])
    vi.mocked(port.loadDraftRows).mockImplementation(emptyDraftResult)
    vi.mocked(port.loadRedraftTradeRows).mockResolvedValue([])
    vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue([])
    vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue([])
    vi.mocked(realDataProvider.defaultLoadImportedActivityRows).mockResolvedValue([])

    const { ok, results } = await captureLeagueSnapshotsBatchJob([LG, failing], {
      store,
      now: new Date('2026-07-08T10:00:00Z'),
    })

    expect(ok).toBe(false)
    expect(results).toHaveLength(2)
    expect(results.find((r) => r.leagueId === LG)?.ok).toBe(true)
    const failedResult = results.find((r) => r.leagueId === failing)
    expect(failedResult?.ok).toBe(false)

    // the failing league's rows were never persisted; the healthy league's honest zero was
    const rows = store.snapshot()
    expect(rows.every((r) => r.leagueId === LG)).toBe(true)
  })
})
