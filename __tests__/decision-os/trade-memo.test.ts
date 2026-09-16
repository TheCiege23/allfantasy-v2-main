import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

import {
  buildCanonicalTradeMemo,
  buildTradeMemo,
  compareTradeMemos,
  buildCanonicalMemoTelemetry,
  type TradeMovement,
  type CanonicalMemoEnrichment,
  type BuildCanonicalTradeMemoInput,
} from '@/lib/decision-os/trade/canonicalMemo'
import { resolveTradeWorld } from '@/lib/decision-os/trade/tradeWorld'
import {
  resolveCanonicalAssets,
  fromAfLeagueTradeItems,
  type AfLeagueTradeItemRow,
} from '@/lib/decision-os/world/assets'
import type { CanonicalWorld, TeamFacts, RosterFacts } from '@/lib/decision-os/world/facts'
import { buildTradeValueSnapshot, type EnrichedTradeAsset } from '@/lib/trade-value/snapshot'
import { normalizedFaabValue, normalizedPickValue, POSITION_SCARCITY } from '@/lib/trade-value/valueEngine'
import { projectPickSlotDistribution } from '@/lib/trade-intel/pickOutlook'

/**
 * Phase E.2 — Canonical Trade Memo (ADR-DOS-003 §7).
 *
 * Proves the memo REHOSTS the existing deterministic engine onto Canonical World inputs:
 *   • the CanonicalAsset adapts correctly into the engine's `EnrichedTradeAsset` (no new valuation);
 *   • the engine is REUSED (memo values == the pure `normalized*` functions), not duplicated;
 *   • native and imported leagues produce identical memos (origin-blind);
 *   • missing enrichment degrades honestly (null sources, lower completeness, explicit uncertainty);
 *   • PARITY with the existing redraft memo when fed equivalent inputs — and an honest, documented
 *     DIFFERENCE when canonical inputs are genuinely missing (no fake parity);
 *   • telemetry records completeness + uncertainty with the provider only in provenance;
 *   • the module is structurally read-only with no provider-specific branching;
 *   • Trade CONSUMES the asset — direction lives in `TradeMovement`, never on the `CanonicalAsset`.
 *
 * Pure + hermetic: plain fixtures, no prisma, no IO.
 */

// ── Hermetic Canonical World (two teams / two rosters) ─────────────────────
function makeTeam(teamId: string, rank: number, wins: number, losses: number, pf: number): TeamFacts {
  return {
    teamId,
    displayName: teamId,
    ownerName: teamId,
    managerUserId: `u_${teamId}`,
    isCommissioner: false,
    isCoCommissioner: false,
    isOrphan: false,
    rank,
    record: { wins, losses, ties: 0 },
    pointsFor: pf,
    pointsAgainst: null,
    pointsAgainstBasis: 'unavailable',
    faab: { budget: 100, used: null, remaining: null, remainingDerived: false },
    source: { sourceTeamId: null, sourceManagerId: null },
  }
}

function makeRoster(rosterId: string, teamId: string, playerIds: string[]): RosterFacts {
  return {
    rosterId,
    teamId,
    playerIds,
    starterIds: playerIds,
    benchIds: [],
    reserveIds: [],
    taxiIds: [],
    playerCount: playerIds.length,
    waiverPriority: null,
    playerMetadataEnriched: false,
  }
}

function makeWorld(opts: { provider: string | null; assembledAt?: string }): CanonicalWorld {
  return {
    league: {
      leagueId: 'L1',
      sport: 'nfl',
      season: 2025,
      leagueType: 'redraft',
      isDynasty: false,
      scoringPresetId: 'ppr',
      scoringSettings: null,
      rosterSettings: { rosterSize: null, starterSlots: null, irSlots: null, taxiSlots: null },
      waiverSettings: { type: null, budget: null, minBid: null, hours: null },
      tradeSettings: { reviewHours: null, deadlineWeek: null, pickTrading: true },
      currentWeek: 8,
      currentWeekBasis: 'team_performance',
    },
    teams: [makeTeam('tA', 2, 6, 2, 900), makeTeam('tB', 5, 4, 4, 820)],
    rosters: [makeRoster('rA', 'tA', ['p1', 'pX']), makeRoster('rB', 'tB', ['p2', 'pY'])],
    provenance: {
      sourceModels: ['League', 'LeagueTeam', 'Roster'],
      provider: opts.provider,
      sourceLeagueId: 'L1',
      assembledAt: opts.assembledAt ?? '2026-06-29T00:00:00.000Z',
      freshness: { lastSyncedAt: null, isStale: false, staleReason: null },
    },
    completeness: { dataCompleteness: 90, warnings: [], unsupported: [] },
  }
}

