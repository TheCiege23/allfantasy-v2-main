import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import { projectEnrichedWorld } from '@/lib/decision-os/world/enrichedWorld'
import {
  deriveAvailabilityCategory,
  projectInjuryContext,
  projectInjuryEnrichedWorld,
  resolveInjuryEnrichedCanonicalWorld,
  type InjuryContextResult,
} from '@/lib/decision-os/world/injuryEnrichedWorld'
import type {
  CanonicalWorld,
  NormalizedPlayerMetadata,
  PlayerMetadataResult,
  RawInjuryContextRow,
} from '@/lib/decision-os/world'
import { makeImportedProviderWorld, makeNativeAfWorld } from './canonicalWorldFakes'

const NOW = new Date('2026-06-30T12:00:00.000Z')
const FUTURE = new Date('2026-07-07T00:00:00.000Z')
const PAST = new Date('2026-06-01T00:00:00.000Z')

const assemble = (input: Parameters<typeof assembleCanonicalWorld>[0]): CanonicalWorld =>
  assembleCanonicalWorld(input, { now: NOW })

function idsOf(world: CanonicalWorld): string[] {
  return Array.from(new Set(world.rosters.flatMap((r) => r.playerIds)))
}

function meta(
  ids: string[],
  opts: { missing?: string[] } = {},
): PlayerMetadataResult {
  const missing = new Set(opts.missing ?? [])
  const byId = new Map<string, NormalizedPlayerMetadata>()
  const unresolvedIds: string[] = []
  for (const id of ids) {
    if (missing.has(id)) {
      byId.set(id, {
        playerId: id,
        name: null,
        position: null,
        team: null,
        injuryStatus: null,
        byeWeek: null,
        projectedPoints: null,
        projectionConfidence: null,
        source: null,
        resolved: false,
      })
      unresolvedIds.push(id)
      continue
    }
    byId.set(id, {
      playerId: id,
      name: `Name ${id}`,
      position: 'RB',
      team: 'BUF',
      injuryStatus: 'Q',
      byeWeek: null,
      projectedPoints: null,
      projectionConfidence: null,
      source: 'sports_player_cache',
      resolved: true,
    })
  }
  return {
    byId,
    complete: ids.length > 0 && unresolvedIds.length === 0,
    unresolvedIds,
    warnings: unresolvedIds.length > 0 ? ['player_metadata_missing'] : [],
  }
}

function injuryRow(id: string, overrides: Partial<RawInjuryContextRow> = {}): RawInjuryContextRow {
  return {
    externalId: id,
    sleeperId: null,
    status: 'Active',
    source: 'sports_player_cache',
    fetchedAt: new Date('2026-06-29T00:00:00.000Z'),
    expiresAt: FUTURE,
    updatedAt: new Date('2026-06-29T00:00:00.000Z'),
    ...overrides,
  }
}

function emptyContextResult(ids: string[]): InjuryContextResult {
  const now = new Date()
  const byId = new Map<string, ReturnType<typeof projectInjuryContext>>()
  for (const id of ids) byId.set(id, projectInjuryContext(null, now))
  return { byId, resolvedCount: 0, unresolvedIds: ids, warnings: [] }
}

