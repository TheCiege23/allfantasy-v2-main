import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, it, expect } from 'vitest'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import {
  projectEnrichedWorld,
  resolveEnrichedCanonicalWorld,
} from '@/lib/decision-os/world/enrichedWorld'
import type { NormalizedPlayerMetadata, PlayerMetadataResult } from '@/lib/decision-os/world/playerMetadata'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { makeImportedProviderWorld, makeNativeAfWorld } from './canonicalWorldFakes'

/**
 * ADR-DOS-F2.1 — Canonical Enrichment: Player Metadata Foundation.
 * Proves the read-only derived enrichment view folds metadata onto roster ids with honest degradation,
 * preserves the frozen pure world (ids-only, playerMetadataEnriched stays false on the base), and is
 * origin-blind + read-only.
 */
const NOW = new Date('2026-06-30T00:00:00.000Z')
const assemble = (input: ReturnType<typeof makeImportedProviderWorld>): CanonicalWorld =>
  assembleCanonicalWorld(input, { now: NOW })

function meta(ids: string[], opts: { missing?: string[] } = {}): PlayerMetadataResult {
  const missing = new Set(opts.missing ?? [])
  const byId = new Map<string, NormalizedPlayerMetadata>()
  const unresolvedIds: string[] = []
  for (const id of ids) {
    if (missing.has(id)) {
      byId.set(id, { playerId: id, name: null, position: null, team: null, injuryStatus: null, byeWeek: null, projectedPoints: null, projectionConfidence: null, source: null, resolved: false })
      unresolvedIds.push(id)
    } else {
      byId.set(id, { playerId: id, name: `Name ${id}`, position: 'RB', team: 'BUF', injuryStatus: 'Q', byeWeek: null, projectedPoints: null, projectionConfidence: null, source: 'sports_player_cache', resolved: true })
    }
  }
  const warnings: string[] = []
  if (ids.length > 0) {
    if (unresolvedIds.length > 0) warnings.push('player_metadata_missing')
    warnings.push('bye_week_unavailable', 'projection_unavailable')
  }
  return { byId, complete: ids.length > 0 && unresolvedIds.length === 0, unresolvedIds, warnings }
}

const idsOf = (w: CanonicalWorld) => Array.from(new Set(w.rosters.flatMap((r) => r.playerIds)))