// A player + FAAB ⇄ player + pick trade between rA (proposer) and rB (receiver).
const ITEMS: AfLeagueTradeItemRow[] = [
  { id: 'i1', itemType: 'player', itemReference: 'p1', fromRosterId: 'rA', toRosterId: 'rB', faabAmount: null, metadata: { playerName: 'Josh Allen', position: 'QB', team: 'BUF' } },
  { id: 'i2', itemType: 'faab', itemReference: null, fromRosterId: 'rA', toRosterId: 'rB', faabAmount: 20, metadata: {} },
  { id: 'i3', itemType: 'player', itemReference: 'p2', fromRosterId: 'rB', toRosterId: 'rA', faabAmount: null, metadata: { playerName: 'Christian McCaffrey', position: 'RB', team: 'SF' } },
  { id: 'i4', itemType: 'pick', itemReference: '2026 R1', fromRosterId: 'rB', toRosterId: 'rA', faabAmount: null, metadata: { pickSeason: 2026, pickRound: 1 } },
]

function makeMovements(): TradeMovement[] {
  const inputs = fromAfLeagueTradeItems(ITEMS, 'native')
  const assets = resolveCanonicalAssets(inputs)
  return assets.map((asset, i) => ({ asset, fromRosterId: inputs[i].fromRosterId, toRosterId: inputs[i].toRosterId }))
}

const FULL_ENRICHMENT: CanonicalMemoEnrichment = {
  adpByPlayerId: { p1: 30, p2: 5 },
  projectionByPlayerId: { p1: 320, p2: 340 },
  positionByPlayerId: { p1: 'QB', p2: 'RB', pX: 'WR', pY: 'TE' },
}

// The equivalent redraft memo (pure core of the redraft capture path) fed the SAME sources.
function redraftReferenceSnapshot() {
  const pickOutlook = projectPickSlotDistribution({
    season: 2026,
    round: 1,
    currentSeason: 2025,
    senderRank: null,
    teamCount: 2,
  })
  const assets: EnrichedTradeAsset[] = [
    { kind: 'player', fromRosterId: 'rA', toRosterId: 'rB', playerId: 'p1', playerName: 'Josh Allen', position: 'QB', team: 'BUF', pickSeason: null, pickRound: null, pickLabel: null, faabAmount: null, sources: { projectionValue: 320, rankingValue: null, adpValue: 30, fantasyCalcValue: null } },
    { kind: 'faab', fromRosterId: 'rA', toRosterId: 'rB', playerId: null, playerName: null, position: null, team: null, pickSeason: null, pickRound: null, pickLabel: null, faabAmount: 20, sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null } },
    { kind: 'player', fromRosterId: 'rB', toRosterId: 'rA', playerId: 'p2', playerName: 'Christian McCaffrey', position: 'RB', team: 'SF', pickSeason: null, pickRound: null, pickLabel: null, faabAmount: null, sources: { projectionValue: 340, rankingValue: null, adpValue: 5, fantasyCalcValue: null } },
    { kind: 'draft_pick', fromRosterId: 'rB', toRosterId: 'rA', playerId: null, playerName: null, position: null, team: null, pickSeason: 2026, pickRound: 1, pickLabel: '2026 R1', faabAmount: null, pickTeams: 2, pickSlot: pickOutlook.expectedSlot, pickSlotProbability: { early: pickOutlook.early, middle: pickOutlook.middle, late: pickOutlook.late }, sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null } },
  ]
  return buildTradeValueSnapshot({
    proposerRosterId: 'rA',
    receiverRosterId: 'rB',
    assets,
    context: { sport: 'nfl', leagueType: 'redraft', scoring: 'ppr', rosterFormat: 'standard', capturedAt: '2025-09-01T00:00:00Z' },
    currentSeason: 2025,
    profiles: {},
  })
}

