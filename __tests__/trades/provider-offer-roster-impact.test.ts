/**
 * Item #6, rendered: the provider-offer wrapper asks for the lineup effect only when told to,
 * returns it summarised, and keeps it OUT of the once-per-offer TRADE_PROPOSED record.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const evaluateCanonicalTrade = vi.fn()
const resolveCanonicalWorld = vi.fn()
const emit = vi.fn()
const findUniqueDomainEvent = vi.fn()

vi.mock('@/lib/decision-os/trade/canonicalEvaluator', () => ({
  evaluateCanonicalTrade: (...args: unknown[]) => evaluateCanonicalTrade(...args),
}))
vi.mock('@/lib/decision-os/world', () => ({
  resolveCanonicalWorld: (...args: unknown[]) => resolveCanonicalWorld(...args),
}))
vi.mock('@/lib/events/producers', () => ({ getPlatformEvents: () => ({ emit }) }))
vi.mock('@/lib/prisma', () => ({
  prisma: { domainEvent: { findUnique: (...args: unknown[]) => findUniqueDomainEvent(...args) } },
}))

import { evaluatePendingProviderTrades } from '@/lib/provider-trades/evaluatePendingProviderTrades'
import type { PendingProviderTrade } from '@/lib/provider-trades/scanPendingSleeperTrades'

const WORLD = {
  league: { season: 2026, sport: 'NFL', leagueType: 'redraft' },
  teams: [
    { teamId: 'team-me', source: { sourceTeamId: '1' } },
    { teamId: 'team-them', source: { sourceTeamId: '2' } },
  ],
  rosters: [
    { rosterId: 'roster-me', teamId: 'team-me' },
    { rosterId: 'roster-them', teamId: 'team-them' },
  ],
}

const TRADE = {
  provider: 'sleeper',
  transactionId: 'tx-1',
  proposedByViewer: false,
  proposedBy: 'Them FC',
  proposedAt: '2026-09-15T12:00:00.000Z',
  assetsGiven: [{ playerId: 'p-out', playerName: 'Out Guy', position: 'RB', team: 'KC' }],
  assetsReceived: [{ playerId: 'p-in', playerName: 'In Guy', position: 'WR', team: 'BUF' }],
  viewerRosterExternalId: '1',
  counterpartyRosterExternalId: '2',
  lifecycleStatus: 'pending',
} as unknown as PendingProviderTrade

function evaluation(rosterImpact: unknown) {
  return {
    action: 'accept',
    recommendation: 'Accept',
    valueGiven: 100,
    valueReceived: 120,
    valueDelta: 20,
    grade: 'A',
    fairnessScore: 80,
    confidenceScore: 70,
    coverageStatus: 'complete',
    coveragePct: 100,
    evaluatedAt: '2026-09-16T00:00:00.000Z',
    memo: { snapshot: {}, uncertainty: {} },
    ...(rosterImpact === undefined ? {} : { rosterImpact }),
  }
}

const IMPACT = {
  unit: 'projected_points_per_game',
  startingPointsBefore: 80,
  startingPointsAfter: 83,
  startingPointsDelta: 3,
  blockedReason: null,
  unpricedExcluded: 0,
  depth: [
    { position: 'QB', rosteredBefore: 2, rosteredAfter: 2, rosteredDelta: 0, benchBefore: 1, benchAfter: 1, delta: 0 },
    { position: 'RB', rosteredBefore: 4, rosteredAfter: 3, rosteredDelta: -1, benchBefore: 2, benchAfter: 1, delta: -1 },
  ],
  replacement: [],
}

describe('evaluatePendingProviderTrades — lineup effect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveCanonicalWorld.mockResolvedValue(WORLD)
    findUniqueDomainEvent.mockResolvedValue(null)
    emit.mockResolvedValue(undefined)
  })

  it('does not ask for it by default, and the row carries no rosterImpact key', async () => {
    evaluateCanonicalTrade.mockResolvedValue(evaluation(undefined))
    const out = await evaluatePendingProviderTrades({ leagueId: 'L', trades: [TRADE] })

    expect(evaluateCanonicalTrade).toHaveBeenCalledTimes(1)
    expect(evaluateCanonicalTrade.mock.calls[0]![0]).toMatchObject({ includeRosterImpact: false })
    expect(out.get('tx-1')).toBeDefined()
    expect('rosterImpact' in out.get('tx-1')!).toBe(false)
  })

  it('asks for it when told to, for the VIEWER roster, and returns it summarised', async () => {
    evaluateCanonicalTrade.mockResolvedValue(evaluation(IMPACT))
    const out = await evaluatePendingProviderTrades({ leagueId: 'L', trades: [TRADE], includeRosterImpact: true })

    expect(evaluateCanonicalTrade.mock.calls[0]![0]).toMatchObject({
      includeRosterImpact: true,
      viewerRosterId: 'roster-me',
    })
    expect(out.get('tx-1')!.rosterImpact).toEqual({
      unit: 'projected_points_per_game',
      startingPointsBefore: 80,
      startingPointsAfter: 83,
      startingPointsDelta: 3,
      blockedReason: null,
      unpricedExcluded: 0,
      // Only the position that moved — QB's unchanged row is dropped.
      depthChanges: [{ position: 'RB', rosteredBefore: 4, rosteredAfter: 3 }],
    })
  })

  it('keeps "asked for, could not be produced" as null rather than dropping the key', async () => {
    evaluateCanonicalTrade.mockResolvedValue(evaluation(null))
    const out = await evaluatePendingProviderTrades({ leagueId: 'L', trades: [TRADE], includeRosterImpact: true })
    expect(out.get('tx-1')!.rosterImpact).toBeNull()
  })

  it('🛑 keeps the lineup effect OUT of the once-per-offer TRADE_PROPOSED record', async () => {
    /*
     * That event is written the first time ANY surface evaluates the offer. If the returned row and
     * the recorded `decision` were one object, whether the proposal-time record carries a lineup
     * number would depend on which caller got there first.
     */
    evaluateCanonicalTrade.mockResolvedValue(evaluation(IMPACT))
    await evaluatePendingProviderTrades({ leagueId: 'L', trades: [TRADE], includeRosterImpact: true })

    expect(emit).toHaveBeenCalledTimes(1)
    const payload = emit.mock.calls[0]![1] as { metadata: { decision: Record<string, unknown> } }
    expect(payload.metadata.decision).toMatchObject({ grade: 'A', valueDelta: 20 })
    expect('rosterImpact' in payload.metadata.decision).toBe(false)
  })
})

