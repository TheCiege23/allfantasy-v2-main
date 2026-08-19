import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import { projectEnrichedWorld } from '@/lib/decision-os/world/enrichedWorld'
import {
  deriveAdpFormat,
  deriveAdpScoring,
  selectBestAdpRow,
  projectAdpContext,
  projectMarketValueContext,
  projectAdpEnrichedWorld,
  resolveAdpEnrichedCanonicalWorld,
  type AdpContextResult,
} from '@/lib/decision-os/world/adpEnrichedWorld'
import type {
  CanonicalWorld,
  NormalizedPlayerMetadata,
  PlayerMetadataResult,
  RawAdpRow,
  RawMarketValueRow,
  LeagueFacts,
} from '@/lib/decision-os/world'
import { makeImportedProviderWorld, makeNativeAfWorld } from './canonicalWorldFakes'

const NOW = new Date('2026-06-30T12:00:00.000Z')
const FRESH_ADP_DATE = new Date('2026-06-29T00:00:00.000Z') // 36 hours ago — not stale for 7-day ADP threshold
const FRESH_MV_DATE = new Date('2026-06-30T06:00:00.000Z') // 6 hours ago — not stale for 24h MV threshold
const STALE_DATE = new Date('2026-06-01T00:00:00.000Z') // 29 days ago — stale for ADP
const STALE_MV_DATE = new Date('2026-06-29T00:00:00.000Z') // 36 hours ago — stale for 24h MV threshold
// Alias for backward compat in ADP-specific tests
const FRESH_DATE = FRESH_ADP_DATE

const assemble = (input: Parameters<typeof assembleCanonicalWorld>[0]): CanonicalWorld =>
  assembleCanonicalWorld(input, { now: NOW })

function idsOf(world: CanonicalWorld): string[] {
  return Array.from(new Set(world.rosters.flatMap((r) => r.playerIds)))
}

function meta(ids: string[], opts: { missing?: string[] } = {}): PlayerMetadataResult {
  const missing = new Set(opts.missing ?? [])
  const byId = new Map<string, NormalizedPlayerMetadata>()
  const unresolvedIds: string[] = []
  for (const id of ids) {
    if (missing.has(id)) {
      byId.set(id, {
        playerId: id, name: null, position: null, team: null, injuryStatus: null,
        byeWeek: null, projectedPoints: null, projectionConfidence: null, source: null, resolved: false,
      })
      unresolvedIds.push(id)
      continue
    }
    byId.set(id, {
      playerId: id, name: `Name ${id}`, position: 'RB', team: 'BUF', injuryStatus: null,
      byeWeek: null, projectedPoints: null, projectionConfidence: null,
      source: 'sports_player_cache', resolved: true,
    })
  }
  return { byId, complete: ids.length > 0 && unresolvedIds.length === 0, unresolvedIds, warnings: [] }
}

function adpRow(playerId: string, overrides: Partial<RawAdpRow> = {}): RawAdpRow {
  return {
    playerId,
    adp: 12.5,
    adpChange: -1.2,
    adpSpread: 3.1,
    confidenceScore: 85,
    providerCount: 4,
    format: 'redraft',
    scoring: 'ppr',
    season: 2025,
    week: 1,
    source: 'consensus',
    createdAt: FRESH_DATE,
    ...overrides,
  }
}

function mvRow(playerId: string, overrides: Partial<RawMarketValueRow> = {}): RawMarketValueRow {
  return {
    playerId,
    marketValue: 850,
    baseValue: 900,
    adjustmentPercent: -5.5,
    confidence: 72,
    sampleSize: 15,
    direction: 'stable',
    leagueConcept: 'redraft',
    scoringFormat: 'ppr',
    generatedAt: FRESH_MV_DATE,
    updatedAt: FRESH_MV_DATE,
    ...overrides,
  }
}

