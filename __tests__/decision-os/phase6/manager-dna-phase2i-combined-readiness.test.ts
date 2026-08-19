/**
 * Decision OS — Phase 2I readiness measurement
 * (docs/DECISION_OS_MANAGER_DNA_PHASE2I_READINESS_AFTER_LINEUP_HISTORY.md).
 *
 * Phase 2F measured trade+free-agent volume in isolation. Phase 2G swept
 * volume ranges and found free-agent-only signal could never escape
 * 'unknown'. Phase 2H added real-week lineup-history, proving in isolation
 * that it unlocks pattern-gated classifiers free-agent signal never could.
 *
 * This file measures what happens when ALL FOUR real redraft signal sources
 * (trades, waivers, free-agent roster adds, lineup-history) are present
 * together for one manager — the realistic "well-rounded engaged manager"
 * case — and isolates lineup-history's specific incremental contribution by
 * running the identical scenario with it toggled on vs off.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveManagerIntelligencePayload } from '@/lib/decision-os/dashboard-intelligence'
import * as port from '@/lib/decision-os/behavioral/port'
import type {
  RawWaiverClaimRow,
  RawDraftSessionRow,
  RawDraftPickRow,
  RawRedraftTradeRow,
  RawRedraftRosterPlayerRow,
  RawRedraftRosterMoveRow,
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

const LG = 'league-2i'
const MGR = 'mgr-1'
const OTHER_MGR = 'mgr-2'
const emptyDraftResult = () =>
  Promise.resolve({ session: null as RawDraftSessionRow | null, picks: [] as RawDraftPickRow[] })

const makeWaiverRow = (o: Partial<RawWaiverClaimRow> = {}): RawWaiverClaimRow => ({
  id: 'wc-1',
  leagueId: LG,
  rosterId: 'roster-1',
  userId: MGR,
  addPlayerId: 'player-a',
  dropPlayerId: null,
  faabBid: 10,
  priorityOrder: 1,
  claimType: 'normal',
  status: 'awarded',
  processedAt: new Date('2026-01-10T12:00:00Z'),
  resultMessage: null,
  createdAt: new Date('2026-01-08T12:00:00Z'),
  ...o,
})

const makeRedraftTradeRow = (o: Partial<RawRedraftTradeRow> = {}): RawRedraftTradeRow => ({
  id: 'rt-1',
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
  id: 'rp-1',
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
  id: 'rmh-1',
  leagueId: LG,
  rosterId: 'roster-1',
  seasonId: 'season-1',
  season: 2026,
  week: 5,
  actorUserId: MGR,
  source: 'user',
  createdAt: new Date('2026-01-09T12:00:00Z'),
  ...o,
})

type Scenario = {
  waivers?: RawWaiverClaimRow[]
  redraftTrades?: RawRedraftTradeRow[]
  redraftRosterPlayers?: RawRedraftRosterPlayerRow[]
  redraftRosterMoves?: RawRedraftRosterMoveRow[]
}

function mock(scenario: Scenario) {
  vi.mocked(port.loadWaiverClaimRows).mockResolvedValue(scenario.waivers ?? [])
  vi.mocked(port.loadLeagueTradeRows).mockResolvedValue([])
  vi.mocked(port.loadRosterMoveRows).mockResolvedValue([])
  vi.mocked(port.loadDraftRows).mockImplementation(emptyDraftResult)
  vi.mocked(port.loadRedraftTradeRows).mockResolvedValue(scenario.redraftTrades ?? [])
  vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue(scenario.redraftRosterPlayers ?? [])
  vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue(scenario.redraftRosterMoves ?? [])
}

describe('Phase 2I — combined real-signal readiness', () => {
  afterEach(() => vi.clearAllMocks())

  it('well-rounded engaged manager (trades + waivers + free-agent + lineup-history) — WITHOUT lineup-history (Phase 2F/2G state)', async () => {
    mock({
      waivers: [makeWaiverRow({ id: 'wc-1' }), makeWaiverRow({ id: 'wc-2' }), makeWaiverRow({ id: 'wc-3' })],
      redraftTrades: Array.from({ length: 6 }, (_, i) =>
        makeRedraftTradeRow({ id: `rt-${i}`, createdAt: new Date(`2026-01-0${(i % 9) + 1}T12:00:00Z`) }),
      ),
      redraftRosterPlayers: Array.from({ length: 8 }, (_, i) =>
        makeRedraftRosterPlayerRow({ id: `rp-${i}`, addedAt: new Date(`2026-01-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`) }),
      ),
      redraftRosterMoves: [], // lineup-history absent — this is the Phase 2F/2G baseline
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    // Matches Phase 2F's measured combined-scenario result (confidence/
    // completeness/identity) — this file additionally captures `traits`,
    // which Phase 2F's diagnostic never actually checked. This trade-spike
    // trait was real in Phase 2F too; it just wasn't reported.
    expect(result.managerDna!.primaryIdentity).toBe('committed_grinder')
    expect(result.managerDna!.confidence).toBeCloseTo(0.55, 2)
    expect(result.managerDna!.completeness).toBe(95)
    expect(result.managerDna!.traits).toEqual([
      expect.objectContaining({ trait: 'active_trade_initiator' }),
    ])
  })

  it('IDENTICAL scenario, WITH lineup-history added (Phase 2H/2I state) — real, unexpected finding: identity CHANGES, not just enriches', async () => {
    mock({
      waivers: [makeWaiverRow({ id: 'wc-1' }), makeWaiverRow({ id: 'wc-2' }), makeWaiverRow({ id: 'wc-3' })],
      redraftTrades: Array.from({ length: 6 }, (_, i) =>
        makeRedraftTradeRow({ id: `rt-${i}`, createdAt: new Date(`2026-01-0${(i % 9) + 1}T12:00:00Z`) }),
      ),
      redraftRosterPlayers: Array.from({ length: 8 }, (_, i) =>
        makeRedraftRosterPlayerRow({ id: `rp-${i}`, addedAt: new Date(`2026-01-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`) }),
      ),
      // One lineup-history save per week, weeks 1-6 only.
      redraftRosterMoves: Array.from({ length: 6 }, (_, i) =>
        makeRedraftRosterMoveRow({ id: `rmh-${i}`, week: (i % 6) + 1, createdAt: new Date(2026, 0, i + 1, 12) }),
      ),
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    // IMPORTANT FINDING (docs/DECISION_OS_MANAGER_DNA_PHASE2I_READINESS_AFTER_LINEUP_HISTORY.md):
    // adding lineup-history is NOT purely additive here — it flips the
    // identity from 'committed_grinder' (the pre-Phase-2H read, previous
    // test) to 'set_and_forget'. Why: with only 6 of the ~12.86-week
    // lookback's weeks having any lineup-history event (this feature just
    // shipped; Phase 2G's migration-risk note already flagged that no
    // backfill is possible), Phase 6.1 detects a `conservative_roster_pattern`
    // ("1 streak of consecutive zero-change weeks") for the REMAINING weeks
    // with no history yet — a data-recency artifact, not genuine new
    // evidence of conservative behavior. This is exactly the "ramp-up period"
    // risk Phase 2G predicted, now measured rather than merely anticipated.
    expect(result.managerDna!.primaryIdentity).toBe('set_and_forget')
    expect(result.managerDna!.confidence).toBeCloseTo(0.55, 2)
    expect(result.managerDna!.warnings).toEqual([
      'conflicting_signals: conservative roster pattern alongside trade spike — set_and_forget may understate trade activity',
    ])
  })

  it('the SAME combined manager also showing lineup indecision (3+ saves in one week) now reaches indecisive_tinkerer-relevant signal', async () => {
    mock({
      waivers: [makeWaiverRow({ id: 'wc-1' }), makeWaiverRow({ id: 'wc-2' }), makeWaiverRow({ id: 'wc-3' })],
      redraftTrades: Array.from({ length: 6 }, (_, i) =>
        makeRedraftTradeRow({ id: `rt-${i}`, createdAt: new Date(`2026-01-0${(i % 9) + 1}T12:00:00Z`) }),
      ),
      redraftRosterPlayers: Array.from({ length: 8 }, (_, i) =>
        makeRedraftRosterPlayerRow({ id: `rp-${i}`, addedAt: new Date(`2026-01-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`) }),
      ),
      // 4 saves concentrated in the SAME week — the exact scenario Phase 2H
      // proved triggers repeated_lineup_indecision.
      redraftRosterMoves: Array.from({ length: 4 }, (_, i) => makeRedraftRosterMoveRow({ id: `rmh-${i}`, week: 5, createdAt: new Date(2026, 0, i + 1, 12) })),
    })

    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })

    expect(result.managerDna!.traits).toEqual(
      expect.arrayContaining([expect.objectContaining({ trait: 'lineup_tinkerer' })]),
    )
  })

  it('control: zero activity across all four sources is unchanged and still honest (no fabrication with everything wired)', async () => {
    mock({})
    const result = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })
    expect(result.managerDna!.primaryIdentity).toBe('unknown')
    expect(result.managerDna!.confidence).toBe(0)
  })
})
