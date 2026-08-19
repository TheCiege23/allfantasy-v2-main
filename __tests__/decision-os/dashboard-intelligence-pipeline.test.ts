/**
 * Decision OS — Phase 8.1 Intelligence Pipeline Unification tests.
 *
 * `resolveManagerIntelligencePayload` composes the ALREADY-tested Phase
 * 5.1/5.2 pipeline (covered by intelligence-api-real-provider.test.ts) with
 * the ALREADY-tested Phase 6.1/6.2/6.4 layer (covered by their own suites).
 * This file does NOT re-test that inner logic — it tests the COMPOSITION:
 * real rows in -> a real ManagerDnaProfile + RecommendationSet out, honest
 * degradation, and no fabrication.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveManagerIntelligencePayload } from '@/lib/decision-os/dashboard-intelligence'
import * as port from '@/lib/decision-os/behavioral/port'
import * as realDataProvider from '@/lib/decision-os/behavioral/api/real-data-provider'
import type {
  RawWaiverClaimRow,
  RawLeagueTradeRow,
  RawRosterMoveRow,
  RawDraftSessionRow,
  RawDraftPickRow,
  RawRedraftTradeRow,
  RawRedraftRosterPlayerRow,
  RawRedraftRosterMoveRow,
} from '@/lib/decision-os/behavioral/port'
import type { ImportedActivityEventRow } from '@/lib/decision-os/behavioral/importedActivityToEvents'
import * as snapshotStore from '@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore'
import type { BehavioralSnapshotRecord, LeagueBehavioralSnapshotRecord } from '@/lib/decision-os/snapshot/behavioralSnapshotCapture'

vi.mock('@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore')>(
    '@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore',
  )
  return {
    ...actual,
    defaultListLeagueBehavioralTrend: vi.fn(),
  }
})

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
  return {
    ...actual,
    defaultLoadImportedActivityRows: vi.fn(),
  }
})

const LG = 'league-alpha'
const MGR = 'user-mgr-1'
const OTHER_MGR = 'user-mgr-2'

const makeWaiverRow = (o: Partial<RawWaiverClaimRow> = {}): RawWaiverClaimRow => ({
  id: 'wc-1',
  leagueId: LG,
  rosterId: 'roster-1',
  userId: MGR,
  addPlayerId: 'player-a',
  dropPlayerId: null,
  faabBid: 15,
  priorityOrder: 1,
  claimType: 'normal',
  status: 'awarded',
  processedAt: new Date('2026-01-15T12:00:00Z'),
  resultMessage: null,
  createdAt: new Date('2026-01-10T12:00:00Z'),
  ...o,
})

const makeTradeRow = (o: Partial<RawLeagueTradeRow> = {}): RawLeagueTradeRow => ({
  id: 'trade-1',
  leagueId: LG,
  proposedByUserId: MGR,
  proposerRosterId: 'roster-1',
  receiverRosterId: 'roster-2',
  status: 'accepted',
  reviewType: 'no_veto',
  acceptedAt: new Date('2026-01-12T12:00:00Z'),
  rejectedAt: null,
  expiresAt: null,
  createdAt: new Date('2026-01-08T12:00:00Z'),
  itemCount: 2,
  ...o,
})

const makeRosterMoveRow = (o: Partial<RawRosterMoveRow> = {}): RawRosterMoveRow => ({
  id: 'rm-1',
  leagueId: LG,
  rosterId: 'roster-1',
  season: 2025,
  week: 8,
  actorUserId: MGR,
  source: 'user',
  moveSummary: null,
  createdAt: new Date('2026-01-05T12:00:00Z'),
  ...o,
})

const emptyDraftResult = () =>
  Promise.resolve({
    session: null as RawDraftSessionRow | null,
    picks: [] as RawDraftPickRow[],
  })

const makeRedraftTradeRow = (o: Partial<RawRedraftTradeRow> = {}): RawRedraftTradeRow => ({
  id: 'redraft-trade-1',
  leagueId: LG,
  proposerRosterId: 'roster-1',
  receiverRosterId: 'roster-2',
  proposerOwnerId: MGR,
  receiverOwnerId: OTHER_MGR,
  status: 'accepted',
  vetoMode: 'no_veto',
  acceptedAt: new Date('2026-01-12T12:00:00Z'),
  rejectedAt: null,
  expiresAt: null,
  createdAt: new Date('2026-01-08T12:00:00Z'),
  itemCount: 2,
  ...o,
})

const makeRedraftRosterPlayerRow = (o: Partial<RawRedraftRosterPlayerRow> = {}): RawRedraftRosterPlayerRow => ({
  id: 'redraft-rp-1',
  leagueId: LG,
  rosterId: 'roster-1',
  ownerUserId: MGR,
  playerId: 'player-z',
  playerName: 'Player Z',
  acquisitionType: 'free_agent',
  addedAt: new Date('2026-01-09T12:00:00Z'),
  droppedAt: null,
  ...o,
})

const makeRedraftRosterMoveRow = (o: Partial<RawRedraftRosterMoveRow> = {}): RawRedraftRosterMoveRow => ({
  id: 'redraft-rmh-1',
  leagueId: LG,
  rosterId: 'roster-1',
  seasonId: 'season-1',
  season: 2026,
  week: 7,
  actorUserId: MGR,
  source: 'user',
  createdAt: new Date('2026-01-09T12:00:00Z'),
  ...o,
})

function mockPorts(overrides: {
  waivers?: RawWaiverClaimRow[]
  trades?: RawLeagueTradeRow[]
  rosterMoves?: RawRosterMoveRow[]
  redraftTrades?: RawRedraftTradeRow[]
  redraftRosterPlayers?: RawRedraftRosterPlayerRow[]
  redraftRosterMoves?: RawRedraftRosterMoveRow[]
  importedActivity?: ImportedActivityEventRow[]
  snapshotTrend?: BehavioralSnapshotRecord[]
} = {}) {
  vi.mocked(port.loadWaiverClaimRows).mockResolvedValue(overrides.waivers ?? [])
  vi.mocked(port.loadLeagueTradeRows).mockResolvedValue(overrides.trades ?? [])
  vi.mocked(port.loadRosterMoveRows).mockResolvedValue(overrides.rosterMoves ?? [])
  vi.mocked(port.loadDraftRows).mockImplementation(emptyDraftResult)
  vi.mocked(port.loadRedraftTradeRows).mockResolvedValue(overrides.redraftTrades ?? [])
  vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue(overrides.redraftRosterPlayers ?? [])
  vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue(overrides.redraftRosterMoves ?? [])
  // Default: no imported/external-league activity — honest empty state (Commissioner OS
  // Surface Alignment, Phase B Increment 1). All pre-existing tests above exercise this default.
  vi.mocked(realDataProvider.defaultLoadImportedActivityRows).mockResolvedValue(overrides.importedActivity ?? [])
  // Default: no captured snapshot history — honest "no_snapshots" (Phase B Increment 2).
  vi.mocked(snapshotStore.defaultListLeagueBehavioralTrend).mockResolvedValue(overrides.snapshotTrend ?? [])
}

function makeImportedActivityRow(o: Partial<ImportedActivityEventRow> = {}): ImportedActivityEventRow {
  return {
    externalSourceKey: 'dos:act:sleeper:league-alpha:trade:txn-1',
    provider: 'sleeper',
    afLeagueId: null,
    providerLeagueId: LG,
    activityType: 'trade',
    occurredAt: '2026-01-12T12:00:00.000Z',
    createdAt: '2026-01-12T12:00:00.000Z',
    normalized: { managerKeys: [MGR], hasExternalOnlyManager: false },
    appUserId: null,
    ...o,
  }
}

const DEFAULT_UNAVAILABLE_TREND = { available: false, reason: 'no_snapshots' } as const

function makeLeagueSnapshotRecord(o: Partial<LeagueBehavioralSnapshotRecord> = {}): LeagueBehavioralSnapshotRecord {
  return {
    scope: 'league',
    leagueId: LG,
    managerId: null,
    cadence: 'daily',
    periodKey: '2026-01-08',
    capturedAt: '2026-01-08T12:00:00.000Z',
    lookbackDays: 90,
    eventCount: 3,
    completeness: 100,
    facts: {
      leagueId: LG,
      totalTradeCount: 1,
      totalWaiverClaimCount: 0,
      totalWaiverSuccessCount: 0,
      totalCommissionerActionCount: 0,
      totalRulesChangeCount: 0,
      activeManagerIds: [MGR],
      lastActivity: null,
      draftCount: 0,
      totalDraftPickCount: 0,
      completeness: 100,
      eventCount: 3,
      managerCount: 1,
      lookbackDays: 90,
      warnings: [],
    },
    ...o,
  }
}

describe('resolveManagerIntelligencePayload', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns a real, non-null ManagerDnaProfile + RecommendationSet for a manager with real activity', async () => {
    mockPorts({
      waivers: [
        makeWaiverRow({ id: 'wc-1' }),
        makeWaiverRow({ id: 'wc-2', createdAt: new Date('2026-01-11T12:00:00Z') }),
        makeWaiverRow({ id: 'wc-3', createdAt: new Date('2026-01-12T12:00:00Z') }),
      ],
      trades: [makeTradeRow()],
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.managerId).toBe(MGR)
    expect(result.managerDna!.leagueId).toBe(LG)
    expect(result.recommendations).not.toBeNull()
    expect(result.recommendations!.entityId).toBe(MGR)
    expect(result.recommendations!.tier).toBe('manager')
  })

  it('never fabricates: a manager with zero events gets an honest zero-activity profile, not a skipped one', async () => {
    mockPorts()

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.primaryIdentity).toBe('unknown')
    expect(result.managerDna!.confidence).toBe(0)
  })

  it('is degraded-safe: a port throwing never rejects the call, returns honest nulls instead', async () => {
    vi.mocked(port.loadWaiverClaimRows).mockRejectedValue(new Error('DB unavailable'))
    vi.mocked(port.loadLeagueTradeRows).mockResolvedValue([])
    vi.mocked(port.loadRosterMoveRows).mockResolvedValue([])
    vi.mocked(port.loadDraftRows).mockImplementation(emptyDraftResult)
    vi.mocked(port.loadRedraftTradeRows).mockResolvedValue([])
    vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue([])
    vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue([])
    vi.mocked(realDataProvider.defaultLoadImportedActivityRows).mockResolvedValue([])
    vi.mocked(snapshotStore.defaultListLeagueBehavioralTrend).mockResolvedValue([])

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result).toEqual({ managerDna: null, recommendations: null, leagueTrend: DEFAULT_UNAVAILABLE_TREND })
  })

  it('is degraded-safe when specifically the NEW redraft loaders fail (missing redraft data fails safely)', async () => {
    vi.mocked(port.loadWaiverClaimRows).mockResolvedValue([])
    vi.mocked(port.loadLeagueTradeRows).mockResolvedValue([])
    vi.mocked(port.loadRosterMoveRows).mockResolvedValue([])
    vi.mocked(port.loadDraftRows).mockImplementation(emptyDraftResult)
    vi.mocked(port.loadRedraftTradeRows).mockRejectedValue(new Error('redraft_trade_proposals unavailable'))
    vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue([])
    vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue([])
    vi.mocked(realDataProvider.defaultLoadImportedActivityRows).mockResolvedValue([])
    vi.mocked(snapshotStore.defaultListLeagueBehavioralTrend).mockResolvedValue([])

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result).toEqual({ managerDna: null, recommendations: null, leagueTrend: DEFAULT_UNAVAILABLE_TREND })
  })

  it('is degraded-safe when specifically the Phase 2H lineup-history loader fails (missing history fails safely)', async () => {
    vi.mocked(port.loadWaiverClaimRows).mockResolvedValue([])
    vi.mocked(port.loadLeagueTradeRows).mockResolvedValue([])
    vi.mocked(port.loadRosterMoveRows).mockResolvedValue([])
    vi.mocked(port.loadDraftRows).mockImplementation(emptyDraftResult)
    vi.mocked(port.loadRedraftTradeRows).mockResolvedValue([])
    vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue([])
    vi.mocked(port.loadRedraftRosterMoveRows).mockRejectedValue(new Error('redraft_roster_move_history unavailable'))
    vi.mocked(realDataProvider.defaultLoadImportedActivityRows).mockResolvedValue([])
    vi.mocked(snapshotStore.defaultListLeagueBehavioralTrend).mockResolvedValue([])

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result).toEqual({ managerDna: null, recommendations: null, leagueTrend: DEFAULT_UNAVAILABLE_TREND })
  })

  it('is degraded-safe when specifically the imported-activity loader fails (missing imported activity fails safely, Commissioner OS Surface Alignment)', async () => {
    vi.mocked(port.loadWaiverClaimRows).mockResolvedValue([])
    vi.mocked(port.loadLeagueTradeRows).mockResolvedValue([])
    vi.mocked(port.loadRosterMoveRows).mockResolvedValue([])
    vi.mocked(port.loadDraftRows).mockImplementation(emptyDraftResult)
    vi.mocked(port.loadRedraftTradeRows).mockResolvedValue([])
    vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue([])
    vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue([])
    vi.mocked(realDataProvider.defaultLoadImportedActivityRows).mockRejectedValue(new Error('decision_os_imported_activity unavailable'))
    vi.mocked(snapshotStore.defaultListLeagueBehavioralTrend).mockResolvedValue([])

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result).toEqual({ managerDna: null, recommendations: null, leagueTrend: DEFAULT_UNAVAILABLE_TREND })
  })

  it('a trend-read failure is independent: managerDna/recommendations still resolve normally when the snapshot store throws (Phase B Increment 2)', async () => {
    mockPorts({
      waivers: [makeWaiverRow({ id: 'wc-1' })],
      trades: [makeTradeRow()],
    })
    vi.mocked(snapshotStore.defaultListLeagueBehavioralTrend).mockRejectedValue(new Error('decision_os_behavioral_snapshot unavailable'))

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result.managerDna).not.toBeNull() // unaffected by the trend failure
    expect(result.recommendations).not.toBeNull()
    expect(result.leagueTrend).toEqual(DEFAULT_UNAVAILABLE_TREND) // honest, not thrown
  })

  it('includes other active managers in the same league so Phase 6.1/6.2 classify against the real league context', async () => {
    mockPorts({
      waivers: [makeWaiverRow({ userId: OTHER_MGR, rosterId: 'roster-2' })],
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    // The target manager (zero events of their own) still gets an honest profile —
    // the other manager's activity does not leak into the target's identity.
    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.managerId).toBe(MGR)
    expect(result.managerDna!.primaryIdentity).toBe('unknown')
  })

  it('calls the same real ports the live Intelligence API uses, with the league id and a since Date', async () => {
    mockPorts()
    await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(port.loadWaiverClaimRows).toHaveBeenCalledWith(LG, expect.any(Date))
    expect(port.loadLeagueTradeRows).toHaveBeenCalledWith(LG, expect.any(Date))
    expect(port.loadRosterMoveRows).toHaveBeenCalledWith(LG, expect.any(Date))
    expect(port.loadDraftRows).toHaveBeenCalledWith(LG)
    expect(port.loadRedraftTradeRows).toHaveBeenCalledWith(LG, expect.any(Date))
    expect(port.loadRedraftRosterPlayerRows).toHaveBeenCalledWith(LG, expect.any(Date))
  })

  // ── Phase 2E: redraft trade + roster activity now visible to Phase 6 DNA ────

  it('existing Af*/WaiverClaim-only behavior is unchanged when there is zero redraft data (regression guard)', async () => {
    mockPorts({
      waivers: [makeWaiverRow({ id: 'wc-1' }), makeWaiverRow({ id: 'wc-2', createdAt: new Date('2026-01-11T12:00:00Z') }), makeWaiverRow({ id: 'wc-3', createdAt: new Date('2026-01-12T12:00:00Z') })],
      trades: [makeTradeRow()],
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    // Byte-identical assertions to the pre-Phase-2E "real activity" test above —
    // adding the two new (empty-by-default) redraft loaders changes nothing
    // when there's no redraft data for this league.
    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.managerId).toBe(MGR)
    expect(result.managerDna!.leagueId).toBe(LG)
    expect(result.recommendations).not.toBeNull()
    expect(result.recommendations!.entityId).toBe(MGR)
    expect(result.recommendations!.tier).toBe('manager')
  })

  it('redraft trade activity alone (zero Af*/WaiverClaim data) now contributes to a real, non-unknown profile', async () => {
    mockPorts({
      redraftTrades: [
        makeRedraftTradeRow({ id: 'rt-1' }),
        makeRedraftTradeRow({ id: 'rt-2', createdAt: new Date('2026-01-09T12:00:00Z'), acceptedAt: new Date('2026-01-13T12:00:00Z') }),
        makeRedraftTradeRow({ id: 'rt-3', createdAt: new Date('2026-01-10T12:00:00Z'), acceptedAt: new Date('2026-01-14T12:00:00Z') }),
      ],
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    // Before this phase, this input (real activity ONLY in redraft tables) would
    // have produced 'passive' transactionStyle — nothing read RedraftTradeProposal
    // at all, so the trade-rate signal driving deriveTransactionStyle() would
    // have been zero regardless of how much real trading this manager did.
    // Whether primaryIdentity crosses into a specific non-'unknown' label
    // additionally depends on Phase 6.1's own pattern-detection thresholds
    // (a separately-tested layer, see __tests__/decision-os/phase6/manager-dna.test.ts)
    // — transactionStyle is the reliable, directly-attributable signal this
    // test proves redraft trade data now reaches.
    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.transactionStyle).toBe('trade_dominant')
  })

  it('redraft roster (free_agent) activity contributes when enough of it exists', async () => {
    // 10 free-agent adds over the 90-day default lookback pushes
    // lineupEditsPerWeek decisively above deriveDecisionStyle's 0.5
    // threshold (10 / (90/7) ≈ 0.78/week) — a reliable, directly-attributable
    // signal distinguishing "roster activity reached this profile" from the
    // zero-activity baseline (which falls into the `< 0.5 → 'decisive'`
    // branch instead; see the baseline test above).
    mockPorts({
      redraftRosterPlayers: Array.from({ length: 10 }, (_, i) =>
        makeRedraftRosterPlayerRow({ id: `rp-${i}`, addedAt: new Date(`2026-01-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`) }),
      ),
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.decisionStyle).toBe('methodical')
  })

  it('does not double-count: waiver/trade/drafted-acquired RedraftRosterPlayer rows are excluded (already covered by their own sources)', async () => {
    mockPorts({
      redraftRosterPlayers: [
        makeRedraftRosterPlayerRow({ id: 'rp-waiver', acquisitionType: 'waiver' }),
        makeRedraftRosterPlayerRow({ id: 'rp-trade', acquisitionType: 'trade' }),
        makeRedraftRosterPlayerRow({ id: 'rp-drafted', acquisitionType: 'drafted' }),
      ],
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    // None of these three rows should contribute a lineup_saved-derived signal —
    // the manager should look identical to the zero-activity case.
    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.primaryIdentity).toBe('unknown')
    expect(result.managerDna!.confidence).toBe(0)
  })

  it('missing/absent redraft data fails safely — resolves normally with the two new sources simply empty', async () => {
    mockPorts({ redraftTrades: [], redraftRosterPlayers: [] })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.primaryIdentity).toBe('unknown')
    expect(result.recommendations).not.toBeNull()
  })

  // ── Phase 2H: redraft lineup-history (real week) now visible to Phase 6 DNA ─

  it('calls loadRedraftRosterMoveRows with the league id and a since Date', async () => {
    mockPorts()
    await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })
    expect(port.loadRedraftRosterMoveRows).toHaveBeenCalledWith(LG, expect.any(Date))
  })

  it('existing behavior (waivers + redraft trades) is unchanged when there is zero lineup-history data (regression guard)', async () => {
    mockPorts({
      waivers: [makeWaiverRow({ id: 'wc-1' })],
      // 2+ trades is the measured minimum to flip transactionStyle (see the
      // Phase 2F/2G sensitivity findings) — matches the existing "redraft
      // trade activity alone" test above exactly.
      redraftTrades: [makeRedraftTradeRow({ id: 'rt-1' }), makeRedraftTradeRow({ id: 'rt-2', createdAt: new Date('2026-01-09T12:00:00Z') })],
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.transactionStyle).toBe('trade_dominant')
  })

  it('a real week now reaches Phase 6.1 pattern detection — something free-agent-only signal (Phase 2E) could never do', async () => {
    // 4 lineup-history rows in the SAME real week (5) — previously impossible:
    // mapRedraftRosterPlayerToLineupSavedEvent (Phase 2E) has to leave
    // metadata.week null, and patterns.ts explicitly skips week=null events.
    // This scenario is only reachable at all because Phase 2H's mapper
    // carries a real week value.
    mockPorts({
      redraftRosterMoves: Array.from({ length: 4 }, (_, i) =>
        makeRedraftRosterMoveRow({ id: `rmh-${i}`, week: 5, createdAt: new Date(2026, 0, i + 1, 12) }),
      ),
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result.managerDna).not.toBeNull()
    // Measured directly (not hand-derived): deriveDecisionStyle checks for a
    // repeated_lineup_indecision pattern BEFORE falling back to a rate-based
    // check — this identity is unreachable without a real week value.
    expect(result.managerDna!.decisionStyle).toBe('indecisive')
    expect(result.managerDna!.traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trait: 'lineup_tinkerer', evidence: ['1 week(s) with 3+ lineup saves'] }),
      ]),
    )
  })

  it('does not double-count: this source is additive alongside free-agent roster signal, not a replacement', async () => {
    mockPorts({
      redraftRosterPlayers: [makeRedraftRosterPlayerRow({ id: 'rp-1' })],
      redraftRosterMoves: [makeRedraftRosterMoveRow({ id: 'rmh-1' })],
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    // Both sources contribute to the same manager's facts without conflict —
    // no crash, no duplicate-event rejection, a real (non-error) profile.
    expect(result.managerDna).not.toBeNull()
  })

  // ── Commissioner OS Surface Alignment (Phase B Increment 1): imported/external- ──
  // league activity (Decision OS Phase A) now reaches this ALREADY-LIVE surface too
  // (Commissioner Hub, Dashboard Overview, LeagueTab all call resolveManagerIntelligencePayload
  // via this file), not just the flag-gated realDataProvider path.

  it('regression: existing behavior is unchanged when there is zero imported activity (the default)', async () => {
    mockPorts({
      waivers: [makeWaiverRow({ id: 'wc-1' })],
      trades: [makeTradeRow()],
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.managerId).toBe(MGR)
    expect(result.recommendations).not.toBeNull()
  })

  it('imported Sleeper trade activity ALONE (zero AF-native/redraft data) now contributes to a real, non-unknown profile', async () => {
    mockPorts({
      importedActivity: [
        makeImportedActivityRow({ externalSourceKey: 'dos:act:sleeper:league-alpha:trade:txn-1', occurredAt: '2026-01-08T12:00:00.000Z' }),
        makeImportedActivityRow({ externalSourceKey: 'dos:act:sleeper:league-alpha:trade:txn-2', occurredAt: '2026-01-09T12:00:00.000Z' }),
      ],
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    // Before this alignment, imported activity never reached this composition at all —
    // only real-data-provider.ts's separate (and, per the surface audit, not-UI-wired)
    // path saw it. transactionStyle is the reliable, directly-attributable signal proving
    // imported trade data now reaches the SAME pipeline the live UI calls.
    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.transactionStyle).toBe('trade_dominant')
  })

  it('an EXTERNAL-ONLY manager (no AllFantasy account) gets a real profile from imported activity alone — the core Replacements-demo case', async () => {
    const externalManagerKey = 'sleeper:user:9001'
    mockPorts({
      importedActivity: [
        makeImportedActivityRow({
          externalSourceKey: 'dos:act:sleeper:league-alpha:waiver:wv-1',
          activityType: 'waiver',
          normalized: { managerKeys: [externalManagerKey], hasExternalOnlyManager: true },
        }),
      ],
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: externalManagerKey })

    // The real, directly-attributable proof: a stable provider key (no AppUser id, no AF
    // account) resolves to a real profile keyed to that exact id, with real recommendations.
    // Whether it crosses into a specific non-'unknown' DNA label additionally depends on
    // Phase 6.1's own pattern-detection thresholds (a separately-tested layer) — matching
    // this file's existing convention of not asserting that layer's internals here.
    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.managerId).toBe(externalManagerKey) // no AppUser id required
    expect(result.managerDna!.leagueId).toBe(LG)
    expect(result.recommendations).not.toBeNull()
    expect(result.recommendations!.entityId).toBe(externalManagerKey)
  })

  it('never fakes trend/demo metrics: an empty imported-activity result still yields the SAME honest zero-activity baseline as before this alignment', async () => {
    mockPorts({ importedActivity: [] })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result.managerDna).not.toBeNull()
    expect(result.managerDna!.primaryIdentity).toBe('unknown')
    expect(result.managerDna!.confidence).toBe(0)
  })

  it('calls defaultLoadImportedActivityRows with the league id and a since Date, alongside the other real sources', async () => {
    mockPorts()
    await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(realDataProvider.defaultLoadImportedActivityRows).toHaveBeenCalledWith(LG, expect.any(Date))
  })

  // ── Phase B Increment 2: league activity trend, wired additively into this ──
  // ALREADY-LIVE composition. `leagueTrend` never affects managerDna/recommendations.

  describe('leagueTrend (Decision OS Phase A snapshot/trend history, surfaced here)', () => {
    it('an empty league (zero captured snapshots) is honestly unavailable — reason "no_snapshots", never a fabricated trend', async () => {
      mockPorts({ snapshotTrend: [] })

      const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

      expect(result.leagueTrend).toEqual({ available: false, reason: 'no_snapshots' })
    })

    it('a single captured snapshot is insufficient history — reason "insufficient_history", not a fake direction', async () => {
      mockPorts({
        snapshotTrend: [makeLeagueSnapshotRecord({ periodKey: '2026-01-08', eventCount: 3 })],
      })

      const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

      expect(result.leagueTrend).toEqual({ available: false, reason: 'insufficient_history' })
    })

    it('two or more captured periods produce a real, honest trend: direction, delta, and period fields', async () => {
      mockPorts({
        snapshotTrend: [
          makeLeagueSnapshotRecord({
            periodKey: '2026-01-08',
            eventCount: 3,
            facts: { ...makeLeagueSnapshotRecord().facts, eventCount: 3, activeManagerIds: [MGR] },
          }),
          makeLeagueSnapshotRecord({
            periodKey: '2026-01-09',
            eventCount: 7,
            facts: { ...makeLeagueSnapshotRecord().facts, eventCount: 7, totalTradeCount: 2, activeManagerIds: [MGR, 'sleeper:user:2'] },
          }),
        ],
      })

      const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

      expect(result.leagueTrend).toEqual({
        available: true,
        periodsTracked: 2,
        earliestPeriodKey: '2026-01-08',
        latestPeriodKey: '2026-01-09',
        latestEventCount: 7,
        latestManagerCount: 2,
        eventCountDelta: 4,
        direction: 'increasing',
      })
    })

    it('a declining period-over-period event count is reported honestly as "decreasing", not smoothed or hidden', async () => {
      mockPorts({
        snapshotTrend: [
          makeLeagueSnapshotRecord({ periodKey: '2026-01-08', eventCount: 10 }),
          makeLeagueSnapshotRecord({ periodKey: '2026-01-09', eventCount: 4 }),
        ],
      })

      const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

      expect(result.leagueTrend).toMatchObject({ available: true, direction: 'decreasing', eventCountDelta: -6 })
    })

    it('an unchanged event count across periods is reported as "flat", not fabricated movement', async () => {
      mockPorts({
        snapshotTrend: [
          makeLeagueSnapshotRecord({ periodKey: '2026-01-08', eventCount: 5 }),
          makeLeagueSnapshotRecord({ periodKey: '2026-01-09', eventCount: 5 }),
        ],
      })

      const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

      expect(result.leagueTrend).toMatchObject({ available: true, direction: 'flat', eventCountDelta: 0 })
    })

    it('imported/external-league activity contributes to the trend facts: a snapshot capturing an external-only manager reflects them in latestManagerCount', async () => {
      mockPorts({
        snapshotTrend: [
          makeLeagueSnapshotRecord({
            periodKey: '2026-01-08',
            eventCount: 2,
            facts: { ...makeLeagueSnapshotRecord().facts, eventCount: 2, activeManagerIds: [MGR] },
          }),
          makeLeagueSnapshotRecord({
            periodKey: '2026-01-09',
            eventCount: 4,
            // 'sleeper:user:2' is a stable external-manager key (no AllFantasy account) —
            // exactly how Increment 3/4's imported activity attributes non-AF managers.
            facts: { ...makeLeagueSnapshotRecord().facts, eventCount: 4, activeManagerIds: [MGR, 'sleeper:user:2'] },
          }),
        ],
      })

      const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

      expect(result.leagueTrend).toMatchObject({ available: true, latestManagerCount: 2 })
    })

    it('existing dashboard-intelligence behavior (managerDna/recommendations) is unchanged when there are no snapshots (regression guard)', async () => {
      mockPorts({
        waivers: [makeWaiverRow({ id: 'wc-1' })],
        trades: [makeTradeRow()],
        snapshotTrend: [],
      })

      const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

      // Byte-identical to the pre-Increment-2 "real activity" assertions — adding the
      // (empty-by-default) trend field changes nothing about the existing payload fields.
      expect(result.managerDna).not.toBeNull()
      expect(result.managerDna!.managerId).toBe(MGR)
      expect(result.managerDna!.leagueId).toBe(LG)
      expect(result.recommendations).not.toBeNull()
      expect(result.recommendations!.entityId).toBe(MGR)
      expect(result.recommendations!.tier).toBe('manager')
      expect(result.leagueTrend).toEqual({ available: false, reason: 'no_snapshots' })
    })

    it('calls defaultListLeagueBehavioralTrend with the league id (league scope, no managerId)', async () => {
      mockPorts()
      await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

      expect(snapshotStore.defaultListLeagueBehavioralTrend).toHaveBeenCalledWith(LG)
    })
  })
})