describe('Phase E.2 — Canonical Trade Memo: adapter + engine reuse', () => {
  it('does not drop market and IDP enrichment at the TradeWorld boundary', () => {
    const world = makeWorld({ provider: 'sleeper' })
    const movements = makeMovements()
    movements[0]!.asset.metadata.player!.position = 'LB'
    const enrichment: CanonicalMemoEnrichment = {
      positionByPlayerId: { p1: 'LB', p2: 'RB' },
      idpValueByPlayerId: { p1: 3100 },
      marketValueByPlayerId: { p2: 4700 },
    }
    const memo = buildTradeMemo(resolveTradeWorld({
      world, movements, proposerRosterId: 'rA', receiverRosterId: 'rB', enrichment,
    }))
    const byId = new Map(memo.snapshot.sides.flatMap((side) => side.assets).map((asset) => [asset.playerId, asset]))
    expect(byId.get('p1')?.valuationBasis).toBe('idp')
    expect(byId.get('p1')?.internalValue).toBe(3100)
    expect(byId.get('p2')?.valuationBasis).toBe('market')
    expect(byId.get('p2')?.internalValue).toBe(4700)
  })

  it('adapts CanonicalAsset[] into the engine and produces a two-sided snapshot', () => {
    const memo = buildCanonicalTradeMemo({
      world: makeWorld({ provider: 'sleeper' }),
      movements: makeMovements(),
      proposerRosterId: 'rA',
      receiverRosterId: 'rB',
      enrichment: FULL_ENRICHMENT,
      currentSeason: 2025,
    })
    expect(memo.snapshot.sides.map((s) => s.rosterId)).toEqual(['rA', 'rB'])
    expect(memo.snapshot.sides[0].total).toBeGreaterThan(0)
    expect(memo.snapshot.sides[1].total).toBeGreaterThan(0)
    expect(memo.provenance.valuationSource).toBe('deterministic_engine')
    expect(memo.provenance.memoSource).toBe('canonical_world')
  })

  it('REUSES the deterministic engine (values equal the pure normalized* functions, not re-implemented)', () => {
    const memo = buildCanonicalTradeMemo({
      world: makeWorld({ provider: null }),
      movements: makeMovements(),
      proposerRosterId: 'rA',
      receiverRosterId: 'rB',
      enrichment: FULL_ENRICHMENT,
      currentSeason: 2025,
    })
    const all = memo.snapshot.sides.flatMap((s) => s.assets)
    const faab = all.find((a) => a.kind === 'faab')!
    const pick = all.find((a) => a.kind === 'draft_pick')!
    expect(faab.internalValue).toBe(normalizedFaabValue(20))
    expect(pick.internalValue).toBe(normalizedPickValue({
      round: 1,
      pickSeason: 2026,
      currentSeason: 2025,
      teams: 2,
      slot: pick.pickProjectedSlot,
      slotProbability: pick.pickSlotProbability,
    }))
  })

  it('feeds league standings into pick probabilities and remaining budgets into FAAB value', () => {
    const world = makeWorld({ provider: 'sleeper' })
    world.league.waiverSettings.budget = 100
    world.teams[0]!.faab.remaining = 90
    world.teams[1]!.faab.remaining = 15
    const rows = ITEMS.map((item) => item.id === 'i4'
      ? { ...item, metadata: { ...item.metadata, originalRosterId: 'rA' } }
      : item)
    const inputs = fromAfLeagueTradeItems(rows, 'sleeper')
    const assets = resolveCanonicalAssets(inputs)
    const movements = assets.map((asset, index) => ({
      asset,
      fromRosterId: inputs[index]!.fromRosterId,
      toRosterId: inputs[index]!.toRosterId,
    }))
    const memo = buildCanonicalTradeMemo({
      world,
      movements,
      proposerRosterId: 'rA',
      receiverRosterId: 'rB',
      enrichment: FULL_ENRICHMENT,
      currentSeason: 2025,
    })
    const all = memo.snapshot.sides.flatMap((side) => side.assets)
    const pick = all.find((asset) => asset.kind === 'draft_pick')!
    const faab = all.find((asset) => asset.kind === 'faab')!
    expect(pick.pickOriginalRosterId).toBe('rA')
    expect(pick.pickSlotProbability).not.toBeNull()
    expect(faab.faabContext?.receiverRemaining).toBe(15)
    expect(faab.faabContext?.senderRemaining).toBe(90)
    expect(faab.internalValue).not.toBe(normalizedFaabValue(20))
  })
})

