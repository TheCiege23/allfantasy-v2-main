import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'

import { runCanonicalTradeShadowAttempt } from '@/lib/decision-os/trade/canonicalShadow'
import { runTradeShadowForProposal } from '@/lib/decision-os/trade/shadow'
import { registerDecisionTelemetrySink, type DecisionTelemetryEvent } from '@/lib/decision-os/core/telemetry'
import type { CanonicalWorld, TeamFacts, RosterFacts } from '@/lib/decision-os/world/facts'
import type { TradeValueSnapshot } from '@/lib/trade-value/types'
import {
  fakeWorldFacts,
  fakeProposal,
  fakeAssets,
  fakeMultiTeamAssets,
  fakeSnapshot,
  fakeDecisionDeps,
} from './tradeFakes'

/**
 * Phase E.4 — Trade shadow wiring via TradeWorld (ADR-DOS-003).
 *
 * Proves the canonical pipeline (CanonicalWorld → TradeWorldResolver → CanonicalTradeMemo →
 * manager.trade.evaluate) runs BESIDE the existing redraft-native trade shadow:
 *   • the native path is UNCHANGED (it runs first; its result is final);
 *   • the canonical attempt runs when inputs exist, and records honest parity vs the redraft snapshot;
 *   • when canonical inputs are unavailable it returns a STRUCTURED skip (never throws);
 *   • it is read-only (no writes / no persistence), provider-blind in decision-facing telemetry, and
 *     emits the required source / completeness / uncertainty / asset+participant-count signals.
 *
 * Pure + hermetic: the canonical world resolver is injected; no prisma, no IO.
 */

// ── Hermetic Canonical World whose roster ids match the redraft fakes (rosterA/B/C) ────────────────
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

