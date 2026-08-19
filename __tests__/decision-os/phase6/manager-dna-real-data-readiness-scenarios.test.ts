/**
 * Decision OS — Phase 2F real-data readiness measurement
 * (docs/DECISION_OS_MANAGER_DNA_PHASE2F_READINESS_AFTER_REDRAFT_PORT.md).
 *
 * Unlike the Phase 2E regression/contribution tests in
 * dashboard-intelligence-pipeline.test.ts (which prove the new redraft
 * loaders work and don't double-count), this file exists to MEASURE the
 * before/after delta the Phase 2E port extension actually produces for
 * realistic "real redraft league, zero legacy Af-table data" scenarios — the
 * exact situation docs/DECISION_OS_MANAGER_DNA_PHASE2D_REAL_DATA_READINESS.md
 * found on staging (0 af_league_trades rows).
 *
 * "BEFORE" is simulated by calling the real, unmodified
 * `resolveManagerIntelligencePayload` with the two new redraft loaders
 * mocked to return empty (i.e., the exact pre-Phase-2E composition) against
 * the SAME underlying scenario data. "AFTER" calls it with the real redraft
 * fixture data active. Both paths run through identical, real Phase
 * 5.1/5.2/6.1/6.2 code — nothing here is mocked at the classifier level.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveManagerIntelligencePayload } from '@/lib/decision-os/dashboard-intelligence'
import * as port from '@/lib/decision-os/behavioral/port'
import type {
  RawWaiverClaimRow,
  RawLeagueTradeRow,
  RawRosterMoveRow,
  RawDraftSessionRow,
  RawDraftPickRow,
  RawRedraftTradeRow,
  RawRedraftRosterPlayerRow,
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

const LG = 'league-real-redraft'
const MGR = 'user-mgr-1'
const OTHER_MGR = 'user-mgr-2'

const emptyDraftResult = () =>
  Promise.resolve({ session: null as RawDraftSessionRow | null, picks: [] as RawDraftPickRow[] })

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

type Scenario = {
  redraftTrades?: RawRedraftTradeRow[]
  redraftRosterPlayers?: RawRedraftRosterPlayerRow[]
  waivers?: RawWaiverClaimRow[]
}

function mockScenario(before: boolean, scenario: Scenario) {
  vi.mocked(port.loadWaiverClaimRows).mockResolvedValue(scenario.waivers ?? [])
  vi.mocked(port.loadLeagueTradeRows).mockResolvedValue([]) // no Af* data — matches ADR_F5_10's 0-row staging finding
  vi.mocked(port.loadRosterMoveRows).mockResolvedValue([]) // no Af* data
  vi.mocked(port.loadDraftRows).mockImplementation(emptyDraftResult)
  // "before" = simulate pre-Phase-2E composition: new loaders always empty,
  // regardless of what real redraft data exists for this league.
  vi.mocked(port.loadRedraftTradeRows).mockResolvedValue(before ? [] : (scenario.redraftTrades ?? []))
  vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue(
    before ? [] : (scenario.redraftRosterPlayers ?? []),
  )
  // Phase 2H source — no lineup-history scenario data exercised in this
  // Phase 2F harness; keep it empty so results are unaffected here.
  vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue([])
}

async function runBeforeAndAfter(scenario: Scenario) {
  mockScenario(true, scenario)
  const before = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })
  mockScenario(false, scenario)
  const after = await resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })
  return { before, after }
}

describe('Phase 2F readiness measurement — real redraft league scenarios', () => {
  afterEach(() => vi.clearAllMocks())

  it('scenario: active redraft trader, zero Af*/WaiverClaim data — trade signal now reaches the profile', async () => {
    const { before, after } = await runBeforeAndAfter({
      redraftTrades: Array.from({ length: 8 }, (_, i) =>
        makeRedraftTradeRow({ id: `rt-${i}`, createdAt: new Date(`2026-01-${String(i + 1).padStart(2, '0')}T12:00:00Z`) }),
      ),
    })

    // BEFORE (pre-Phase-2E composition): this manager's real trade activity
    // was invisible — the profile looks identical to a manager who never trades.
    expect(before.managerDna!.transactionStyle).toBe('passive')
    expect(before.managerDna!.primaryIdentity).toBe('unknown')

    // AFTER: the same real activity is now visible.
    expect(after.managerDna!.transactionStyle).toBe('trade_dominant')
  })

  it('scenario: free-agent roster tinkerer, zero Af*/WaiverClaim data — roster signal now reaches the profile', async () => {
    const { before, after } = await runBeforeAndAfter({
      redraftRosterPlayers: Array.from({ length: 10 }, (_, i) =>
        makeRedraftRosterPlayerRow({ id: `rp-${i}`, addedAt: new Date(`2026-01-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`) }),
      ),
    })

    expect(before.managerDna!.decisionStyle).toBe('decisive') // low lineupEditsPerWeek default
    expect(after.managerDna!.decisionStyle).toBe('methodical')
  })

  it('scenario: combined redraft trades + free-agent adds + real waiver activity (a realistic engaged manager)', async () => {
    const { before, after } = await runBeforeAndAfter({
      redraftTrades: Array.from({ length: 6 }, (_, i) => makeRedraftTradeRow({ id: `rt-${i}` })),
      redraftRosterPlayers: Array.from({ length: 8 }, (_, i) =>
        makeRedraftRosterPlayerRow({ id: `rp-${i}`, addedAt: new Date(`2026-01-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`) }),
      ),
      waivers: [makeWaiverRow({ id: 'wc-1' }), makeWaiverRow({ id: 'wc-2' })],
    })

    // BEFORE: only the 2 real waiver claims are visible (Af*/redraft both empty) —
    // trade and roster signal are entirely absent.
    expect(before.managerDna!.transactionStyle).not.toBe('trade_dominant')

    // AFTER: richer real signal changes both dimensions.
    expect(after.managerDna!.transactionStyle).toBe('trade_dominant')
    expect(after.managerDna!.decisionStyle).toBe('methodical')
    // Completeness/confidence never regress when more real signal is added.
    expect(after.managerDna!.completeness).toBeGreaterThanOrEqual(before.managerDna!.completeness)
  })

  it('control: true zero activity across every source — before and after are identical (no fabrication)', async () => {
    const { before, after } = await runBeforeAndAfter({})

    expect(after.managerDna).toEqual(before.managerDna)
    expect(after.managerDna!.primaryIdentity).toBe('unknown')
    expect(after.managerDna!.confidence).toBe(0)
  })

  it('control: a league with real Af*-sourced waiver activity only (pre-Phase-2E data) is unaffected by the port extension', async () => {
    const { before, after } = await runBeforeAndAfter({
      waivers: [
        makeWaiverRow({ id: 'wc-1' }),
        makeWaiverRow({ id: 'wc-2', createdAt: new Date('2026-01-11T12:00:00Z') }),
        makeWaiverRow({ id: 'wc-3', createdAt: new Date('2026-01-12T12:00:00Z') }),
      ],
    })

    // No redraft data in this scenario at all — before/after must be identical,
    // proving the extension is additive and never changes existing behavior
    // when there's nothing new to see.
    expect(after.managerDna).toEqual(before.managerDna)
  })
})