describe('Phase E.2 — origin-blindness (native ≡ imported)', () => {
  it('produces identical valuation for native and imported leagues; provider lives only in provenance', () => {
    const args = (world: CanonicalWorld) => ({
      world,
      movements: makeMovements(),
      proposerRosterId: 'rA',
      receiverRosterId: 'rB',
      enrichment: FULL_ENRICHMENT,
      currentSeason: 2025,
    })
    const imported = buildCanonicalTradeMemo(args(makeWorld({ provider: 'sleeper' })))
    const native = buildCanonicalTradeMemo(args(makeWorld({ provider: null })))

    expect(imported.snapshot.sides.map((s) => s.total)).toEqual(native.snapshot.sides.map((s) => s.total))
    expect(imported.snapshot.grade.grade).toBe(native.snapshot.grade.grade)
    expect(imported.snapshot.grade.fairnessScore).toBe(native.snapshot.grade.fairnessScore)
    expect(imported.snapshot.grade.confidenceScore).toBe(native.snapshot.grade.confidenceScore)
    // Origin survives ONLY as provenance.
    expect(imported.provenance.provider).toBe('sleeper')
    expect(native.provenance.provider).toBeNull()
  })
})

describe('Phase E.2 — parity with the existing redraft memo', () => {
  it('matches value totals, grade, fairness, and confidence when fed equivalent inputs', () => {
    const memo = buildCanonicalTradeMemo({
      world: makeWorld({ provider: 'sleeper' }),
      movements: makeMovements(),
      proposerRosterId: 'rA',
      receiverRosterId: 'rB',
      enrichment: FULL_ENRICHMENT,
      currentSeason: 2025,
    })
    const parity = compareTradeMemos(memo.snapshot, redraftReferenceSnapshot())
    expect(parity.passed).toBe(true)
    expect(parity.diffs).toEqual([])
  })

  it('DOCUMENTED intentional difference: missing canonical projection degrades honestly (no fake parity)', () => {
    // No enrichment ⇒ players carry no projection canonically yet (Phase F). The memo must NOT pretend
    // parity — confidence + value differ, and the difference is surfaced as diffs.
    const memo = buildCanonicalTradeMemo({
      world: makeWorld({ provider: 'sleeper' }),
      movements: makeMovements(),
      proposerRosterId: 'rA',
      receiverRosterId: 'rB',
      currentSeason: 2025,
    })
    const parity = compareTradeMemos(memo.snapshot, redraftReferenceSnapshot())
    expect(parity.passed).toBe(false)
    expect(parity.confidenceMatch).toBe(false)
    expect(parity.diffs.length).toBeGreaterThan(0)
  })
})

describe('Phase E.2 — honest degradation', () => {
  it('missing enrichment ⇒ null sources, zeroed player value, lower completeness, explicit uncertainty', () => {
    const memo = buildCanonicalTradeMemo({
      world: makeWorld({ provider: 'sleeper' }),
      movements: makeMovements(),
      proposerRosterId: 'rA',
      receiverRosterId: 'rB',
      currentSeason: 2025,
    })
    const players = memo.snapshot.sides.flatMap((s) => s.assets).filter((a) => a.kind === 'player')
    // No projection/adp ⇒ player value floors to 0 (never fabricated), but pick/FAAB still value.
    expect(players.every((p) => p.internalValue === 0)).toBe(true)
    expect(players.every((p) => p.sources.projectionValue === null && p.sources.adpValue === null)).toBe(true)
    expect(memo.snapshot.grade.confidenceScore).toBe(50)
    expect(memo.snapshot.grade.insufficientData).toBe(true)
    expect(memo.snapshot.coverage?.status).toBe('partial')
    expect(memo.completeness).toBeLessThan(100)
    expect(memo.uncertainty.some((u) => u.toLowerCase().includes('projection not yet sourced'))).toBe(true)
  })

  it('carries the asset-level pick-ownership uncertainty up into the memo (no fabrication)', () => {
    const memo = buildCanonicalTradeMemo({
      world: makeWorld({ provider: 'sleeper' }),
      movements: makeMovements(),
      proposerRosterId: 'rA',
      receiverRosterId: 'rB',
      enrichment: FULL_ENRICHMENT,
      currentSeason: 2025,
    })
    expect(memo.uncertainty.some((u) => u.toLowerCase().includes('pick ownership'))).toBe(true)
  })

  it('never throws when a roster has no matching team (profile degrades, value still computes)', () => {
    const world = makeWorld({ provider: null })
    world.rosters = [makeRoster('rA', 'tA', ['p1']), makeRoster('rB', null as unknown as string, ['p2'])]
    world.rosters[1].teamId = null
    const memo = buildCanonicalTradeMemo({
      world,
      movements: makeMovements(),
      proposerRosterId: 'rA',
      receiverRosterId: 'rB',
      enrichment: FULL_ENRICHMENT,
      currentSeason: 2025,
    })
    expect(memo.snapshot.sides).toHaveLength(2)
    expect(memo.uncertainty.some((u) => u.includes('Team profile unavailable'))).toBe(true)
  })
})

