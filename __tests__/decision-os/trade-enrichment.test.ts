import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'

import {
  resolveTradeEnrichment,
  type TradeEnrichmentPort,
  type TradeEnrichmentResult,
} from '@/lib/decision-os/trade/enrichmentPort'
import {
  resolveRosterIdentityJoin,
  type ProposalRosterIdentity,
} from '@/lib/decision-os/trade/rosterIdentity'
import { runCanonicalTradeShadowAttempt } from '@/lib/decision-os/trade/canonicalShadow'
import { resolveTradeWorld } from '@/lib/decision-os/trade/tradeWorld'
import { fromAfLeagueTradeItems, resolveCanonicalAssets } from '@/lib/decision-os/world/assets'
import type { PlayerMetadataResult, NormalizedPlayerMetadata } from '@/lib/decision-os/world'
import { registerDecisionTelemetrySink, type DecisionTelemetryEvent } from '@/lib/decision-os/core/telemetry'
import type { CanonicalWorld, TeamFacts, RosterFacts } from '@/lib/decision-os/world/facts'
import type { TradeMovement } from '@/lib/decision-os/trade/canonicalMemo'
import { fakeAssets, fakeSnapshot } from './tradeFakes'

/**
 * Phase E.5 — read-only market-enrichment seam + roster-identity join (ADR-DOS-003).
 *
 * Proves: (1) enrichment source selection, (2) read-only port behavior, (3) enrichment flows into
 * MarketContext, (4) the canonical memo improves when ADP/position exist, (5) missing enrichment degrades
 * honestly, (6) the roster-identity join maps participants where canonical data exists, (7) the validation
 * script skips without a DB, (8) it refuses the production DB, (9) no writes occur, (10) provider names stay
 * in provenance/debug only. Pure + hermetic — every read-only source is injected; no prisma, no IO.
 */

// ── Hermetic Canonical World (roster ids match the redraft fakes rosterA/B) ─────────────────────────
function team(teamId: string, rank: number): TeamFacts {
  return {
    teamId,
    displayName: teamId,
    ownerName: teamId,
    managerUserId: `u_${teamId}`,
    isCommissioner: false,
    isCoCommissioner: false,
    isOrphan: false,
    rank,
    record: { wins: 4, losses: 2, ties: 0 },
    pointsFor: 800,
    pointsAgainst: null,
    pointsAgainstBasis: 'unavailable',
    faab: { budget: 100, used: 0, remaining: 100, remainingDerived: false },
    source: { sourceTeamId: null, sourceManagerId: null },
  }
}