// ──────────────────────────────────────────────────────────────────────
describe('F2.3: deriveAvailabilityCategory — deterministic, never AI-generated', () => {
  it('maps known available statuses', () => {
    expect(deriveAvailabilityCategory('Active')).toBe('available')
    expect(deriveAvailabilityCategory('Healthy')).toBe('available')
    expect(deriveAvailabilityCategory('ACT')).toBe('available')
    expect(deriveAvailabilityCategory('active')).toBe('available')
  })

  it('maps known uncertain statuses', () => {
    expect(deriveAvailabilityCategory('Q')).toBe('uncertain')
    expect(deriveAvailabilityCategory('Questionable')).toBe('uncertain')
    expect(deriveAvailabilityCategory('D')).toBe('uncertain')
    expect(deriveAvailabilityCategory('Doubtful')).toBe('uncertain')
  })

  it('maps known unavailable statuses', () => {
    for (const s of ['O', 'Out', 'IR', 'PUP', 'Sus', 'Suspended', 'NA', 'Inactive', 'NFI', 'COV']) {
      expect(deriveAvailabilityCategory(s)).toBe('unavailable')
    }
  })

  it('returns unknown for null or empty string', () => {
    expect(deriveAvailabilityCategory(null)).toBe('unknown')
    expect(deriveAvailabilityCategory('')).toBe('unknown')
    expect(deriveAvailabilityCategory(undefined)).toBe('unknown')
    expect(deriveAvailabilityCategory('   ')).toBe('unknown')
  })

  it('returns unknown for unrecognized non-empty status (no fabrication)', () => {
    expect(deriveAvailabilityCategory('XYZZY')).toBe('unknown')
    expect(deriveAvailabilityCategory('pending')).toBe('unknown')
  })
})

// ──────────────────────────────────────────────────────────────────────
describe('F2.3: projectInjuryContext — pure, no IO', () => {
  it('builds a fully-resolved context from an active row', () => {
    const ctx = projectInjuryContext(injuryRow('p1', { status: 'Active', expiresAt: FUTURE }), NOW)
    expect(ctx.status).toBe('Active')
    expect(ctx.availabilityCategory).toBe('available')
    expect(ctx.resolved).toBe(true)
    expect(ctx.freshness.isStale).toBe(false)
    expect(ctx.freshness.staleReason).toBeNull()
    expect(ctx.provenance.source).toBe('sports_player_cache')
  })

  it('computes isStale=true when expiresAt is in the past', () => {
    const ctx = projectInjuryContext(injuryRow('p1', { status: 'Q', expiresAt: PAST }), NOW)
    expect(ctx.freshness.isStale).toBe(true)
    expect(ctx.freshness.staleReason).toBe('expired')
    expect(ctx.uncertainty).toContain('injury_status_stale')
  })

  it('records freshness_unavailable when expiresAt is null', () => {
    const ctx = projectInjuryContext(injuryRow('p1', { expiresAt: null }), NOW)
    expect(ctx.freshness.isStale).toBeNull()
    expect(ctx.freshness.staleReason).toBe('freshness_unavailable')
    expect(ctx.uncertainty).toContain('injury_freshness_unknown')
    expect(ctx.resolved).toBe(false)
  })

  it('degrades to fully-null unresolved context when row is null', () => {
    const ctx = projectInjuryContext(null, NOW)
    expect(ctx.status).toBeNull()
    expect(ctx.availabilityCategory).toBe('unknown')
    expect(ctx.resolved).toBe(false)
    expect(ctx.freshness.isStale).toBeNull()
    expect(ctx.uncertainty).toContain('injury_status_unavailable')
    expect(ctx.uncertainty).toContain('practice_status_unavailable')
    expect(ctx.uncertainty).toContain('game_status_unavailable')
    expect(ctx.uncertainty).toContain('body_part_unavailable')
    expect(ctx.uncertainty).toContain('injury_description_unavailable')
  })

  it('always carries richer fields as null — no fabrication (P2)', () => {
    const ctx = projectInjuryContext(injuryRow('p1', { status: 'O' }), NOW)
    expect(ctx.practiceStatus).toBeNull()
    expect(ctx.gameStatus).toBeNull()
    expect(ctx.bodyPart).toBeNull()
    expect(ctx.description).toBeNull()
    expect(ctx.uncertainty).toContain('practice_status_unavailable')
    expect(ctx.uncertainty).toContain('game_status_unavailable')
    expect(ctx.uncertainty).toContain('body_part_unavailable')
    expect(ctx.uncertainty).toContain('injury_description_unavailable')
  })

  it('records availability_category_unrecognized for unrecognized non-empty status', () => {
    const ctx = projectInjuryContext(injuryRow('p1', { status: 'XYZZY' }), NOW)
    expect(ctx.availabilityCategory).toBe('unknown')
    expect(ctx.uncertainty).toContain('availability_category_unrecognized')
  })

  it('handles undefined row identically to null', () => {
    const a = projectInjuryContext(null, NOW)
    const b = projectInjuryContext(undefined, NOW)
    expect(a.availabilityCategory).toBe(b.availabilityCategory)
    expect(a.resolved).toBe(b.resolved)
    expect(a.uncertainty).toEqual(b.uncertainty)
  })
})

