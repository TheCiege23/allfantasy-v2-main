/**
 * Decision OS — Phase 2G threshold sensitivity analysis
 * (docs/DECISION_OS_MANAGER_DNA_PHASE2G_VOLUME_AND_LINEUP_HISTORY_SCOPE.md).
 *
 * Phase 2F measured that ONE hand-picked activity level (6 trades + 8
 * free-agent adds) crosses Phase 6 DNA's thresholds. This file sweeps a
 * range of volumes to find the exact minimum activity level needed, per
 * signal type, over the default 90-day lookback — real, measured numbers,
 * not estimates. Every value below was captured directly from
 * `resolveManagerIntelligencePayload`'s real output, not hand-derived.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveManagerIntelligencePayload } from '@/lib/decision-os/dashboard-intelligence'
import * as port from '@/lib/decision-os/behavioral/port'
import type { RawRedraftTradeRow, RawRedraftRosterPlayerRow } from '@/lib/decision-os/behavioral/port'

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

const LG = 'lg-sensitivity'
const MGR = 'mgr-1'
const emptyDraft = () => Promise.resolve({ session: null, picks: [] })

function makeTrades(n: number): RawRedraftTradeRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `rt-${i}`,
    leagueId: LG,
    proposerRosterId: 'r1',
    receiverRosterId: 'r2',
    proposerOwnerId: MGR,
    receiverOwnerId: 'mgr-2',
    status: 'pending',
    vetoMode: 'no_veto',
    acceptedAt: null,
    rejectedAt: null,
    expiresAt: null,
    createdAt: new Date(2026, 0, (i % 27) + 1, 12),
    itemCount: 2,
  }))
}

function makeFreeAgents(n: number): RawRedraftRosterPlayerRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `rp-${i}`,
    leagueId: LG,
    rosterId: 'r1',
    ownerUserId: MGR,
    playerId: 'p',
    playerName: 'P',
    acquisitionType: 'free_agent',
    addedAt: new Date(2026, 0, (i % 27) + 1, 12),
    droppedAt: null,
  }))
}

async function runTrades(n: number) {
  vi.mocked(port.loadWaiverClaimRows).mockResolvedValue([])
  vi.mocked(port.loadLeagueTradeRows).mockResolvedValue([])
  vi.mocked(port.loadRosterMoveRows).mockResolvedValue([])
  vi.mocked(port.loadDraftRows).mockImplementation(emptyDraft)
  vi.mocked(port.loadRedraftTradeRows).mockResolvedValue(makeTrades(n))
  vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue([])
  vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue([])
  return resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })
}

async function runFreeAgents(n: number) {
  vi.mocked(port.loadWaiverClaimRows).mockResolvedValue([])
  vi.mocked(port.loadLeagueTradeRows).mockResolvedValue([])
  vi.mocked(port.loadRosterMoveRows).mockResolvedValue([])
  vi.mocked(port.loadDraftRows).mockImplementation(emptyDraft)
  vi.mocked(port.loadRedraftTradeRows).mockResolvedValue([])
  vi.mocked(port.loadRedraftRosterPlayerRows).mockResolvedValue(makeFreeAgents(n))
  vi.mocked(port.loadRedraftRosterMoveRows).mockResolvedValue([])
  return resolveManagerIntelligencePayload({ leagueId: LG, managerId: MGR })
}

describe('trade volume sensitivity (90-day lookback, redraft trades only)', () => {
  it('0 trades: passive, unknown (baseline)', async () => {
    const r = await runTrades(0)
    expect(r.managerDna!.transactionStyle).toBe('passive')
    expect(r.managerDna!.primaryIdentity).toBe('unknown')
  })

  it('2 trades (~0.16/week): transactionStyle already flips to trade_dominant, identity still unknown', async () => {
    const r = await runTrades(2)
    expect(r.managerDna!.transactionStyle).toBe('trade_dominant')
    expect(r.managerDna!.primaryIdentity).toBe('unknown')
  })

  it('15 trades (~1.17/week): still unknown — dimension shift alone is not enough for a real identity', async () => {
    const r = await runTrades(15)
    expect(r.managerDna!.primaryIdentity).toBe('unknown')
  })

  it('20 trades (~1.56/week): crosses into a real, non-unknown identity', async () => {
    const r = await runTrades(20)
    expect(r.managerDna!.primaryIdentity).toBe('serial_trader')
    expect(r.managerDna!.confidence).toBeCloseTo(0.58, 2)
  })
})

describe('free-agent roster volume sensitivity (90-day lookback, free-agent adds only)', () => {
  it('6 free-agent adds (~0.47/week): decisionStyle stays decisive (below the 0.5/week cutoff)', async () => {
    const r = await runFreeAgents(6)
    expect(r.managerDna!.decisionStyle).toBe('decisive')
  })

  it('7 free-agent adds (~0.54/week): decisionStyle flips to methodical', async () => {
    const r = await runFreeAgents(7)
    expect(r.managerDna!.decisionStyle).toBe('methodical')
  })

  it('20 free-agent adds (~1.56/week): STILL unknown identity, confidence 0 — volume alone never crosses a classifier threshold', async () => {
    // This is the key finding of this sensitivity sweep: unlike trades, no
    // amount of free-agent-only volume produces a real identity, because
    // mapRedraftRosterPlayerToLineupSavedEvent honestly sets metadata.week
    // to null (RedraftRosterPlayer has no week/season columns), and
    // lib/decision-os/phase6/patterns/patterns.ts's lineup-based pattern
    // detectors explicitly skip any lineup_saved event with a null week
    // (see e.g. patterns.ts's `if (week === null) continue` guards). These
    // events can still shift Phase 5.2-level activity rates (decisionStyle,
    // above) but can never produce a Phase 6.1 pattern, and therefore can
    // never feed the pattern-gated classifiers (set_and_forget,
    // reactive_manager, indecisive_tinkerer). See the Phase 2G scope
    // document for what closing this gap would require.
    const r = await runFreeAgents(20)
    expect(r.managerDna!.primaryIdentity).toBe('unknown')
    expect(r.managerDna!.confidence).toBe(0)
  })
})