function roster(rosterId: string, teamId: string, playerIds: string[]): RosterFacts {
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

function makeCanonicalWorld(opts: { provider: string | null } = { provider: 'sleeper' }): CanonicalWorld {
  return {
    league: {
      leagueId: 'L1',
      sport: 'NFL',
      season: 2025,
      leagueType: 'redraft',
      isDynasty: false,
      scoringPresetId: 'ppr',
      scoringSettings: null,
      rosterSettings: { rosterSize: null, starterSlots: null, irSlots: null, taxiSlots: null },
      waiverSettings: { type: null, budget: null, minBid: null, hours: null },
      tradeSettings: { reviewHours: 48, deadlineWeek: 12, pickTrading: true },
      currentWeek: 5,
      currentWeekBasis: 'team_performance',
    },
    teams: [team('tA', 2), team('tB', 4)],
    rosters: [roster('rosterA', 'tA', ['pa', 'pX']), roster('rosterB', 'tB', ['pb', 'pY'])],
    provenance: {
      sourceModels: ['League', 'LeagueTeam', 'Roster'],
      provider: opts.provider,
      sourceLeagueId: 'L1',
      assembledAt: '2026-06-29T00:00:00.000Z',
      freshness: { lastSyncedAt: null, isStale: false, staleReason: null },
    },
    completeness: { dataCompleteness: 90, warnings: [], unsupported: [] },
  }
}

function metaResult(positions: Record<string, string>): PlayerMetadataResult {
  const byId = new Map<string, NormalizedPlayerMetadata>()
  for (const [playerId, position] of Object.entries(positions)) {
    byId.set(playerId, {
      playerId,
      name: `Name ${playerId}`,
      position,
      team: 'XX',
      injuryStatus: null,
      byeWeek: null,
      projectedPoints: null,
      projectionConfidence: null,
      source: 'sports_player_cache',
      resolved: true,
    })
  }
  return { byId, complete: true, unresolvedIds: [], warnings: [] }
}

/** Build canonical movements from the redraft fakes (mirrors the shadow's internal staging). */
function movementsFromAssets(provider: string | null = 'sleeper'): TradeMovement[] {
  const assets = fakeAssets()
  const rows = assets.map((a, i) => ({
    id: `mv_${i}`,
    itemType: a.assetType,
    itemReference: a.playerId,
    fromRosterId: a.fromRosterId,
    toRosterId: a.toRosterId,
    faabAmount: a.faabAmount,
    metadata: a.playerName ? { playerName: a.playerName } : {},
  }))
  const inputs = fromAfLeagueTradeItems(rows, provider)
  return resolveCanonicalAssets(inputs).map((asset, i) => ({ asset, fromRosterId: inputs[i].fromRosterId, toRosterId: inputs[i].toRosterId }))
}

const baseAttemptArgs = (over = {}) => ({
  leagueId: 'L1',
  proposerRosterId: 'rosterA',
  receiverRosterId: 'rosterB',
  assets: fakeAssets(),
  referenceSnapshot: fakeSnapshot(),
  proposalId: 'prop-1',
  ...over,
})

const worldDep = (provider: string | null = 'sleeper') => ({ resolveWorld: async () => makeCanonicalWorld({ provider }) })

/** An injected enrichment port that resolves ADP + position for the fake player ids. */
const richPort: TradeEnrichmentPort = {
  loadAdp: async () => [
    { playerId: 'pa', adp: 5, position: 'RB' },
    { playerId: 'pb', adp: 10, position: 'WR' },
  ],
  resolveMetadata: async () => metaResult({ pa: 'RB', pb: 'WR' }),
}

const emptyPort: TradeEnrichmentPort = {
  loadAdp: async () => [],
  resolveMetadata: async () => ({ byId: new Map(), complete: false, unresolvedIds: ['pa', 'pb'], warnings: [] }),
}

afterEach(() => registerDecisionTelemetrySink(null))

// ──────────────────────────────────────────────────────────────────────────
// (1) Enrichment source selection
// ──────────────────────────────────────────────────────────────────────────
describe('E.5 (1) — enrichment source selection', () => {
  it('selects ADP + SportsPlayer sources and reports a combined valuation source', async () => {
    const res = await resolveTradeEnrichment({ sport: 'NFL', playerIds: ['pa', 'pb'] }, richPort)
    expect(res.valuationSource).toBe('adp_data_record+sports_player_cache')
    expect(res.adpResolved).toBe(2)
    expect(res.positionResolved).toBe(2)
    expect(res.enrichment.adpByPlayerId).toEqual({ pa: 5, pb: 10 })
    expect(res.enrichment.positionByPlayerId).toEqual({ pa: 'RB', pb: 'WR' })
  })

  it('the authoritative SportsPlayer position overrides the ADP-record fallback position', async () => {
    const port: TradeEnrichmentPort = {
      loadAdp: async () => [{ playerId: 'pa', adp: 5, position: 'WR' }], // record says WR…
      resolveMetadata: async () => metaResult({ pa: 'RB' }), // …cache (authoritative) says RB
    }
    const res = await resolveTradeEnrichment({ sport: 'NFL', playerIds: ['pa'] }, port)
    expect(res.enrichment.positionByPlayerId).toEqual({ pa: 'RB' })
  })

  it('keeps the freshest ADP row per id (rows arrive createdAt desc → first wins)', async () => {
    const port: TradeEnrichmentPort = {
      loadAdp: async () => [
        { playerId: 'pa', adp: 3, position: 'RB' }, // freshest
        { playerId: 'pa', adp: 99, position: 'RB' }, // stale — ignored
      ],
      resolveMetadata: async () => metaResult({ pa: 'RB' }),
    }
    const res = await resolveTradeEnrichment({ sport: 'NFL', playerIds: ['pa'] }, port)
    expect(res.enrichment.adpByPlayerId).toEqual({ pa: 3 })
  })

  it('ADP-only (no metadata) reports just the ADP source', async () => {
    const port: TradeEnrichmentPort = {
      loadAdp: async () => [{ playerId: 'pa', adp: 5, position: null }],
      resolveMetadata: async () => ({ byId: new Map(), complete: false, unresolvedIds: ['pa'], warnings: [] }),
    }
    const res = await resolveTradeEnrichment({ sport: 'NFL', playerIds: ['pa'] }, port)
    expect(res.valuationSource).toBe('adp_data_record')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// (2) Read-only port behavior
// ──────────────────────────────────────────────────────────────────────────
describe('E.5 (2) — read-only port behavior', () => {
  it('never throws when a source throws — degrades to honest-empty with warnings', async () => {
    const port: TradeEnrichmentPort = {
      loadAdp: async () => {
        throw new Error('db down')
      },
      resolveMetadata: async () => {
        throw new Error('db down')
      },
    }
    const res = await resolveTradeEnrichment({ sport: 'NFL', playerIds: ['pa', 'pb'] }, port)
    expect(res.valuationSource).toBeNull()
    expect(res.adpResolved).toBe(0)
    expect(res.positionResolved).toBe(0)
    expect(res.warnings).toContain('adp_source_unavailable')
    expect(res.warnings).toContain('player_metadata_source_unavailable')
  })

  it('empty player-id list returns an empty result without calling sources', async () => {
    let called = false
    const port: TradeEnrichmentPort = {
      loadAdp: async () => {
        called = true
        return []
      },
      resolveMetadata: async () => {
        called = true
        return { byId: new Map(), complete: false, unresolvedIds: [], warnings: [] }
      },
    }
    const res = await resolveTradeEnrichment({ sport: 'NFL', playerIds: [] }, port)
    expect(called).toBe(false)
    expect(res.valuationSource).toBeNull()
  })

  it('the enrichment port module imports no prisma and performs no writes', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/decision-os/trade/enrichmentPort.ts'), 'utf8')
    // It delegates prisma reads to the loader / world substrate — it never imports the singleton itself.
    expect(/import[^\n]*from\s*['"]@\/lib\/prisma['"]/.test(src)).toBe(false)
    expect(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(src)).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// (3) Enrichment values flow into MarketContext
// ──────────────────────────────────────────────────────────────────────────
describe('E.5 (3) — enrichment flows into MarketContext', () => {
  it('ADP + position land on MarketContext and lift confidence to 100', () => {
    const tradeWorld = resolveTradeWorld({
      world: makeCanonicalWorld(),
      movements: movementsFromAssets(),
      proposerRosterId: 'rosterA',
      receiverRosterId: 'rosterB',
      enrichment: { adpByPlayerId: { pa: 5, pb: 10 }, positionByPlayerId: { pa: 'RB', pb: 'WR' } },
    })
    expect(tradeWorld.marketContext.adpByPlayerId).toEqual({ pa: 5, pb: 10 })
    expect(tradeWorld.marketContext.positionByPlayerId).toEqual({ pa: 'RB', pb: 'WR' })
    expect(tradeWorld.marketContext.confidence).toBe(100)
  })

  it('no enrichment ⇒ honest-empty MarketContext + incomplete-signal uncertainty', () => {
    const tradeWorld = resolveTradeWorld({
      world: makeCanonicalWorld(),
      movements: movementsFromAssets(),
      proposerRosterId: 'rosterA',
      receiverRosterId: 'rosterB',
    })
    expect(tradeWorld.marketContext.adpByPlayerId).toEqual({})
    expect(tradeWorld.marketContext.confidence).toBe(0)
    expect(tradeWorld.uncertainty.some((u) => u.toLowerCase().includes('market signal incomplete'))).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// (4) Canonical memo improves when ADP/position exist
// ──────────────────────────────────────────────────────────────────────────
describe('E.5 (4) — canonical memo improves with enrichment', () => {
  it('side totals lift off the zero floor once ADP is injected', async () => {
    const bare = await runCanonicalTradeShadowAttempt(baseAttemptArgs(), { ...worldDep(), resolveEnrichment: async () => (await resolveTradeEnrichment({ sport: 'NFL', playerIds: ['pa', 'pb'] }, emptyPort)) })
    const rich = await runCanonicalTradeShadowAttempt(baseAttemptArgs(), { ...worldDep(), resolveEnrichment: async () => (await resolveTradeEnrichment({ sport: 'NFL', playerIds: ['pa', 'pb'] }, richPort)) })

    const sum = (sides?: { total: number }[]) => (sides ?? []).reduce((s, x) => s + x.total, 0)
    expect(sum(bare.memo?.snapshot.sides)).toBe(0) // honest floor — no enrichment
    expect(sum(rich.memo?.snapshot.sides)).toBeGreaterThan(0) // ADP lifts it
    expect(rich.telemetry.enrichment_source).toBe('adp_data_record+sports_player_cache')
    expect(rich.telemetry.adp_resolved).toBe(2)
    expect(rich.telemetry.completeness ?? 0).toBeGreaterThanOrEqual(bare.telemetry.completeness ?? 0)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// (5) Missing enrichment degrades honestly
// ──────────────────────────────────────────────────────────────────────────
describe('E.5 (5) — missing enrichment degrades honestly', () => {
  it('the resolver surfaces projection_unavailable + enrichment_incomplete, never fabricates', async () => {
    const res = await resolveTradeEnrichment({ sport: 'NFL', playerIds: ['pa', 'pb'] }, emptyPort)
    expect(res.warnings).toContain('projection_unavailable')
    expect(res.warnings).toContain('enrichment_incomplete')
    expect(res.valuationSource).toBeNull()
    expect(res.enrichment.projectionByPlayerId).toEqual({}) // no canonical projection source — stays empty
  })

  it('the shadow memo still builds and parity is recorded honestly (no enrichment → honest-degraded)', async () => {
    const res = await runCanonicalTradeShadowAttempt(baseAttemptArgs(), { ...worldDep(), resolveEnrichment: async () => (await resolveTradeEnrichment({ sport: 'NFL', playerIds: ['pa', 'pb'] }, emptyPort)) })
    expect(res.ran).toBe(true)
    expect(res.parity?.passed).toBe(false)
    expect(res.telemetry.enrichment_source).toBeNull()
    expect(res.telemetry.adp_resolved).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// (6) Roster identity join succeeds where canonical data exists
// ──────────────────────────────────────────────────────────────────────────
describe('E.5 (6) — roster identity join', () => {
  const world = makeCanonicalWorld()

  it('direct: a proposal id that already names a canonical roster maps with method=direct', () => {
    const join = resolveRosterIdentityJoin(world, { proposerRosterId: 'rosterA', receiverRosterId: 'rosterB' })
    expect(join.resolved).toBe(true)
    expect(join.proposerMethod).toBe('direct')
    expect(join.remap).toEqual({})
  })

  it('team join: a non-direct proposal id maps via teamId to the canonical roster', () => {
    const identities: ProposalRosterIdentity[] = [
      { rosterId: 'rr_A', teamId: 'tA' },
      { rosterId: 'rr_B', teamId: 'tB' },
    ]
    const join = resolveRosterIdentityJoin(world, { proposerRosterId: 'rr_A', receiverRosterId: 'rr_B' }, identities)
    expect(join.resolved).toBe(true)
    expect(join.proposerMethod).toBe('team')
    expect(join.proposerRosterId).toBe('rosterA')
    expect(join.remap).toEqual({ rr_A: 'rosterA', rr_B: 'rosterB' })
  })

  it('manager join: maps via managerUserId → team → roster when teamId is absent', () => {
    const identities: ProposalRosterIdentity[] = [
      { rosterId: 'rr_A', managerUserId: 'u_tA' },
      { rosterId: 'rr_B', managerUserId: 'u_tB' },
    ]
    const join = resolveRosterIdentityJoin(world, { proposerRosterId: 'rr_A', receiverRosterId: 'rr_B' }, identities)
    expect(join.resolved).toBe(true)
    expect(join.proposerMethod).toBe('manager')
    expect(join.proposerRosterId).toBe('rosterA')
  })

  it('unresolved: no direct match and no identity ⇒ resolved=false (honest skip upstream)', () => {
    const join = resolveRosterIdentityJoin(world, { proposerRosterId: 'rr_A', receiverRosterId: 'rosterB' })
    expect(join.resolved).toBe(false)
    expect(join.proposerMethod).toBe('unresolved')
    expect(join.warnings).toContain('proposer_roster_identity_unresolved')
  })

  it('end-to-end: an injected identity resolver lets the shadow run on non-direct proposal ids', async () => {
    const res = await runCanonicalTradeShadowAttempt(
      baseAttemptArgs({
        proposerRosterId: 'rr_A',
        receiverRosterId: 'rr_B',
        assets: [
          { fromRosterId: 'rr_A', toRosterId: 'rr_B', assetType: 'player', playerId: 'pa', playerName: 'A', faabAmount: null },
          { fromRosterId: 'rr_B', toRosterId: 'rr_A', assetType: 'player', playerId: 'pb', playerName: 'B', faabAmount: null },
        ],
      }),
      {
        ...worldDep(),
        resolveEnrichment: async () => resolveTradeEnrichment({ sport: 'NFL', playerIds: ['pa', 'pb'] }, richPort),
        resolveRosterIdentity: {
          resolve: async () => [
            { rosterId: 'rr_A', teamId: 'tA' },
            { rosterId: 'rr_B', teamId: 'tB' },
          ],
        },
      },
    )
    expect(res.ran).toBe(true)
    expect(res.telemetry.identity_method).toEqual({ proposer: 'team', receiver: 'team' })
    expect(res.memo?.snapshot.sides.map((s) => s.rosterId)).toEqual(['rosterA', 'rosterB'])
  })
})

// ──────────────────────────────────────────────────────────────────────────
// (7)+(8) Validation script — skips without DB / refuses production DB
// ──────────────────────────────────────────────────────────────────────────
describe('E.5 (7)+(8) — validation script gating', () => {
  const src = readFileSync(resolve(process.cwd(), 'scripts/decision-os-trade-conformance.ts'), 'utf8')

  it('skips cleanly (exit 0) without DATABASE_URL — gated BEFORE the prisma import', () => {
    expect(src).toMatch(/TRADE_CONFORMANCE SKIPPED \(no DATABASE_URL\)/)
    const gateIdx = src.indexOf('hasDatabaseUrl()')
    const prismaImportIdx = src.indexOf("await import('../lib/prisma')")
    expect(gateIdx).toBeGreaterThan(-1)
    expect(prismaImportIdx).toBeGreaterThan(gateIdx) // prisma is imported only AFTER the gate
  })

  it('refuses the production database before doing any work', () => {
    // Delegated to scripts/db-target-identity.cjs. The host literal this used to assert on
    // ('ep-spring-tooth') is the dev fork, so the old assertion held while the guard was inverted.
    expect(src).toContain('assertNonProductionDbTarget')
    expect(src).not.toContain('ep-spring-tooth')
    const refuseIdx = src.indexOf('assertNonProductionDbTarget')
    const prismaImportIdx = src.indexOf("await import('../lib/prisma')")
    expect(refuseIdx).toBeLessThan(prismaImportIdx) // refusal happens before prisma is pulled
  })
})

// ──────────────────────────────────────────────────────────────────────────
// (9) No writes occur — static guard across the E.5 surface
// ──────────────────────────────────────────────────────────────────────────
describe('E.5 (9) — no writes occur', () => {
  const files = [
    'lib/decision-os/trade/enrichmentPort.ts',
    'lib/decision-os/trade/rosterIdentity.ts',
    'lib/decision-os/trade/canonicalShadow.ts',
    'scripts/decision-os-trade-conformance.ts',
  ]
  it.each(files)('%s performs no prisma writes', (file) => {
    const src = readFileSync(resolve(process.cwd(), file), 'utf8')
    expect(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(src)).toBe(false)
  })

  it('loadAdpRecords reads via findMany only (no write/upsert surface)', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/decision-os/trade/loader.ts'), 'utf8')
    const adpFn = src.slice(src.indexOf('export async function loadAdpRecords'))
    expect(adpFn).toContain('adpDataRecord.findMany')
    expect(/adpDataRecord\.(create|update|upsert|delete)/.test(adpFn)).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// (10) Provider names stay in provenance/debug only
// ──────────────────────────────────────────────────────────────────────────
describe('E.5 (10) — provider non-leak with enrichment wired', () => {
  it('the new enrichment/identity telemetry fields carry no provider name', async () => {
    const events: DecisionTelemetryEvent[] = []
    registerDecisionTelemetrySink((e) => events.push(e))
    const res = await runCanonicalTradeShadowAttempt(baseAttemptArgs(), {
      ...worldDep('sleeper'),
      resolveEnrichment: async () => resolveTradeEnrichment({ sport: 'NFL', playerIds: ['pa', 'pb'] }, richPort),
    })

    expect(res.telemetry.provenance?.provider).toBe('sleeper')
    expect(JSON.stringify(res.telemetry.enrichment_source)).not.toContain('sleeper')
    expect(JSON.stringify(res.telemetry.identity_method)).not.toContain('sleeper')

    const flags = events.find((e) => e.event === 'decision.shadow_parity')!.flags as Record<string, unknown>
    const decisionFacing = JSON.stringify({ ...flags, provenance: undefined })
    expect(decisionFacing.includes('sleeper')).toBe(false)
  })
})
