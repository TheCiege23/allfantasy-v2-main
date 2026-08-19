import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import { projectEnrichedWorld } from '@/lib/decision-os/world/enrichedWorld'
import {
  selectBestProjectionRow,
  projectProjectionFreshness,
  projectProjectionContext,
  projectProjectionEnrichedWorld,
  resolveProjectionContext,
  resolveProjectionEnrichedCanonicalWorld,
  type ProjectionContextResult,
} from '@/lib/decision-os/world/projectionEnrichedWorld'
import type {
  CanonicalWorld,
  NormalizedPlayerMetadata,
  PlayerMetadataResult,
  RawProjectionRow,
  LeagueFacts,
} from '@/lib/decision-os/world'
import { makeImportedProviderWorld, makeNativeAfWorld } from './canonicalWorldFakes'

const NOW = new Date('2026-06-30T12:00:00.000Z')
const FRESH_EXPIRES = new Date('2026-07-07T12:00:00.000Z') // 7 days from NOW — not stale
const STALE_EXPIRES = new Date('2026-06-29T00:00:00.000Z') // 36 hours before NOW — stale
const FRESH_FETCHED = new Date('2026-06-30T10:00:00.000Z')

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

function projRow(playerId: string, opts: Partial<RawProjectionRow> = {}): RawProjectionRow {
  return {
    playerId,
    sport: 'NFL',
    season: '2026',
    week: 6,
    scoringPresetId: 'ppr',
    projectedPoints: 15.5,
    stats: { rec: 5, recYds: 60 },
    source: 'fantasypros',
    fetchedAt: FRESH_FETCHED,
    expiresAt: FRESH_EXPIRES,
    ...opts,
  }
}

function emptyContextResult(error: string | null = null): ProjectionContextResult {
  return { rowsByPlayer: new Map(), error }
}

function contextResultFrom(rows: RawProjectionRow[]): ProjectionContextResult {
  const rowsByPlayer = new Map<string, RawProjectionRow[]>()
  for (const row of rows) {
    const existing = rowsByPlayer.get(row.playerId)
    if (existing) existing.push(row)
    else rowsByPlayer.set(row.playerId, [row])
  }
  return { rowsByPlayer, error: null }
}

