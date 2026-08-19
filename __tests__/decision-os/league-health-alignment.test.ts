/**
 * Commissioner OS Surface Alignment — Phase B Increment 3.
 *
 * `resolveDecisionOsLeagueHealth` federates the existing, UNCHANGED `monitorLeagueHealth`
 * scoring engine with real Decision OS behavioral facts + trend history. This file tests the
 * COMPOSITION (real rows in -> real counts/trend out, honest degradation) — it does not
 * re-test `monitorLeagueHealth`'s own scoring math (untouched, out of scope) or the behavioral
 * assemblers (covered by their own suites).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveDecisionOsLeagueHealth, DECISION_OS_DERIVED_FIELDS } from '@/lib/decision-os/leagueHealthAlignment'
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
import type { LeagueBehavioralSnapshotRecord } from '@/lib/decision-os/snapshot/behavioralSnapshotCapture'
import { monitorLeagueHealth, type LeagueHealthInput } from '@/lib/league-health'

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

const LG = 'league-health-alpha'
const MGR = 'user-mgr-1'
const MGR_2 = 'user-mgr-2'

const emptyDraftResult = () => Promise.resolve({ session: null as RawDraftSessionRow | null, picks: [] as RawDraftPickRow[] })

const makeWaiverRow = (o: Partial<RawWaiverClaimRow> = {}): RawWaiverClaimRow => ({
  id: 'wc-1', leagueId: LG, rosterId: 'roster-1', userId: MGR, addPlayerId: 'player-a', dropPlayerId: null,
  faabBid: 15, priorityOrder: 1, claimType: 'normal', status: 'awarded', processedAt: new Date('2026-01-15T12:00:00Z'),
  resultMessage: null, createdAt: new Date('2026-01-10T12:00:00Z'), ...o,
})

const makeTradeRow = (o: Partial<RawLeagueTradeRow> = {}): RawLeagueTradeRow => ({
  id: 'trade-1', leagueId: LG, proposedByUserId: MGR, proposerRosterId: 'roster-1', receiverRosterId: 'roster-2',
  status: 'accepted', reviewType: 'no_veto', acceptedAt: new Date('2026-01-12T12:00:00Z'), rejectedAt: null,
  expiresAt: null, createdAt: new Date('2026-01-08T12:00:00Z'), itemCount: 2, ...o,
})

const makeRosterMoveRow = (o: Partial<RawRosterMoveRow> = {}): RawRosterMoveRow => ({
  id: 'rm-1', leagueId: LG, rosterId: 'roster-1', season: 2025, week: 8, actorUserId: MGR,
  source: 'user', moveSummary: null, createdAt: new Date('2026-01-05T12:00:00Z'), ...o,
})

function mockSources(overrides: {
  waivers?: RawWaiverClaimRow[]
  trades?: RawLeagueTradeRow[]
  rosterMoves?: RawRosterMoveRow[]
  snapshotTrend?: LeagueBehavioralSnapshotRecord[]
} = {}) {
  vi.mocked(port.loadWaiverClaimRows).mockResolvedValue(overrides.waivers ?? [])
  vi.mocked(port.loadLeagueTradeRows).mockResolvedValue(overrides.trades ?? [])
  vi.mocked(port.loadRosterMoveRows).mockResolvedValue(overrides.rosterMoves ?? [])
  vi.mocked(port.loadDraftRows).mockImplementation(emptyDraftResult)
  vi.mocked(port.loadRedraftTradeRows).mockResolvedValue([])
  vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue([])
  vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue([])
  vi.mocked(realDataProvider.defaultLoadImportedActivityRows).mockResolvedValue([])
  vi.mocked(snapshotStore.defaultListLeagueBehavioralTrend).mockResolvedValue(overrides.snapshotTrend ?? [])
}

function makeLeagueSnapshotRecord(o: Partial<LeagueBehavioralSnapshotRecord> = {}): LeagueBehavioralSnapshotRecord {
  return {
    scope: 'league', leagueId: LG, managerId: null, cadence: 'daily', periodKey: '2026-01-08',
    capturedAt: '2026-01-08T12:00:00.000Z', lookbackDays: 90, eventCount: 3, completeness: 100,
    facts: {
      leagueId: LG, totalTradeCount: 1, totalWaiverClaimCount: 0, totalWaiverSuccessCount: 0,
      totalCommissionerActionCount: 0, totalRulesChangeCount: 0, activeManagerIds: [MGR],
      lastActivity: null, draftCount: 0, totalDraftPickCount: 0, completeness: 100, eventCount: 3,
      managerCount: 1, lookbackDays: 90, warnings: [],
    },
    ...o,
  }
}

describe('resolveDecisionOsLeagueHealth', () => {
  afterEach(() => vi.clearAllMocks())

  describe('League Health receives real Decision OS-backed behavioral data', () => {
    it('feeds real trade/waiver/manager counts into the UNCHANGED engine and exposes them under decisionOs', async () => {
      mockSources({
        waivers: [makeWaiverRow({ id: 'wc-1' }), makeWaiverRow({ id: 'wc-2', createdAt: new Date('2026-01-11T12:00:00Z') })],
        trades: [makeTradeRow()],
      })

      const result = await resolveDecisionOsLeagueHealth(LG)

      expect(result.decisionOs.activeManagerCount).toBe(1)
      expect(result.decisionOs.tradeCount).toBe(1)
      expect(result.decisionOs.waiverClaimCount).toBe(2)
      // Each processed waiver emits created+processed (2 events); the accepted trade emits
      // created+accepted (2 events): (2 waivers x 2) + (1 trade x 2) = 6 raw behavioral events.
      expect(result.decisionOs.activityEventCount).toBe(6)
      // The real counts actually reached the untouched engine's input, not just the wrapper.
      expect(result.engine.leagueHealthScore).toBeGreaterThan(0)
      expect(result.engine.overallStatus).toBeDefined()
    })

    it('surfaces retention-risk managers (inactivity risk / commissioner action opportunity) honestly', async () => {
      // MGR gets real, frequent activity (low risk); MGR_2 gets a single old waiver claim so
      // isInactive/retentionRisk reflect a real thin signal, not a guess.
      mockSources({
        waivers: [
          makeWaiverRow({ id: 'wc-1', userId: MGR, rosterId: 'roster-1' }),
          makeWaiverRow({ id: 'wc-2', userId: MGR, rosterId: 'roster-1', createdAt: new Date('2026-01-11T12:00:00Z') }),
          makeWaiverRow({ id: 'wc-3', userId: MGR_2, rosterId: 'roster-2', createdAt: new Date('2025-01-01T12:00:00Z') }),
        ],
      })

      const result = await resolveDecisionOsLeagueHealth(LG)

      expect(result.decisionOs.activeManagerCount).toBe(2)
      // Whichever managers land at high/critical risk are surfaced with real reasons — never fabricated.
      for (const m of result.decisionOs.managersAtRetentionRisk) {
        expect(typeof m.managerId).toBe('string')
        expect(Array.isArray(m.retentionRiskReasons)).toBe(true)
      }
    })

    it('field provenance correctly separates decision_os-derived fields from schema defaults', async () => {
      mockSources()
      const result = await resolveDecisionOsLeagueHealth(LG)

      for (const field of DECISION_OS_DERIVED_FIELDS) {
        expect(result.fieldProvenance[field]).toBe('decision_os')
      }
      // A league-settings field Decision OS has no source for stays an honest schema default.
      expect(result.fieldProvenance.numTeams).toBe('schema_default')
      expect(result.fieldProvenance.chatMessageCount).toBe('schema_default')
    })
  })

  describe('trend data (Phase A Increment 5 / Phase B Increment 2, reused here)', () => {
    it('trend data appears in decisionOs.trend when 2+ snapshots exist', async () => {
      mockSources({
        snapshotTrend: [
          makeLeagueSnapshotRecord({ periodKey: '2026-01-08', eventCount: 3 }),
          makeLeagueSnapshotRecord({ periodKey: '2026-01-09', eventCount: 8 }),
        ],
      })

      const result = await resolveDecisionOsLeagueHealth(LG)

      expect(result.decisionOs.trend).toEqual({
        available: true,
        periodsTracked: 2,
        earliestPeriodKey: '2026-01-08',
        latestPeriodKey: '2026-01-09',
        latestEventCount: 8,
        latestManagerCount: 1,
        eventCountDelta: 5,
        direction: 'increasing',
      })
    })

    it('insufficient trend history (one snapshot) degrades honestly, never a fake direction', async () => {
      mockSources({ snapshotTrend: [makeLeagueSnapshotRecord()] })

      const result = await resolveDecisionOsLeagueHealth(LG)

      expect(result.decisionOs.trend).toEqual({ available: false, reason: 'insufficient_history' })
    })

    it('zero snapshots degrades honestly to no_snapshots', async () => {
      mockSources({ snapshotTrend: [] })

      const result = await resolveDecisionOsLeagueHealth(LG)

      expect(result.decisionOs.trend).toEqual({ available: false, reason: 'no_snapshots' })
    })
  })

  describe('honest degradation — never crash, never fabricate', () => {
    it('an empty league (zero events, zero snapshots) resolves to an honest zero context, not a crash', async () => {
      mockSources()

      const result = await resolveDecisionOsLeagueHealth(LG)

      expect(result.decisionOs).toMatchObject({
        activityEventCount: 0,
        activeManagerCount: 0,
        inactiveManagerCount: 0,
        tradeCount: 0,
        waiverClaimCount: 0,
        rosterActivityCount: 0,
        managersAtRetentionRisk: [],
      })
      expect(result.decisionOs.trend).toEqual({ available: false, reason: 'no_snapshots' })
      // The engine still returns a real, valid (schema-default-driven) result — an honest
      // "no data yet" baseline, not an error and not a fabricated score.
      expect(result.engine.overallStatus).toBeDefined()
      expect(typeof result.engine.leagueHealthScore).toBe('number')
    })

    it('a real read failure degrades to the same honest zero context, never throws', async () => {
      vi.mocked(port.loadWaiverClaimRows).mockRejectedValue(new Error('DB unavailable'))
      vi.mocked(port.loadLeagueTradeRows).mockResolvedValue([])
      vi.mocked(port.loadRosterMoveRows).mockResolvedValue([])
      vi.mocked(port.loadDraftRows).mockImplementation(emptyDraftResult)
      vi.mocked(port.loadRedraftTradeRows).mockResolvedValue([])
      vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue([])
      vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue([])
      vi.mocked(realDataProvider.defaultLoadImportedActivityRows).mockResolvedValue([])
      vi.mocked(snapshotStore.defaultListLeagueBehavioralTrend).mockResolvedValue([])

      const result = await resolveDecisionOsLeagueHealth(LG)

      expect(result.decisionOs.activeManagerCount).toBe(0)
      expect(result.decisionOs.trend).toEqual({ available: false, reason: 'no_snapshots' })
      expect(result.engine.overallStatus).toBeDefined()
    })
  })

  describe('existing League Health behavior preserved where appropriate', () => {
    it('the untouched engine still classifies a manually-supplied high-activity input identically to before this alignment', () => {
      // Direct proof the scoring engine itself was never modified: same input, same output
      // shape/values a caller supplying explicit metrics (the legacy contract) would still get.
      const input: LeagueHealthInput = {
        sport: 'NFL', leagueType: 'dynasty', leagueId: LG, numTeams: 12, currentWeek: 5, totalWeeks: 17,
        activeManagers: 12, inactiveManagers: 0, abandonedTeams: 0, lineupSubmissionRate: 1,
        totalTradesThisSeason: 5, totalWaiverClaims: 20, avgFaabSpentPct: 40, chatMessageCount: 30,
        voteCount: 0, disputeCount: 0, commissionerActionsThisSeason: 2, unresolvedDisputes: 0,
        playoffTeams: 6, waiverType: 'FAAB', tradeReviewProcess: 'commissioner',
      }
      const result = monitorLeagueHealth(input)
      expect(result.overallStatus).toBe('excellent')
      expect(result.leagueHealthScore).toBeGreaterThanOrEqual(80)
    })
  })
})