// ──────────────────────────────────────────────────────────────────────
describe('F2.3: injury/availability view layers additively on F2.1 enriched world', () => {
  it('adds injuryContext to all players without mutating the base enriched world', () => {
    const world = assemble(makeImportedProviderWorld())
    const enriched = projectEnrichedWorld(world, meta(idsOf(world)))
    const before = JSON.stringify(enriched)
    const ids = idsOf(world)
    const contextResult: InjuryContextResult = {
      byId: new Map(ids.map((id) => [id, projectInjuryContext(injuryRow(id), NOW)])),
      resolvedCount: ids.length,
      unresolvedIds: [],
      warnings: [],
    }

    const out = projectInjuryEnrichedWorld(enriched, contextResult)
    expect(JSON.stringify(enriched)).toBe(before)

    const player = out.rosters.flatMap((r) => r.players)[0]!
    expect(player.injuryContext).toBeDefined()
    expect(player.injuryContext.availabilityCategory).toBe('available')
    expect(out.injurySummary.resolvedPlayers).toBe(ids.length)
    expect(out.injurySummary.completeness).toBe(100)
  })

  it('computes per-roster injuryCompleteness honestly', () => {
    const world = assemble(makeImportedProviderWorld())
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const halfIds = ids.slice(0, Math.ceil(ids.length / 2))
    const contextResult: InjuryContextResult = {
      byId: new Map([
        ...halfIds.map((id) => [id, projectInjuryContext(injuryRow(id), NOW)] as const),
        ...ids.slice(halfIds.length).map((id) => [id, projectInjuryContext(null, NOW)] as const),
      ]),
      resolvedCount: halfIds.length,
      unresolvedIds: ids.slice(halfIds.length),
      warnings: [],
    }

    const out = projectInjuryEnrichedWorld(enriched, contextResult)
    expect(out.injurySummary.resolvedPlayers).toBe(halfIds.length)
    expect(out.injurySummary.completeness).toBeGreaterThan(0)
    expect(out.injurySummary.completeness).toBeLessThan(100)
  })

  it('counts unavailable and uncertain players in summary', () => {
    const world = assemble(makeImportedProviderWorld())
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const [id0, id1, ...rest] = ids
    const contextResult: InjuryContextResult = {
      byId: new Map([
        [id0!, projectInjuryContext(injuryRow(id0!, { status: 'O', expiresAt: FUTURE }), NOW)],
        [id1!, projectInjuryContext(injuryRow(id1!, { status: 'Q', expiresAt: FUTURE }), NOW)],
        ...rest.map((id) => [id, projectInjuryContext(null, NOW)] as const),
      ]),
      resolvedCount: 2,
      unresolvedIds: rest,
      warnings: [],
    }

    const out = projectInjuryEnrichedWorld(enriched, contextResult)
    expect(out.injurySummary.unavailablePlayers).toBe(1)
    expect(out.injurySummary.uncertainPlayers).toBe(1)
  })

  it('imported/native output shape is identical — origin-blind', () => {
    const importedWorld = projectEnrichedWorld(assemble(makeImportedProviderWorld()), meta(idsOf(assemble(makeImportedProviderWorld()))))
    const nativeWorld = projectEnrichedWorld(assemble(makeNativeAfWorld()), meta(idsOf(assemble(makeNativeAfWorld()))))

    const makeResult = (ids: string[]): InjuryContextResult => ({
      byId: new Map(ids.map((id) => [id, projectInjuryContext(null, NOW)])),
      resolvedCount: 0,
      unresolvedIds: ids,
      warnings: [],
    })

    const imported = projectInjuryEnrichedWorld(importedWorld, makeResult(importedWorld.rosters.flatMap((r) => r.players.map((p) => p.playerId))))
    const native = projectInjuryEnrichedWorld(nativeWorld, makeResult(nativeWorld.rosters.flatMap((r) => r.players.map((p) => p.playerId))))

    const importedKeys = Object.keys(imported.rosters[0]!.players[0]!).sort()
    const nativeKeys = Object.keys(native.rosters[0]!.players[0]!).sort()
    expect(importedKeys).toEqual(nativeKeys)
    expect(JSON.stringify(imported.rosters).toLowerCase()).not.toContain('sleeper')
  })

  it('degrades honestly when no rows are available — completeness 0, warnings present', () => {
    const world = assemble(makeImportedProviderWorld())
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const out = projectInjuryEnrichedWorld(enriched, emptyContextResult(ids))

    expect(out.injurySummary.completeness).toBe(0)
    expect(out.injurySummary.resolvedPlayers).toBe(0)
    const firstPlayer = out.rosters.flatMap((r) => r.players)[0]!
    expect(firstPlayer.injuryContext.resolved).toBe(false)
    expect(firstPlayer.injuryContext.uncertainty).toContain('injury_status_unavailable')
  })
})