describe('trades-panel route — who gets a lineup effect', () => {
  const src = readFileSync(resolve(process.cwd(), 'app/api/league/trades-panel/route.ts'), 'utf8')

  it('requests it on PENDING provider offers and never on completed ones', () => {
    const pending = src.match(/evaluatePendingProviderTrades\(\{[^}]*trades: providerPending[^}]*\}/)?.[0]
    const completed = src.match(/evaluatePendingProviderTrades\(\{[^}]*trades: providerCompleted[^}]*\}/)?.[0]
    const yahoo = src.match(/evaluatePendingProviderTrades\(\{[^}]*trades: scan\.trades[^}]*\}/)?.[0]
    // [control] each call site was actually found — a missed match would make the next lines vacuous.
    expect(pending).toBeTruthy()
    expect(completed).toBeTruthy()
    expect(yahoo).toBeTruthy()

    expect(pending).toContain('includeRosterImpact: true')
    expect(yahoo).toContain('includeRosterImpact: true')
    expect(completed).not.toContain('includeRosterImpact')
  })

  it('gates native offers on the viewer being a PARTY, not merely able to see the offer', () => {
    expect(src).toContain('const wantImpact = viewerIsProposer || viewerIsReceiver')
    expect(src).toContain('includeRosterImpact: wantImpact,')
  })
})