function fakeLeague(overrides: Partial<LeagueFacts> = {}): LeagueFacts {
  return {
    leagueId: 'test-league',
    sport: 'NFL',
    season: 2025,
    leagueType: null,
    isDynasty: false,
    scoringPresetId: 'ppr',
    scoringSettings: null,
    rosterSettings: { rosterSize: null, starterSlots: null, irSlots: null, taxiSlots: null },
    waiverSettings: { type: null, budget: null, minBid: null, hours: null },
    tradeSettings: { reviewHours: null, deadlineWeek: null, pickTrading: null },
    currentWeek: 1,
    currentWeekBasis: 'team_performance',
    ...overrides,
  }
}

function emptyContextResult(ids: string[]): AdpContextResult {
  const now = new Date()
  const adpById = new Map<string, ReturnType<typeof projectAdpContext>>()
  const marketValueById = new Map<string, ReturnType<typeof projectMarketValueContext>>()
  for (const id of ids) {
    adpById.set(id, projectAdpContext([], 'redraft', 'ppr', now))
    marketValueById.set(id, projectMarketValueContext(null, now))
  }
  return { adpById, marketValueById, adpResolvedCount: 0, marketValueResolvedCount: 0, warnings: [] }
}

// ──────────────────────────────────────────────────────────────────────
describe('F2.4: deriveAdpFormat + deriveAdpScoring — pure, deterministic', () => {
  it('maps isDynasty to dynasty/redraft', () => {
    expect(deriveAdpFormat(true)).toBe('dynasty')
    expect(deriveAdpFormat(false)).toBe('redraft')
  })

  it('maps known scoring presets', () => {
    expect(deriveAdpScoring('ppr')).toBe('ppr')
    expect(deriveAdpScoring('half_ppr')).toBe('halfPPR')
    expect(deriveAdpScoring('half-ppr')).toBe('halfPPR')
    expect(deriveAdpScoring('standard')).toBe('standard')
    expect(deriveAdpScoring('2qb')).toBe('2qb')
    expect(deriveAdpScoring('superflex')).toBe('superflex')
  })

  it('returns null for unknown or null scoring preset', () => {
    expect(deriveAdpScoring(null)).toBeNull()
    expect(deriveAdpScoring('')).toBeNull()
    expect(deriveAdpScoring('custom_scoring')).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────
describe('F2.4: selectBestAdpRow — tiered selection, pure', () => {
  it('selects exact format+scoring match first', () => {
    const rows = [
      adpRow('p1', { format: 'redraft', scoring: 'ppr', adp: 10 }),
      adpRow('p1', { format: 'redraft', scoring: 'standard', adp: 8 }),
      adpRow('p1', { format: 'dynasty', scoring: 'standard', adp: 5 }),
    ]
    const result = selectBestAdpRow(rows, 'redraft', 'ppr')
    expect(result?.row.adp).toBe(10)
    expect(result?.matchTier).toBe('exact')
  })

  it('falls back to same-format when no exact scoring match', () => {
    const rows = [
      adpRow('p1', { format: 'redraft', scoring: 'standard', adp: 8 }),
      adpRow('p1', { format: 'dynasty', scoring: 'standard', adp: 5 }),
    ]
    const result = selectBestAdpRow(rows, 'redraft', 'ppr')
    expect(result?.row.adp).toBe(8)
    expect(result?.matchTier).toBe('same_format')
  })

  it('falls back to any-format when no same-format rows exist', () => {
    const rows = [
      adpRow('p1', { format: 'dynasty', scoring: 'standard', adp: 5 }),
    ]
    const result = selectBestAdpRow(rows, 'redraft', 'ppr')
    expect(result?.row.adp).toBe(5)
    expect(result?.matchTier).toBe('any_format')
  })

  it('returns null for empty rows', () => {
    expect(selectBestAdpRow([], 'redraft', 'ppr')).toBeNull()
  })

  it('selects exact match even when scoring is null (skips tier-1, goes to tier-2)', () => {
    const rows = [
      adpRow('p1', { format: 'redraft', scoring: 'ppr', adp: 10 }),
    ]
    // derivedScoring = null → skips tier-1 (no scoring match possible)
    const result = selectBestAdpRow(rows, 'redraft', null)
    expect(result?.matchTier).toBe('same_format')
  })
})

// ──────────────────────────────────────────────────────────────────────
describe('F2.4: projectAdpContext — pure, no IO', () => {
  it('builds a fully-resolved context from a fresh exact-match row', () => {
    const ctx = projectAdpContext(
      [adpRow('p1', { format: 'redraft', scoring: 'ppr', createdAt: FRESH_DATE })],
      'redraft', 'ppr', NOW,
    )
    expect(ctx.adp).toBe(12.5)
    expect(ctx.resolved).toBe(true)
    expect(ctx.freshness.isStale).toBe(false)
    expect(ctx.uncertainty).not.toContain('adp_unavailable')
    expect(ctx.uncertainty).not.toContain('adp_format_mismatch')
  })

  it('adds adp_scoring_format_mismatch warning on same-format fallback', () => {
    const ctx = projectAdpContext(
      [adpRow('p1', { format: 'redraft', scoring: 'standard' })],
      'redraft', 'ppr', NOW,
    )
    expect(ctx.resolved).toBe(true)
    expect(ctx.uncertainty).toContain('adp_scoring_format_mismatch')
  })

  it('adds adp_format_mismatch warning on any-format fallback', () => {
    const ctx = projectAdpContext(
      [adpRow('p1', { format: 'dynasty', scoring: 'standard' })],
      'redraft', 'ppr', NOW,
    )
    expect(ctx.resolved).toBe(true)
    expect(ctx.uncertainty).toContain('adp_format_mismatch')
  })

  it('marks isStale=true for rows older than 7 days', () => {
    const ctx = projectAdpContext(
      [adpRow('p1', { createdAt: STALE_DATE })],
      'redraft', 'ppr', NOW,
    )
    expect(ctx.freshness.isStale).toBe(true)
    expect(ctx.freshness.staleReason).toBe('adp_age_exceeded_7_days')
    expect(ctx.uncertainty).toContain('adp_age_exceeded_7_days')
  })

  it('degrades to fully-null unresolved when no rows available', () => {
    const ctx = projectAdpContext([], 'redraft', 'ppr', NOW)
    expect(ctx.adp).toBeNull()
    expect(ctx.resolved).toBe(false)
    expect(ctx.uncertainty).toContain('adp_unavailable')
  })

  it('adds adp_scoring_format_unknown when derivedScoring is null', () => {
    const ctx = projectAdpContext(
      [adpRow('p1', { format: 'redraft', scoring: 'ppr' })],
      'redraft', null, NOW,
    )
    expect(ctx.uncertainty).toContain('adp_scoring_format_unknown')
  })
})

// ──────────────────────────────────────────────────────────────────────
describe('F2.4: projectMarketValueContext — pure, no IO', () => {
  it('builds a resolved context from a fresh row', () => {
    const ctx = projectMarketValueContext(mvRow('p1', { generatedAt: FRESH_MV_DATE, updatedAt: FRESH_MV_DATE }), NOW)
    expect(ctx.marketValue).toBe(850)
    expect(ctx.resolved).toBe(true)
    expect(ctx.freshness.isStale).toBe(false)
    expect(ctx.direction).toBe('stable')
    expect(ctx.uncertainty).not.toContain('market_value_unavailable')
  })

  it('marks isStale=true for market values older than 24h', () => {
    const ctx = projectMarketValueContext(mvRow('p1', { generatedAt: STALE_MV_DATE }), NOW)
    expect(ctx.freshness.isStale).toBe(true)
    expect(ctx.freshness.staleReason).toBe('market_value_stale')
    expect(ctx.uncertainty).toContain('market_value_stale')
  })

  it('degrades to null unresolved when row is null', () => {
    const ctx = projectMarketValueContext(null, NOW)
    expect(ctx.marketValue).toBeNull()
    expect(ctx.resolved).toBe(false)
    expect(ctx.uncertainty).toContain('market_value_unavailable')
  })
})

// ──────────────────────────────────────────────────────────────────────
describe('F2.4: ADP/market-value view layers additively on F2.1 enriched world', () => {
  it('adds adpMarketContext to all players without mutating the base enriched world', () => {
    const world = assemble(makeImportedProviderWorld())
    const enriched = projectEnrichedWorld(world, meta(idsOf(world)))
    const before = JSON.stringify(enriched)

    const ids = idsOf(world)
    const league = fakeLeague()
    const contextResult: AdpContextResult = {
      adpById: new Map(ids.map((id) => [id, projectAdpContext([adpRow(id)], 'redraft', 'ppr', NOW)])),
      marketValueById: new Map(ids.map((id) => [id, projectMarketValueContext(mvRow(id), NOW)])),
      adpResolvedCount: ids.length,
      marketValueResolvedCount: ids.length,
      warnings: [],
    }

    const out = projectAdpEnrichedWorld(enriched, contextResult, league)
    expect(JSON.stringify(enriched)).toBe(before)

    const player = out.rosters.flatMap((r) => r.players)[0]!
    expect(player.adpMarketContext).toBeDefined()
    expect(player.adpMarketContext.adp.adp).toBe(12.5)
    expect(player.adpMarketContext.marketValue.marketValue).toBe(850)
    expect(out.adpSummary.adpResolvedPlayers).toBe(ids.length)
    expect(out.adpSummary.adpCompleteness).toBe(100)
    expect(out.adpSummary.marketValueCompleteness).toBe(100)
  })

  it('computes per-roster adpCompleteness honestly when some players unresolved', () => {
    const world = assemble(makeImportedProviderWorld())
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const halfIds = ids.slice(0, Math.ceil(ids.length / 2))
    const league = fakeLeague()

    const contextResult: AdpContextResult = {
      adpById: new Map([
        ...halfIds.map((id) => [id, projectAdpContext([adpRow(id)], 'redraft', 'ppr', NOW)] as const),
        ...ids.slice(halfIds.length).map((id) => [id, projectAdpContext([], 'redraft', 'ppr', NOW)] as const),
      ]),
      marketValueById: new Map(ids.map((id) => [id, projectMarketValueContext(null, NOW)])),
      adpResolvedCount: halfIds.length,
      marketValueResolvedCount: 0,
      warnings: [],
    }

    const out = projectAdpEnrichedWorld(enriched, contextResult, league)
    expect(out.adpSummary.adpResolvedPlayers).toBe(halfIds.length)
    expect(out.adpSummary.adpCompleteness).toBeGreaterThan(0)
    expect(out.adpSummary.adpCompleteness).toBeLessThan(100)
    expect(out.adpSummary.marketValueCompleteness).toBe(0)
  })

  it('imported/native output shape is identical — origin-blind', () => {
    const importedWorld = projectEnrichedWorld(assemble(makeImportedProviderWorld()), meta(idsOf(assemble(makeImportedProviderWorld()))))
    const nativeWorld = projectEnrichedWorld(assemble(makeNativeAfWorld()), meta(idsOf(assemble(makeNativeAfWorld()))))
    const league = fakeLeague()

    const makeResult = (ids: string[]): AdpContextResult => ({
      adpById: new Map(ids.map((id) => [id, projectAdpContext([], 'redraft', 'ppr', NOW)])),
      marketValueById: new Map(ids.map((id) => [id, projectMarketValueContext(null, NOW)])),
      adpResolvedCount: 0,
      marketValueResolvedCount: 0,
      warnings: [],
    })

    const imported = projectAdpEnrichedWorld(importedWorld, makeResult(importedWorld.rosters.flatMap((r) => r.players.map((p) => p.playerId))), league)
    const native = projectAdpEnrichedWorld(nativeWorld, makeResult(nativeWorld.rosters.flatMap((r) => r.players.map((p) => p.playerId))), league)

    const importedKeys = Object.keys(imported.rosters[0]!.players[0]!).sort()
    const nativeKeys = Object.keys(native.rosters[0]!.players[0]!).sort()
    expect(importedKeys).toEqual(nativeKeys)
    expect(JSON.stringify(imported.rosters).toLowerCase()).not.toContain('sleeper')
  })

  it('degrades honestly when no ADP/market-value rows available — completeness 0', () => {
    const world = assemble(makeImportedProviderWorld())
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const out = projectAdpEnrichedWorld(enriched, emptyContextResult(ids), fakeLeague())

    expect(out.adpSummary.adpCompleteness).toBe(0)
    expect(out.adpSummary.marketValueCompleteness).toBe(0)
    const firstPlayer = out.rosters.flatMap((r) => r.players)[0]!
    expect(firstPlayer.adpMarketContext.adp.resolved).toBe(false)
    expect(firstPlayer.adpMarketContext.adp.uncertainty).toContain('adp_unavailable')
    expect(firstPlayer.adpMarketContext.marketValue.resolved).toBe(false)
    expect(firstPlayer.adpMarketContext.marketValue.uncertainty).toContain('market_value_unavailable')
  })

  it('counts stale ADP players in summary', () => {
    const world = assemble(makeImportedProviderWorld())
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const league = fakeLeague()

    const contextResult: AdpContextResult = {
      adpById: new Map(ids.map((id) => [id, projectAdpContext([adpRow(id, { createdAt: STALE_DATE })], 'redraft', 'ppr', NOW)])),
      marketValueById: new Map(ids.map((id) => [id, projectMarketValueContext(null, NOW)])),
      adpResolvedCount: ids.length,
      marketValueResolvedCount: 0,
      warnings: [],
    }

    const out = projectAdpEnrichedWorld(enriched, contextResult, league)
    expect(out.adpSummary.staleAdpPlayers).toBe(ids.length)
    expect(out.adpSummary.adpCompleteness).toBe(100) // stale but still resolved
  })
})

// ──────────────────────────────────────────────────────────────────────
describe('F2.4: resolveAdpEnrichedCanonicalWorld — read-only, never throws', () => {
  it('resolves via injected deps', async () => {
    const world = assemble(makeImportedProviderWorld())
    const enriched = projectEnrichedWorld(world, meta(idsOf(world)))
    const ids = idsOf(world)
    const league = fakeLeague()

    const out = await resolveAdpEnrichedCanonicalWorld('lg', {
      resolveEnrichedWorld: async () => enriched,
      resolveAdpContext: async () => ({
        adpById: new Map(ids.map((id) => [id, projectAdpContext([adpRow(id)], 'redraft', 'ppr', NOW)])),
        marketValueById: new Map(ids.map((id) => [id, projectMarketValueContext(mvRow(id), NOW)])),
        adpResolvedCount: ids.length,
        marketValueResolvedCount: ids.length,
        warnings: [],
      }),
    })

    expect(out).not.toBeNull()
    expect(out!.adpSummary.adpCompleteness).toBe(100)
    expect(out!.adpSummary.marketValueCompleteness).toBe(100)
  })

  it('returns null when enriched world is null', async () => {
    const out = await resolveAdpEnrichedCanonicalWorld('lg', {
      resolveEnrichedWorld: async () => null,
      resolveAdpContext: async () => ({
        adpById: new Map(), marketValueById: new Map(),
        adpResolvedCount: 0, marketValueResolvedCount: 0, warnings: [],
      }),
    })
    expect(out).toBeNull()
  })

  it('degrades gracefully when ADP/market resolver throws — never throws, all unresolved', async () => {
    const world = assemble(makeImportedProviderWorld())
    const enriched = projectEnrichedWorld(world, meta(idsOf(world)))

    const out = await resolveAdpEnrichedCanonicalWorld('lg', {
      resolveEnrichedWorld: async () => enriched,
      resolveAdpContext: async () => { throw new Error('source unavailable') },
    })

    expect(out).not.toBeNull()
    expect(out!.adpSummary.adpCompleteness).toBe(0)
    expect(out!.adpSummary.marketValueCompleteness).toBe(0)
    expect(out!.rosters.every((r) => r.players.every((p) => !p.adpMarketContext.adp.resolved))).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────
describe('F2.4: architecture — ADP enrichment file is read-only', () => {
  it('adpEnrichedWorld.ts imports no prisma and performs no writes', () => {
    const raw = readFileSync(resolvePath(process.cwd(), 'lib/decision-os/world/adpEnrichedWorld.ts'), 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(src.includes('@/lib/prisma')).toBe(false)
    expect(/\bprisma\./.test(src)).toBe(false)
    expect(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(src)).toBe(false)
  })
})