describe('Phase E.2 — telemetry', () => {
  it('records completeness + uncertainty + parity, with provider only in provenance', () => {
    const memo = buildCanonicalTradeMemo({
      world: makeWorld({ provider: 'sleeper' }),
      movements: makeMovements(),
      proposerRosterId: 'rA',
      receiverRosterId: 'rB',
      enrichment: FULL_ENRICHMENT,
      currentSeason: 2025,
    })
    const parity = compareTradeMemos(memo.snapshot, redraftReferenceSnapshot())
    const tel = buildCanonicalMemoTelemetry(memo, parity)

    expect(tel.completeness).toBe(memo.completeness)
    expect(tel.uncertainty_count).toBe(memo.uncertainty.length)
    expect(tel.memo_source).toBe('canonical_world')
    expect(tel.valuation_source).toBe('deterministic_engine')
    expect(tel.parity?.passed).toBe(true)
    // Provider must NOT leak into the top-level decision-facing fields — only provenance.
    expect(tel.provenance.provider).toBe('sleeper')
    const topLevel = JSON.stringify({ ...tel, provenance: undefined })
    expect(topLevel.includes('sleeper')).toBe(false)
  })
})

describe('Phase E.2 — architecture: pure, read-only, origin-blind, trade-consumes-asset', () => {
  const src = readFileSync(resolve(process.cwd(), 'lib/decision-os/trade/canonicalMemo.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('imports no prisma and performs no writes (read-only, on-demand, no persistence)', () => {
    expect(code.includes('@/lib/prisma')).toBe(false)
    expect(/prisma\./.test(code)).toBe(false)
    expect(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(code)).toBe(false)
  })

  it('does not branch business logic on provider names (origin-blind)', () => {
    expect(code).not.toMatch(/===\s*['"]sleeper['"]/)
    expect(code).not.toMatch(/===\s*['"]espn['"]/)
    expect(code).not.toMatch(/===\s*['"]yahoo['"]/)
  })

  it('the CanonicalAsset carries no trade direction — only TradeMovement does', () => {
    const movements = makeMovements()
    for (const m of movements) {
      expect(m.asset.owner).toBeDefined()
      expect('toRosterId' in m.asset).toBe(false)
      expect('fromRosterId' in m.asset).toBe(false)
      // Direction is supplied by the consumer via the movement wrapper.
      expect(typeof m.fromRosterId).toBe('string')
      expect(typeof m.toRosterId).toBe('string')
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Phase E.3 — TradeWorldResolver: the decision-specific TradeWorld + wrapper memo
// ──────────────────────────────────────────────────────────────────────────

/**
 * Phase E.3 (ADR-DOS-003 §3.1, §7). Trade now follows the same pipeline as every other decision:
 *   CanonicalWorld → TradeWorldResolver → CanonicalTradeMemo → manager.trade.evaluate.
 * The memo consumes a decision-specific `TradeWorld` (trade direction + MARKET interpretation), never a
 * raw `CanonicalWorld`. These tests prove the new contract is an architectural WRAPPER, not a behavior
 * change — `buildTradeMemo(resolveTradeWorld(x))` is BYTE-IDENTICAL to `buildCanonicalTradeMemo(x)`.
 */
function memoInput(world: CanonicalWorld, enrichment?: CanonicalMemoEnrichment): BuildCanonicalTradeMemoInput {
  return { world, movements: makeMovements(), proposerRosterId: 'rA', receiverRosterId: 'rB', enrichment, currentSeason: 2025 }
}

function worldMissingReceiverTeam(): CanonicalWorld {
  const world = makeWorld({ provider: null })
  world.rosters = [makeRoster('rA', 'tA', ['p1', 'pX']), makeRoster('rB', 'tB', ['p2', 'pY'])]
  world.rosters[1].teamId = null
  return world
}

describe('Phase E.3 — byte-identity: memo from TradeWorld ≡ memo from CanonicalWorld', () => {
  it('FULL enrichment: buildTradeMemo(resolveTradeWorld(x)) deep-equals buildCanonicalTradeMemo(x)', () => {
    const input = memoInput(makeWorld({ provider: 'sleeper' }), FULL_ENRICHMENT)
    const reference = buildCanonicalTradeMemo(input)
    const viaWorld = buildTradeMemo(resolveTradeWorld(input))
    // The whole memo envelope — snapshot, completeness, uncertainty (order included), provenance.
    expect(viaWorld).toEqual(reference)
  })

  it('NO enrichment (honest degrade): the two paths stay byte-identical', () => {
    const input = memoInput(makeWorld({ provider: 'sleeper' }))
    expect(buildTradeMemo(resolveTradeWorld(input))).toEqual(buildCanonicalTradeMemo(input))
  })

  it('MISSING team profile: the two paths stay byte-identical (degradation reproduced, not re-derived)', () => {
    const input = memoInput(worldMissingReceiverTeam(), FULL_ENRICHMENT)
    const reference = buildCanonicalTradeMemo(input)
    const viaWorld = buildTradeMemo(resolveTradeWorld(input))
    expect(viaWorld).toEqual(reference)
    // And the honest "profile unavailable" note survives the wrapper.
    expect(viaWorld.uncertainty.some((u) => u.includes('Team profile unavailable for receiver roster rB'))).toBe(true)
  })

  it('NATIVE league: byte-identity holds regardless of origin', () => {
    const input = memoInput(makeWorld({ provider: null }), FULL_ENRICHMENT)
    expect(buildTradeMemo(resolveTradeWorld(input))).toEqual(buildCanonicalTradeMemo(input))
  })
})

describe('Phase E.3 — TradeWorld contract shape', () => {
  it('carries participants with direction roles, resolved team profiles, and the assets verbatim', () => {
    const input = memoInput(makeWorld({ provider: 'sleeper' }), FULL_ENRICHMENT)
    const world = resolveTradeWorld(input)

    expect(world.participants.map((p) => p.role)).toEqual(['proposer', 'receiver'])
    expect(world.participants.map((p) => p.rosterId)).toEqual(['rA', 'rB'])
    expect(world.participants.every((p) => p.profileResolved)).toBe(true)
    // Direction lives on the movements the world carries — not re-encoded on the world.
    expect(world.assets).toBe(input.movements)
    expect(Object.keys(world.teamProfiles).sort()).toEqual(['rA', 'rB'])
    // Origin survives ONLY in provenance.
    expect(world.provenance.provider).toBe('sleeper')
    expect(JSON.stringify({ participants: world.participants, leagueContext: world.leagueContext, constraints: world.constraints }).includes('sleeper')).toBe(false)
  })

  it('league + constraint context is resolved from facts (not invented)', () => {
    const input = memoInput(makeWorld({ provider: 'sleeper' }), FULL_ENRICHMENT)
    const world = resolveTradeWorld(input)
    expect(world.leagueContext.sport).toBe('nfl')
    expect(world.leagueContext.season).toBe(2025)
    expect(world.leagueContext.currentSeason).toBe(2025)
    expect(world.leagueContext.isDynasty).toBe(false)
    expect(world.leagueContext.capturedAt).toBe('2026-06-29T00:00:00.000Z')
    expect(world.constraints.pickTradingAllowed).toBe(true)
    expect(world.constraints.deadlineWeek).toBeNull()
  })
})

describe('Phase E.3 — MarketContext: owned by TradeWorld, honest, never fabricated', () => {
  it('surfaces the engine scarcity table and the injected market maps; Phase-F fields stay honest-empty', () => {
    const input = memoInput(makeWorld({ provider: 'sleeper' }), FULL_ENRICHMENT)
    const { marketContext } = resolveTradeWorld(input)

    // The deterministic scarcity table is surfaced for audit — not re-invented here.
    expect(marketContext.positionalScarcity).toBe(POSITION_SCARCITY)
    // Injected (read-only port) market signals are carried through.
    expect(marketContext.adpByPlayerId).toEqual(FULL_ENRICHMENT.adpByPlayerId)
    expect(marketContext.projectionByPlayerId).toEqual(FULL_ENRICHMENT.projectionByPlayerId)
    // Phase-F market interpretation not sourced yet ⇒ honest-empty, never faked.
    expect(marketContext.marketValueByPlayerId).toEqual({})
    expect(marketContext.leagueScarcity).toEqual({})
    expect(marketContext.injuryMarketImpactByPlayerId).toEqual({})
    expect(marketContext.newsImpactByPlayerId).toEqual({})
    expect(marketContext.projectionSource).toBeNull()
    // Full coverage ⇒ confidence 100.
    expect(marketContext.confidence).toBe(100)
  })

  it('confidence reflects coverage and raises uncertainty when market signal is missing', () => {
    const world = resolveTradeWorld(memoInput(makeWorld({ provider: 'sleeper' })))
    expect(world.marketContext.confidence).toBe(0)
    expect(world.uncertainty.some((u) => u.toLowerCase().includes('market signal incomplete'))).toBe(true)
  })
})

describe('Phase E.3 — buildTradeMemo consumes TradeWorld (engine reused, not re-implemented)', () => {
  it('values via the world path equal the pure normalized* functions', () => {
    const memo = buildTradeMemo(resolveTradeWorld(memoInput(makeWorld({ provider: null }), FULL_ENRICHMENT)))
    const all = memo.snapshot.sides.flatMap((s) => s.assets)
    const faab = all.find((a) => a.kind === 'faab')!
    const pick = all.find((a) => a.kind === 'draft_pick')!
    expect(faab.internalValue).toBe(normalizedFaabValue(20))
    expect(pick.internalValue).toBe(normalizedPickValue({
      round: 1,
      pickSeason: 2026,
      currentSeason: 2025,
      teams: 2,
      slot: pick.pickProjectedSlot,
      slotProbability: pick.pickSlotProbability,
    }))
  })

  it('origin-blind through the world: native ≡ imported (provider only in provenance)', () => {
    const imported = buildTradeMemo(resolveTradeWorld(memoInput(makeWorld({ provider: 'sleeper' }), FULL_ENRICHMENT)))
    const native = buildTradeMemo(resolveTradeWorld(memoInput(makeWorld({ provider: null }), FULL_ENRICHMENT)))
    expect(imported.snapshot.sides.map((s) => s.total)).toEqual(native.snapshot.sides.map((s) => s.total))
    expect(imported.snapshot.grade.grade).toBe(native.snapshot.grade.grade)
    expect(imported.provenance.provider).toBe('sleeper')
    expect(native.provenance.provider).toBeNull()
  })
})

describe('Phase E.3 — architecture: resolver is pure, read-only, origin-blind, reuses the shared leaves', () => {
  const src = readFileSync(resolve(process.cwd(), 'lib/decision-os/trade/tradeWorld.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('imports no prisma and performs no writes', () => {
    expect(code.includes('@/lib/prisma')).toBe(false)
    expect(/prisma\./.test(code)).toBe(false)
    expect(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(code)).toBe(false)
  })

  it('does not branch business logic on provider names (origin-blind)', () => {
    expect(code).not.toMatch(/===\s*['"]sleeper['"]/)
    expect(code).not.toMatch(/===\s*['"]espn['"]/)
    expect(code).not.toMatch(/===\s*['"]yahoo['"]/)
  })

  it('reuses the E.2 shared leaf (profileForRoster) — the mechanism that guarantees byte-identity', () => {
    expect(code.includes('profileForRoster')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// League reception scoring, end to end
// ──────────────────────────────────────────────────────────────────────────

/**
 * 🛑 THE WORLD CARRIES `{ scoring_settings: { rec, … } }`, NOT `{ rec }`. Until 2026-09-16 the
 * memo read `rec` off the top of that blob, so every league — full, half or no PPR, TE premium or
 * not — was graded identically. These drive the real wrapper through both memo paths.
 */
describe('league reception scoring reaches the grade', () => {
  const RECEIVER_ITEMS: AfLeagueTradeItemRow[] = [
    { id: 'w1', itemType: 'player', itemReference: 'pW', fromRosterId: 'rA', toRosterId: 'rB', faabAmount: null, metadata: { playerName: 'Some Receiver', position: 'WR', team: 'MIA' } },
    { id: 't1', itemType: 'player', itemReference: 'pT', fromRosterId: 'rB', toRosterId: 'rA', faabAmount: null, metadata: { playerName: 'Some Tight End', position: 'TE', team: 'LV' } },
  ]
  const receiverMovements = (): TradeMovement[] => {
    const inputs = fromAfLeagueTradeItems(RECEIVER_ITEMS, 'native')
    return resolveCanonicalAssets(inputs).map((asset, i) => ({
      asset, fromRosterId: inputs[i].fromRosterId, toRosterId: inputs[i].toRosterId,
    }))
  }
  const ENRICH: CanonicalMemoEnrichment = {
    projectionByPlayerId: { pW: 200, pT: 150 },
    projectionScoringFormatByPlayerId: { pW: 'ppr', pT: 'ppr' },
    positionByPlayerId: { pW: 'WR', pT: 'TE' },
  }
  const worldWith = (rules: Record<string, number> | null): CanonicalWorld => {
    const w = makeWorld({ provider: 'sleeper' })
    // Exactly what `narrowScoringSettings` produces from a Sleeper `League.settings`.
    w.league.scoringSettings = rules ? { scoring_settings: rules } : null
    return w
  }
  const valuesFor = (world: CanonicalWorld, enrichment: CanonicalMemoEnrichment = ENRICH) => {
    const input: BuildCanonicalTradeMemoInput = {
      world, movements: receiverMovements(), proposerRosterId: 'rA', receiverRosterId: 'rB', enrichment, currentSeason: 2025,
    }
    const memo = buildCanonicalTradeMemo(input)
    const byId = new Map(memo.snapshot.sides.flatMap((s) => s.assets).map((a) => [a.playerId, a.internalValue]))
    return { memo, input, wr: byId.get('pW')!, te: byId.get('pT')! }
  }

  it('a full-PPR league prices a full-PPR projection exactly as a league with no rulebook — no double count', () => {
    const ppr = valuesFor(worldWith({ rec: 1 }))
    const none = valuesFor(worldWith(null))
    expect(ppr.wr).toBe(none.wr)
    expect(ppr.te).toBe(none.te)
  })

  it('a half-PPR league prices the receiver and the tight end BELOW a full-PPR league', () => {
    const ppr = valuesFor(worldWith({ rec: 1 }))
    const half = valuesFor(worldWith({ rec: 0.5 }))
    expect(half.wr).toBeLessThan(ppr.wr)
    expect(half.te).toBeLessThan(ppr.te)
  })

  it('a TE-premium league prices the tight end above the same league without one, and leaves the WR alone', () => {
    const plain = valuesFor(worldWith({ rec: 1 }))
    const tep = valuesFor(worldWith({ rec: 1, bonus_rec_te: 1 }))
    expect(tep.te).toBeGreaterThan(plain.te)
    expect(tep.wr).toBe(plain.wr)
  })

  it('a projection with no stated format gets no reception conversion', () => {
    const noFormat = { ...ENRICH, projectionScoringFormatByPlayerId: undefined }
    expect(valuesFor(worldWith({ rec: 0.5 }), noFormat).wr).toBe(valuesFor(worldWith({ rec: 1 }), noFormat).wr)
  })

  it('both memo paths stay byte-identical with the format carried through TradeWorld', () => {
    const { input, memo } = valuesFor(worldWith({ rec: 0.5, bonus_rec_te: 0.5 }))
    expect(buildTradeMemo(resolveTradeWorld(input))).toEqual(memo)
  })
})
