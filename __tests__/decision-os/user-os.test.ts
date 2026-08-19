/**
 * Fantasy OS Suite — Phase D Increment 5.
 *
 * `resolveUserOsSnapshot` composes the already-tested `assembleManagerBehavioralFacts` →
 * `deriveManagerBehavioralIntelligence` (Phase 5.2) with the already-tested
 * `resolveManagerIntelligencePayload` (Increments 1/2) over the SAME port-level mocks
 * `league-health-alignment.test.ts` establishes — a real integration-style test at the composition
 * boundary, not a re-test of any lower layer's own correctness.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveUserOsSnapshot } from '@/lib/decision-os/userOs'
import * as port from '@/lib/decision-os/behavioral/port'
import * as realDataProvider from '@/lib/decision-os/behavioral/api/real-data-provider'
import * as snapshotStore from '@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore'
import type {
  RawWaiverClaimRow,
  RawLeagueTradeRow,
  RawRosterMoveRow,
  RawDraftSessionRow,
  RawDraftPickRow,
} from '@/lib/decision-os/behavioral/port'

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

vi.mock('@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore')>(
    '@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore',
  )
  return { ...actual, defaultListLeagueBehavioralTrend: vi.fn() }
})

const LG = 'league-user-os-alpha'
const MGR = 'user-mgr-1'
const OTHER_MGR = 'user-mgr-2'
const NOW = new Date('2026-07-08T12:00:00Z')

const emptyDraftResult = () => Promise.resolve({ session: null as RawDraftSessionRow | null, picks: [] as RawDraftPickRow[] })

const makeWaiverRow = (o: Partial<RawWaiverClaimRow> = {}): RawWaiverClaimRow => ({
  id: 'wc-1', leagueId: LG, rosterId: 'roster-1', userId: MGR, addPlayerId: 'player-a', dropPlayerId: null,
  faabBid: 15, priorityOrder: 1, claimType: 'normal', status: 'awarded', processedAt: new Date('2026-07-05T12:00:00Z'),
  resultMessage: null, createdAt: new Date('2026-07-04T12:00:00Z'), ...o,
})

const makeTradeRow = (o: Partial<RawLeagueTradeRow> = {}): RawLeagueTradeRow => ({
  id: 'trade-1', leagueId: LG, proposedByUserId: MGR, proposerRosterId: 'roster-1', receiverRosterId: 'roster-2',
  status: 'accepted', reviewType: 'no_veto', acceptedAt: new Date('2026-07-03T12:00:00Z'), rejectedAt: null,
  expiresAt: null, createdAt: new Date('2026-07-01T12:00:00Z'), itemCount: 2, ...o,
})

const makeRosterMoveRow = (o: Partial<RawRosterMoveRow> = {}): RawRosterMoveRow => ({
  id: 'rm-1', leagueId: LG, rosterId: 'roster-1', season: 2025, week: 8, actorUserId: MGR,
  source: 'user', moveSummary: null, createdAt: new Date('2026-06-28T12:00:00Z'), ...o,
})

function mockSources(overrides: {
  waivers?: RawWaiverClaimRow[]
  trades?: RawLeagueTradeRow[]
  rosterMoves?: RawRosterMoveRow[]
} = {}) {
  vi.mocked(port.loadWaiverClaimRows).mockResolvedValue(overrides.waivers ?? [])
  vi.mocked(port.loadLeagueTradeRows).mockResolvedValue(overrides.trades ?? [])
  vi.mocked(port.loadRosterMoveRows).mockResolvedValue(overrides.rosterMoves ?? [])
  vi.mocked(port.loadDraftRows).mockImplementation(emptyDraftResult)
  vi.mocked(port.loadRedraftTradeRows).mockResolvedValue([])
  vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue([])
  vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue([])
  vi.mocked(realDataProvider.defaultLoadImportedActivityRows).mockResolvedValue([])
  vi.mocked(snapshotStore.defaultListLeagueBehavioralTrend).mockResolvedValue([])
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveUserOsSnapshot', () => {
  it('a manager with real trade/waiver/roster activity gets an honest, populated team health + activity summary', async () => {
    mockSources({
      waivers: [makeWaiverRow()],
      trades: [makeTradeRow()],
      rosterMoves: [makeRosterMoveRow()],
    })

    const snapshot = await resolveUserOsSnapshot(LG, MGR, NOW)

    expect(snapshot.available).toBe(true)
    if (!snapshot.available) throw new Error('unreachable')
    expect(snapshot.teamHealth.isInactive).toBe(false)
    expect(snapshot.teamHealth.overallEngagementScore).toBeGreaterThan(0)
    expect(snapshot.activitySummary.tradeEventCount).toBeGreaterThan(0)
    expect(snapshot.activitySummary.waiverEventCount).toBeGreaterThan(0)
    expect(snapshot.managerDna).not.toBeNull()
    expect(snapshot.managerDna?.managerId).toBe(MGR)
  })

  it('a manager who is NOT the commissioner (just another active league member) still gets their own real profile', async () => {
    // MGR is the commissioner-equivalent active manager; OTHER_MGR only has a couple of waivers.
    // resolveUserOsSnapshot is called for OTHER_MGR directly, proving it works role-agnostically.
    mockSources({
      waivers: [
        makeWaiverRow({ id: 'wc-1', userId: MGR }),
        makeWaiverRow({ id: 'wc-2', userId: OTHER_MGR, rosterId: 'roster-2' }),
      ],
    })

    const snapshot = await resolveUserOsSnapshot(LG, OTHER_MGR, NOW)

    expect(snapshot.available).toBe(true)
    if (!snapshot.available) throw new Error('unreachable')
    expect(snapshot.managerId).toBe(OTHER_MGR)
    expect(snapshot.activitySummary.waiverEventCount).toBeGreaterThan(0)
  })

  it('a manager with zero activity gets an honest zero-activity baseline, never fabricated', async () => {
    mockSources()

    const snapshot = await resolveUserOsSnapshot(LG, MGR, NOW)

    expect(snapshot.available).toBe(true)
    if (!snapshot.available) throw new Error('unreachable')
    expect(snapshot.teamHealth.participationTier).toBe('inactive')
    expect(snapshot.teamHealth.overallEngagementScore).toBe(0)
    expect(snapshot.activitySummary).toEqual({
      tradeEventCount: 0,
      waiverEventCount: 0,
      lineupEventCount: 0,
      draftEventCount: 0,
    })
    expect(snapshot.managerDna?.primaryIdentity).toBe('unknown')
  })

  it('reports no_snapshots league trend honestly when no history has been captured', async () => {
    mockSources({ waivers: [makeWaiverRow()] })

    const snapshot = await resolveUserOsSnapshot(LG, MGR, NOW)

    expect(snapshot.available).toBe(true)
    if (!snapshot.available) throw new Error('unreachable')
    expect(snapshot.leagueTrend).toEqual({ available: false, reason: 'no_snapshots' })
  })

  it('degrades to an explicit user_os_unavailable state instead of throwing when a dependency fails', async () => {
    vi.mocked(port.loadWaiverClaimRows).mockRejectedValue(new Error('db_unreachable'))
    mockSources() // sets defaults for the rest
    vi.mocked(port.loadWaiverClaimRows).mockRejectedValue(new Error('db_unreachable'))

    const snapshot = await resolveUserOsSnapshot(LG, MGR, NOW)

    expect(snapshot).toEqual({
      leagueId: LG,
      managerId: MGR,
      generatedAt: NOW.toISOString(),
      available: false,
      reason: 'user_os_unavailable',
    })
  })
})