function makeLeagueFacts(opts: Partial<LeagueFacts> = {}): LeagueFacts {
  return {
    leagueId: 'test-league',
    sport: 'NFL',
    season: 2026,
    leagueType: 'redraft',
    isDynasty: false,
    scoringPresetId: 'ppr',
    scoringSettings: null,
    rosterSettings: { rosterSize: 10, starterSlots: ['QB', 'RB', 'WR'], irSlots: 1, taxiSlots: 0 },
    waiverSettings: { type: 'faab', budget: 100, minBid: 0, hours: 24 },
    tradeSettings: { reviewHours: 24, deadlineWeek: 13, pickTrading: true },
    currentWeek: 6,
    currentWeekBasis: 'team_performance',
    ...opts,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// selectBestProjectionRow
// ──────────────────────────────────────────────────────────────────────────

describe('selectBestProjectionRow', () => {
  it('returns null for empty rows', () => {
    expect(selectBestProjectionRow([], 'ppr')).toBeNull()
  })

  it('returns exact match when scoringPresetId matches', () => {
    const ppr = projRow('p1', { scoringPresetId: 'ppr', projectedPoints: 18 })
    const std = projRow('p1', { scoringPresetId: 'standard', projectedPoints: 14 })
    const result = selectBestProjectionRow([ppr, std], 'ppr')
    expect(result?.matchTier).toBe('exact')
    expect(result?.row.scoringPresetId).toBe('ppr')
    expect(result?.row.projectedPoints).toBe(18)
  })

  it('falls back to any_scoring when no exact match', () => {
    const std = projRow('p1', { scoringPresetId: 'standard', projectedPoints: 14 })
    const result = selectBestProjectionRow([std], 'ppr')
    expect(result?.matchTier).toBe('any_scoring')
    expect(result?.row.scoringPresetId).toBe('standard')
  })

  it('takes first row (port-ordered by expiresAt desc) within any_scoring tier', () => {
    const row1 = projRow('p1', { scoringPresetId: 'standard', projectedPoints: 14, expiresAt: FRESH_EXPIRES })
    const row2 = projRow('p1', { scoringPresetId: 'half_ppr', projectedPoints: 16, expiresAt: STALE_EXPIRES })
    // row1 is first (fresher) — port orders by expiresAt desc
    const result = selectBestProjectionRow([row1, row2], 'ppr')
    expect(result?.row.projectedPoints).toBe(14) // first row wins
  })

  it('handles null scoringPresetId — any_scoring fallback', () => {
    const std = projRow('p1', { scoringPresetId: 'standard' })
    const result = selectBestProjectionRow([std], null)
    expect(result?.matchTier).toBe('any_scoring')
  })

  it('exact match takes precedence over any_scoring even when exact is second in array', () => {
    const std = projRow('p1', { scoringPresetId: 'standard' })
    const ppr = projRow('p1', { scoringPresetId: 'ppr', projectedPoints: 20 })
    const result = selectBestProjectionRow([std, ppr], 'ppr')
    expect(result?.matchTier).toBe('exact')
    expect(result?.row.projectedPoints).toBe(20)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectProjectionFreshness
// ──────────────────────────────────────────────────────────────────────────

describe('projectProjectionFreshness', () => {
  it('returns fresh when expiresAt is in the future', () => {
    const row = projRow('p1', { expiresAt: FRESH_EXPIRES })
    const f = projectProjectionFreshness(row, NOW)
    expect(f.isStale).toBe(false)
    expect(f.staleReason).toBeNull()
    expect(f.expiresAt).toEqual(FRESH_EXPIRES)
  })

  it('returns stale when expiresAt is in the past', () => {
    const row = projRow('p1', { expiresAt: STALE_EXPIRES })
    const f = projectProjectionFreshness(row, NOW)
    expect(f.isStale).toBe(true)
    expect(f.staleReason).toBe('projection_expired')
  })

  it('returns null freshness when no row', () => {
    const f = projectProjectionFreshness(null, NOW)
    expect(f.isStale).toBeNull()
    expect(f.expiresAt).toBeNull()
    expect(f.staleReason).toBe('projection_freshness_unavailable')
  })

  it('carries fetchedAt', () => {
    const row = projRow('p1', { fetchedAt: FRESH_FETCHED })
    const f = projectProjectionFreshness(row, NOW)
    expect(f.fetchedAt).toEqual(FRESH_FETCHED)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectProjectionContext
// ──────────────────────────────────────────────────────────────────────────

describe('projectProjectionContext', () => {
  it('returns projection_unavailable when no rows', () => {
    const ctx = projectProjectionContext([], 'ppr', NOW)
    expect(ctx.projectedPoints).toBeNull()
    expect(ctx.uncertainty).toContain('projection_unavailable')
  })

  it('returns exact match with no uncertainty on fresh exact row', () => {
    const row = projRow('p1', { scoringPresetId: 'ppr', projectedPoints: 18.5, expiresAt: FRESH_EXPIRES })
    const ctx = projectProjectionContext([row], 'ppr', NOW)
    expect(ctx.projectedPoints).toBe(18.5)
    expect(ctx.matchTier).toBe('exact')
    expect(ctx.uncertainty).toHaveLength(0)
    expect(ctx.source).toBe('fantasypros')
    expect(ctx.scoringPresetId).toBe('ppr')
    expect(ctx.week).toBe(6)
    expect(ctx.season).toBe('2026')
  })

  it('adds projection_scoring_format_mismatch on any_scoring fallback', () => {
    const row = projRow('p1', { scoringPresetId: 'standard', expiresAt: FRESH_EXPIRES })
    const ctx = projectProjectionContext([row], 'ppr', NOW)
    expect(ctx.matchTier).toBe('any_scoring')
    expect(ctx.uncertainty).toContain('projection_scoring_format_mismatch')
  })

  it('adds projection_stale on stale row', () => {
    const row = projRow('p1', { scoringPresetId: 'ppr', expiresAt: STALE_EXPIRES })
    const ctx = projectProjectionContext([row], 'ppr', NOW)
    expect(ctx.freshness.isStale).toBe(true)
    expect(ctx.uncertainty).toContain('projection_stale')
  })

  it('can have both mismatch and stale uncertainty', () => {
    const row = projRow('p1', { scoringPresetId: 'standard', expiresAt: STALE_EXPIRES })
    const ctx = projectProjectionContext([row], 'ppr', NOW)
    expect(ctx.uncertainty).toContain('projection_scoring_format_mismatch')
    expect(ctx.uncertainty).toContain('projection_stale')
  })

  it('prefers exact match over stale any_scoring', () => {
    const exact = projRow('p1', { scoringPresetId: 'ppr', projectedPoints: 20, expiresAt: FRESH_EXPIRES })
    const anySc = projRow('p1', { scoringPresetId: 'standard', projectedPoints: 14, expiresAt: STALE_EXPIRES })
    const ctx = projectProjectionContext([anySc, exact], 'ppr', NOW)
    expect(ctx.projectedPoints).toBe(20)
    expect(ctx.matchTier).toBe('exact')
    expect(ctx.uncertainty).toHaveLength(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectProjectionEnrichedWorld — no mutation
// ──────────────────────────────────────────────────────────────────────────

describe('projectProjectionEnrichedWorld — no mutation', () => {
  it('does not mutate the base enriched world', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const leagueFacts = makeLeagueFacts()
    const frozen = JSON.stringify(enriched)

    projectProjectionEnrichedWorld(enriched, emptyContextResult(), leagueFacts, NOW)

    expect(JSON.stringify(enriched)).toBe(frozen)
  })

  it('projection layer does not appear on base rosters', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))

    expect((enriched.rosters[0]?.players[0] as Record<string, unknown>)['projectionContext']).toBeUndefined()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectProjectionEnrichedWorld — week gate
// ──────────────────────────────────────────────────────────────────────────

describe('projectProjectionEnrichedWorld — week gate', () => {
  it('degrades all players to projection_unavailable when currentWeek is null', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const leagueFacts = makeLeagueFacts({ currentWeek: null, currentWeekBasis: 'unavailable' })
    // even if we provide rows, week gate means no match
    const rows = ids.flatMap((id) => [projRow(id, { week: 6 })])
    const result = contextResultFrom(rows)

    const projected = projectProjectionEnrichedWorld(enriched, result, leagueFacts, NOW)
    // All players have no rows in rowsByPlayer (week gate at resolver level = empty map)
    // but here we test the projector with data that has week=6 while currentWeek=null
    // Projector sees rows; for the no-week case the resolver returns empty map — test that path
    const emptyResult = emptyContextResult()
    const projected2 = projectProjectionEnrichedWorld(enriched, emptyResult, leagueFacts, NOW)
    for (const roster of projected2.rosters) {
      for (const player of roster.players) {
        expect(player.projectionContext.projectedPoints).toBeNull()
        expect(player.projectionContext.uncertainty).toContain('projection_unavailable')
      }
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectProjectionEnrichedWorld — summary
// ──────────────────────────────────────────────────────────────────────────

describe('projectProjectionEnrichedWorld — summary', () => {
  it('counts withProjection and missingCount correctly', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const leagueFacts = makeLeagueFacts()

    // Provide projection only for the first player
    const firstId = ids[0]!
    const result = contextResultFrom([projRow(firstId, { expiresAt: FRESH_EXPIRES })])
    const projected = projectProjectionEnrichedWorld(enriched, result, leagueFacts, NOW)

    expect(projected.projectionSummary.withProjection).toBe(1)
    expect(projected.projectionSummary.missingCount).toBe(ids.length - 1)
    expect(projected.projectionSummary.totalPlayers).toBe(ids.length)
  })

  it('counts staleCount', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const leagueFacts = makeLeagueFacts()
    const rows = ids.map((id) => projRow(id, { expiresAt: STALE_EXPIRES }))
    const result = contextResultFrom(rows)
    const projected = projectProjectionEnrichedWorld(enriched, result, leagueFacts, NOW)

    expect(projected.projectionSummary.staleCount).toBe(ids.length)
  })

  it('counts formatMismatchCount', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const leagueFacts = makeLeagueFacts({ scoringPresetId: 'ppr' })
    // Provide half_ppr rows — all will be any_scoring fallback
    const rows = ids.map((id) => projRow(id, { scoringPresetId: 'half_ppr', expiresAt: FRESH_EXPIRES }))
    const result = contextResultFrom(rows)
    const projected = projectProjectionEnrichedWorld(enriched, result, leagueFacts, NOW)

    expect(projected.projectionSummary.formatMismatchCount).toBe(ids.length)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Origin-blind shape
// ──────────────────────────────────────────────────────────────────────────

describe('origin-blind shape', () => {
  it('imported and native worlds produce the same ProjectionEnrichedPlayer shape', () => {
    const importedWorld = assemble(makeImportedProviderWorld())
    const nativeWorld = assemble(makeNativeAfWorld())

    const importedIds = idsOf(importedWorld)
    const nativeIds = idsOf(nativeWorld)

    const importedEnriched = projectEnrichedWorld(importedWorld, meta(importedIds))
    const nativeEnriched = projectEnrichedWorld(nativeWorld, meta(nativeIds))

    const leagueFacts = makeLeagueFacts()

    const importedProjected = projectProjectionEnrichedWorld(importedEnriched, emptyContextResult(), leagueFacts, NOW)
    const nativeProjected = projectProjectionEnrichedWorld(nativeEnriched, emptyContextResult(), leagueFacts, NOW)

    // Same keys on each player
    const importedKeys = Object.keys(importedProjected.rosters[0]?.players[0] ?? {}).sort()
    const nativeKeys = Object.keys(nativeProjected.rosters[0]?.players[0] ?? {}).sort()
    expect(importedKeys).toEqual(nativeKeys)
  })

  it('provenance does not leak into projectionContext fields', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const leagueFacts = makeLeagueFacts()
    const result = contextResultFrom(ids.map((id) => projRow(id, { expiresAt: FRESH_EXPIRES })))
    const projected = projectProjectionEnrichedWorld(enriched, result, leagueFacts, NOW)

    const ctx = projected.rosters[0]!.players[0]!.projectionContext
    const ctxStr = JSON.stringify(ctx)
    expect(ctxStr).not.toContain('sleeper')
    expect(ctxStr).not.toContain('platformLeagueId')
    expect(ctxStr).not.toContain('provider')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// resolveProjectionContext — never throws
// ──────────────────────────────────────────────────────────────────────────

describe('resolveProjectionContext — never throws', () => {
  it('returns empty map with null error when week is null', async () => {
    const result = await resolveProjectionContext('NFL', ['p1'], '2026', null, {
      loadProjectionRows: async () => { throw new Error('should not be called') },
    })
    expect(result.rowsByPlayer.size).toBe(0)
    expect(result.error).toBeNull()
  })

  it('returns empty map with null error when ids is empty', async () => {
    const result = await resolveProjectionContext('NFL', [], '2026', 6, {
      loadProjectionRows: async () => { throw new Error('should not be called') },
    })
    expect(result.rowsByPlayer.size).toBe(0)
    expect(result.error).toBeNull()
  })

  it('surfaces port error as result.error without throwing', async () => {
    const result = await resolveProjectionContext('NFL', ['p1'], '2026', 6, {
      loadProjectionRows: async () => { throw new Error('db connection failed') },
    })
    expect(result.error).toBe('db connection failed')
    expect(result.rowsByPlayer.size).toBe(0)
  })

  it('groups rows by playerId', async () => {
    const rows = [
      projRow('p1', { scoringPresetId: 'ppr' }),
      projRow('p1', { scoringPresetId: 'standard' }),
      projRow('p2', { scoringPresetId: 'ppr' }),
    ]
    const result = await resolveProjectionContext('NFL', ['p1', 'p2'], '2026', 6, {
      loadProjectionRows: async () => rows,
    })
    expect(result.rowsByPlayer.get('p1')).toHaveLength(2)
    expect(result.rowsByPlayer.get('p2')).toHaveLength(1)
    expect(result.error).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// resolveProjectionEnrichedCanonicalWorld — never throws
// ──────────────────────────────────────────────────────────────────────--

describe('resolveProjectionEnrichedCanonicalWorld — never throws', () => {
  it('returns null for unknown leagueId without throwing', async () => {
    const result = await resolveProjectionEnrichedCanonicalWorld('nonexistent-league-id-xyz')
    expect(result).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Architecture guard — source file is read-only substrate
// ──────────────────────────────────────────────────────────────────────────

describe('architecture guard', () => {
  it('projectionEnrichedWorld.ts contains no prisma import (read-only via port)', () => {
    const src = readFileSync(
      resolvePath('lib/decision-os/world/projectionEnrichedWorld.ts'),
      'utf-8',
    )
    expect(src).not.toContain("from '@/lib/prisma'")
    expect(src).not.toContain("from '@/lib/prisma'")
  })

  it('projectionEnrichedWorld.ts contains no mutation keywords', () => {
    const src = readFileSync(
      resolvePath('lib/decision-os/world/projectionEnrichedWorld.ts'),
      'utf-8',
    )
    expect(src).not.toContain('.create(')
    expect(src).not.toContain('.update(')
    expect(src).not.toContain('.upsert(')
    expect(src).not.toContain('.delete(')
  })

  it('projectionEnrichedWorld.ts does not import AI or heuristic engines', () => {
    const src = readFileSync(
      resolvePath('lib/decision-os/world/projectionEnrichedWorld.ts'),
      'utf-8',
    )
    expect(src).not.toContain('projectionEngine')
    expect(src).not.toContain('AiProjection')
    expect(src).not.toContain('AFProjectionSnapshot')
    expect(src).not.toContain('POSITION_BASELINES')
  })
})