describe('F2.1: pure projectEnrichedWorld folds metadata honestly', () => {
  it('full resolution → players enriched, roster flagged enriched, completeness 100', () => {
    const world = assemble(makeImportedProviderWorld())
    const ids = idsOf(world)
    expect(ids.length).toBeGreaterThan(0)
    const enriched = projectEnrichedWorld(world, meta(ids))

    const rosterWithPlayers = enriched.rosters.find((r) => r.players.length > 0)!
    expect(rosterWithPlayers.players.every((p) => p.name && p.position)).toBe(true)
    expect(rosterWithPlayers.playerMetadataEnriched).toBe(true)
    expect(rosterWithPlayers.metadataCompleteness).toBe(100)
    expect(enriched.metadata.completeness).toBe(100)
    expect(enriched.metadata.resolved).toBe(enriched.metadata.requested)
  })

  it('does NOT mutate the frozen base world (ids-only, playerMetadataEnriched stays false)', () => {
    const world = assemble(makeImportedProviderWorld())
    const before = JSON.stringify(world)
    projectEnrichedWorld(world, meta(idsOf(world)))
    expect(JSON.stringify(world)).toBe(before)
    expect(world.rosters.every((r) => r.playerMetadataEnriched === false)).toBe(true)
    expect('players' in (world.rosters[0] ?? {})).toBe(false)
  })

  it('missing metadata → null fields, resolved false, honest warning, NOT enriched', () => {
    const world = assemble(makeImportedProviderWorld())
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids, { missing: [ids[0]] }))
    const target = enriched.rosters.flatMap((r) => r.players).find((p) => p.playerId === ids[0])!
    expect(target.name).toBeNull()
    expect(target.position).toBeNull()
    expect(target.resolved).toBe(false)
    expect(target.eligiblePositions).toEqual([])
    expect(enriched.metadata.warnings).toContain('player_metadata_missing')
    expect(enriched.rosters.find((r) => r.players.some((p) => p.playerId === ids[0]))!.playerMetadataEnriched).toBe(false)
    expect(enriched.metadata.completeness).toBeLessThan(100)
  })

  it('carries provenance (source) + sport, and never fabricates bye/projection', () => {
    const world = assemble(makeImportedProviderWorld())
    const enriched = projectEnrichedWorld(world, meta(idsOf(world)))
    const p = enriched.rosters.flatMap((r) => r.players).find((x) => x.resolved)!
    expect(p.source).toBe('sports_player_cache')
    expect(p.sport).toBe(world.league.sport)
    // byeWeek/projection are not fields on EnrichedPlayer at all — out of scope for F2.1, never invented.
    expect('byeWeek' in p).toBe(false)
    expect('projectedPoints' in p).toBe(false)
  })

  it('eligiblePositions is single-position-derived + flags eligible_positions_degraded', () => {
    const world = assemble(makeImportedProviderWorld())
    const enriched = projectEnrichedWorld(world, meta(idsOf(world)))
    const p = enriched.rosters.flatMap((r) => r.players).find((x) => x.resolved)!
    expect(p.eligiblePositions).toEqual([p.position])
    expect(enriched.metadata.warnings).toContain('eligible_positions_degraded')
  })

  it('preserves world freshness/provenance on the enriched view', () => {
    const world = assemble(makeImportedProviderWorld())
    const enriched = projectEnrichedWorld(world, meta(idsOf(world)))
    expect(enriched.provenance).toEqual(world.provenance)
    expect(enriched.completeness).toEqual(world.completeness)
  })

  it('origin-blind: native and imported produce the SAME enriched shape', () => {
    const imp = projectEnrichedWorld(assemble(makeImportedProviderWorld()), meta(idsOf(assemble(makeImportedProviderWorld()))))
    const nat = projectEnrichedWorld(assemble(makeNativeAfWorld()), meta(idsOf(assemble(makeNativeAfWorld()))))
    const playerKeys = (w: typeof imp) => {
      const p = w.rosters.flatMap((r) => r.players)[0]
      return p ? JSON.stringify(Object.keys(p).sort()) : ''
    }
    const rosterKeys = (w: typeof imp) => JSON.stringify(Object.keys(w.rosters[0]).sort())
    expect(playerKeys(imp)).toBe(playerKeys(nat))
    expect(rosterKeys(imp)).toBe(rosterKeys(nat))
    // No provider leak in the enriched players (provider lives only in provenance).
    expect(JSON.stringify(imp.rosters).toLowerCase()).not.toContain('sleeper')
  })
})

describe('F2.1: resolveEnrichedCanonicalWorld is read-only + never throws', () => {
  const world = assemble(makeImportedProviderWorld())

  it('resolves enriched world via injected read-only deps', async () => {
    const ids = idsOf(world)
    const out = await resolveEnrichedCanonicalWorld('lg', {
      resolveWorld: async () => world,
      resolveMetadata: async () => meta(ids),
    })
    expect(out).not.toBeNull()
    expect(out!.metadata.completeness).toBe(100)
  })

  it('world miss → null', async () => {
    const out = await resolveEnrichedCanonicalWorld('lg', {
      resolveWorld: async () => null,
      resolveMetadata: async () => meta([]),
    })
    expect(out).toBeNull()
  })

  it('metadata resolver throwing → honest unenriched view, never throws', async () => {
    const out = await resolveEnrichedCanonicalWorld('lg', {
      resolveWorld: async () => world,
      resolveMetadata: async () => { throw new Error('cache down') },
    })
    expect(out).not.toBeNull()
    expect(out!.rosters.every((r) => r.players.every((p) => p.resolved === false))).toBe(true)
    expect(out!.metadata.warnings).toContain('player_metadata_source_unavailable')
  })
})

describe('F2.1: architecture — the enrichment module is read-only (no prisma, no writes)', () => {
  it('enrichedWorld.ts imports no prisma and performs no writes', () => {
    // Strip comments so the guard scans CODE, not the doc comment (which legitimately names `prisma`).
    const raw = readFileSync(resolvePath(process.cwd(), 'lib/decision-os/world/enrichedWorld.ts'), 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(src.includes('@/lib/prisma')).toBe(false)
    expect(/\bprisma\./.test(src)).toBe(false)
    expect(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(src)).toBe(false)
  })
})