function makeCanonicalWorld(opts: { provider: string | null }): CanonicalWorld {
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
    teams: [team('tA', 2), team('tB', 4), team('tC', 6)],
    rosters: [
      roster('rosterA', 'tA', ['pa', 'pX']),
      roster('rosterB', 'tB', ['pb', 'pY']),
      roster('rosterC', 'tC', ['pc']),
    ],
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

const baseAttemptArgs = (over: Partial<Parameters<typeof runCanonicalTradeShadowAttempt>[0]> = {}) => ({
  leagueId: 'L1',
  proposerRosterId: 'rosterA',
  receiverRosterId: 'rosterB',
  assets: fakeAssets(),
  referenceSnapshot: fakeSnapshot(),
  proposalId: 'prop-1',
  ...over,
})

const worldDeps = (provider: string | null = 'sleeper') => ({
  resolveWorld: async () => makeCanonicalWorld({ provider }),
})

afterEach(() => registerDecisionTelemetrySink(null))

// ──────────────────────────────────────────────────────────────────────────
// 1. Canonical attempt RUNS when inputs exist
// ──────────────────────────────────────────────────────────────────────────
describe('Phase E.4 — runCanonicalTradeShadowAttempt: runs when inputs exist', () => {
  it('resolves the canonical world, builds the memo, and reports ran=true with a two-sided snapshot', async () => {
    const res = await runCanonicalTradeShadowAttempt(baseAttemptArgs(), worldDeps())
    expect(res.ran).toBe(true)
    expect(res.skipReason).toBeUndefined()
    expect(res.memo?.snapshot.sides.map((s) => s.rosterId)).toEqual(['rosterA', 'rosterB'])
    expect(res.memo?.provenance.memoSource).toBe('canonical_world')
    expect(res.memo?.provenance.valuationSource).toBe('deterministic_engine')
  })

  it('records parity vs the redraft snapshot — honest-degraded difference (no enrichment port yet, E.5)', async () => {
    const res = await runCanonicalTradeShadowAttempt(baseAttemptArgs(), worldDeps())
    expect(res.ran).toBe(true)
    expect(res.parity).toBeDefined()
    // DOCUMENTED intentional difference: with no ADP/projection injected, player values floor to 0, so the
    // canonical snapshot diverges from the redraft snapshot. Parity is recorded honestly, never faked.
    expect(res.parity?.passed).toBe(false)
    expect(res.parity!.diffs.length).toBeGreaterThan(0)
    expect(res.telemetry.parity?.passed).toBe(false)
  })

  it('emits exactly one decision.shadow_parity with source=canonical_trade_world and the required signals', async () => {
    const events: DecisionTelemetryEvent[] = []
    registerDecisionTelemetrySink((e) => events.push(e))
    const res = await runCanonicalTradeShadowAttempt(baseAttemptArgs(), worldDeps())

    const parityEvents = events.filter((e) => e.event === 'decision.shadow_parity')
    expect(parityEvents).toHaveLength(1)
    const flags = parityEvents[0].flags!
    expect(flags.source).toBe('canonical_trade_world')
    expect(flags.ran).toBe(true)
    expect(flags.asset_count).toBe(2)
    expect(flags.participant_count).toBe(2)
    expect(flags.memo_source).toBe('canonical_world')
    expect(flags.valuation_source).toBe('deterministic_engine')
    expect(typeof flags.completeness).toBe('number')
    expect(flags.uncertainty_count).toBe(res.telemetry.uncertainty_count)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// 2. Structured skips — canonical unavailable degrades gracefully (never throws)
// ──────────────────────────────────────────────────────────────────────────
describe('Phase E.4 — structured skips (never throws)', () => {
  it('canonical_trade_world_unavailable when the resolver returns null', async () => {
    const res = await runCanonicalTradeShadowAttempt(baseAttemptArgs(), { resolveWorld: async () => null })
    expect(res.ran).toBe(false)
    expect(res.skipReason).toBe('canonical_trade_world_unavailable')
    expect(res.telemetry.ran).toBe(false)
  })

  it('canonical_trade_world_unavailable when the world does not cover both participant rosters (identity mismatch)', async () => {
    const world = makeCanonicalWorld({ provider: 'sleeper' })
    world.rosters = world.rosters.filter((r) => r.rosterId !== 'rosterB') // receiver absent
    const res = await runCanonicalTradeShadowAttempt(baseAttemptArgs(), { resolveWorld: async () => world })
    expect(res.ran).toBe(false)
    expect(res.skipReason).toBe('canonical_trade_world_unavailable')
  })

  it('canonical_trade_world_unavailable when the resolver THROWS (db down) — caught, never rethrown', async () => {
    const res = await runCanonicalTradeShadowAttempt(baseAttemptArgs(), {
      resolveWorld: async () => {
        throw new Error('db down')
      },
    })
    expect(res.ran).toBe(false)
    expect(res.skipReason).toBe('canonical_trade_world_unavailable')
  })

  it('canonical_asset_resolution_unavailable when there are no trade assets', async () => {
    const res = await runCanonicalTradeShadowAttempt(baseAttemptArgs({ assets: [] }), worldDeps())
    expect(res.ran).toBe(false)
    expect(res.skipReason).toBe('canonical_asset_resolution_unavailable')
  })

  it('canonical_memo_unavailable for a multi-team trade (two-sided canonical memo is unsupported)', async () => {
    const res = await runCanonicalTradeShadowAttempt(baseAttemptArgs({ assets: fakeMultiTeamAssets() }), worldDeps())
    expect(res.ran).toBe(false)
    expect(res.skipReason).toBe('canonical_memo_unavailable')
    expect(res.telemetry.participant_count).toBe(3)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// 3. Read-only enforcement + provider non-leak (origin-blind decision-facing telemetry)
// ──────────────────────────────────────────────────────────────────────────
describe('Phase E.4 — read-only + provider non-leak', () => {
  const src = readFileSync(resolve(process.cwd(), 'lib/decision-os/trade/canonicalShadow.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('imports no prisma and performs no writes/persistence/cache-warming', () => {
    expect(code.includes('@/lib/prisma')).toBe(false)
    expect(/prisma\./.test(code)).toBe(false)
    expect(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(code)).toBe(false)
  })

  it('does not branch business logic on provider names (origin-blind)', () => {
    expect(code).not.toMatch(/===\s*['"]sleeper['"]/)
    expect(code).not.toMatch(/===\s*['"]espn['"]/)
    expect(code).not.toMatch(/===\s*['"]yahoo['"]/)
  })

  it('provider appears ONLY under provenance in telemetry — never in a decision-facing flag', async () => {
    const events: DecisionTelemetryEvent[] = []
    registerDecisionTelemetrySink((e) => events.push(e))
    const res = await runCanonicalTradeShadowAttempt(baseAttemptArgs(), worldDeps('sleeper'))

    expect(res.telemetry.provenance?.provider).toBe('sleeper')
    const flags = events.find((e) => e.event === 'decision.shadow_parity')!.flags as Record<string, unknown>
    // Strip the provenance namespace; nothing decision-facing may carry the provider name.
    const decisionFacing = JSON.stringify({ ...flags, provenance: undefined })
    expect(decisionFacing.includes('sleeper')).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// 4. Mount: native path UNCHANGED; canonical attached beside it
// ──────────────────────────────────────────────────────────────────────────
describe('Phase E.4 — mounted in runTradeShadowForProposal (beside the native path)', () => {
  const okDeps = (over = {}) => ({
    loadWorldFacts: async () => fakeWorldFacts(),
    buildDecisionDeps: (memo: TradeValueSnapshot) => fakeDecisionDeps({ evaluate: async () => memo }),
    ...over,
  })

  const baseArgs = (snapshotPayload: unknown = fakeSnapshot()) => ({
    userId: 'u1',
    leagueId: 'L1',
    seasonId: 'S1',
    proposal: fakeProposal(),
    assets: fakeAssets(),
    snapshotPayload,
  })

  it('native shadow result is UNCHANGED and the canonical attempt runs beside it', async () => {
    const res = await runTradeShadowForProposal(
      baseArgs(fakeSnapshot()),
      okDeps({ resolveCanonicalWorld: async () => makeCanonicalWorld({ provider: 'sleeper' }) }),
    )
    // Native path: identical to the existing wrap-fidelity contract.
    expect(res.ran).toBe(true)
    expect(res.result?.parity?.passed).toBe(true)
    expect(res.result?.parity?.wrapFidelity).toBe(true)
    // Canonical attempt rode beside it.
    expect(res.canonical?.ran).toBe(true)
    expect(res.canonical?.memo?.provenance.memoSource).toBe('canonical_world')
  })

  it('when canonical inputs are unavailable, native path is unaffected and canonical is a structured skip', async () => {
    const res = await runTradeShadowForProposal(
      baseArgs(fakeSnapshot()),
      okDeps({ resolveCanonicalWorld: async () => null }),
    )
    expect(res.ran).toBe(true)
    expect(res.result?.parity?.passed).toBe(true)
    expect(res.canonical?.ran).toBe(false)
    expect(res.canonical?.skipReason).toBe('canonical_trade_world_unavailable')
  })

  it('a throwing canonical resolver never affects the native result (canonical degrades to a skip)', async () => {
    const res = await runTradeShadowForProposal(
      baseArgs(fakeSnapshot()),
      okDeps({
        resolveCanonicalWorld: async () => {
          throw new Error('db down')
        },
      }),
    )
    expect(res.ran).toBe(true)
    expect(res.result?.parity?.passed).toBe(true)
    expect(res.canonical?.ran).toBe(false)
    expect(res.canonical?.skipReason).toBe('canonical_trade_world_unavailable')
  })
})