// ──────────────────────────────────────────────────────────────────────
describe('F2.3: resolveInjuryEnrichedCanonicalWorld — read-only, never throws', () => {
  it('resolves via injected deps', async () => {
    const world = assemble(makeImportedProviderWorld())
    const enriched = projectEnrichedWorld(world, meta(idsOf(world)))
    const ids = idsOf(world)

    const out = await resolveInjuryEnrichedCanonicalWorld('lg', {
      resolveEnrichedWorld: async () => enriched,
      resolveInjuryContext: async () => ({
        byId: new Map(ids.map((id) => [id, projectInjuryContext(injuryRow(id), NOW)])),
        resolvedCount: ids.length,
        unresolvedIds: [],
        warnings: [],
      }),
    })

    expect(out).not.toBeNull()
    expect(out!.injurySummary.resolvedPlayers).toBe(ids.length)
    expect(out!.injurySummary.completeness).toBe(100)
  })

  it('returns null when the enriched world is null', async () => {
    const out = await resolveInjuryEnrichedCanonicalWorld('lg', {
      resolveEnrichedWorld: async () => null,
      resolveInjuryContext: async () => ({
        byId: new Map(),
        resolvedCount: 0,
        unresolvedIds: [],
        warnings: [],
      }),
    })
    expect(out).toBeNull()
  })

  it('degrades gracefully when injury resolver throws — never throws, all unresolved', async () => {
    const world = assemble(makeImportedProviderWorld())
    const enriched = projectEnrichedWorld(world, meta(idsOf(world)))

    const out = await resolveInjuryEnrichedCanonicalWorld('lg', {
      resolveEnrichedWorld: async () => enriched,
      resolveInjuryContext: async () => {
        throw new Error('cache unavailable')
      },
    })

    expect(out).not.toBeNull()
    expect(out!.injurySummary.completeness).toBe(0)
    expect(out!.rosters.every((r) => r.players.every((p) => !p.injuryContext.resolved))).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────
describe('F2.3: architecture — injury enrichment file is read-only', () => {
  it('injuryEnrichedWorld.ts imports no prisma and performs no writes', () => {
    const raw = readFileSync(resolvePath(process.cwd(), 'lib/decision-os/world/injuryEnrichedWorld.ts'), 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(src.includes('@/lib/prisma')).toBe(false)
    expect(/\bprisma\./.test(src)).toBe(false)
    expect(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(src)).toBe(false)
  })
})
