import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import type { CanonicalWorld } from '@/lib/decision-os/world'
import {
  projectCanonicalLineupInput,
  resolveCanonicalLineupInputs,
} from '@/lib/decision-os/lineup/canonicalBridge'
import { makeImportedProviderWorld, makeNativeAfWorld } from './canonicalWorldFakes'

/**
 * Phase D — Lineup Bridge Shadow via Canonical World.
 *
 * Proves the read-only projection of canonical roster facts into the `manager.lineup.set` input shape:
 * imported/native leagues are supported, player metadata is degraded honestly (never fabricated), and
 * the source tag stays provenance-only. Also asserts the loader's identity resolver was swapped to the
 * guaranteed write-free variant (the shadow path must never transitively write).
 */
const NOW = new Date('2025-10-01T12:00:00.000Z')

const importedWorld = (overrides?: Parameters<typeof makeImportedProviderWorld>[0]): CanonicalWorld =>
  assembleCanonicalWorld(makeImportedProviderWorld(overrides), { now: NOW })

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('Phase D — loader uses the write-free identity resolver (no transitive writes)', () => {
  it('(1) loader.ts imports the read-only resolver and NEVER references the write-capable one', () => {
    const src = stripComments(
      readFileSync(resolve(process.cwd(), 'lib/decision-os/lineup/loader.ts'), 'utf8'),
    )
    expect(src.includes('resolveRedraftRosterLookupReadOnly')).toBe(true)
    // Negative-lookahead: the write-capable symbol (which performs owner repair) must be absent.
    expect(/resolveRedraftRosterLookup(?!ReadOnly)/.test(src)).toBe(false)
  })
})

describe('Phase D — projectCanonicalLineupInput (pure, read-only, origin-blind)', () => {
  it('(2) projects an IMPORTED league roster into the lineup input shape', () => {
    const res = projectCanonicalLineupInput(importedWorld(), 'af-user-777', 'lg-import-1')

    expect(res.source).toBe('canonical_world')
    expect(res.input).not.toBeNull()
    const input = res.input!
    expect(input.leagueId).toBe('lg-import-1')
    expect(input.userId).toBe('af-user-777')
    expect(input.rosterId).toBe('roster-row-A')
    expect(input.sport).toBe('NFL')
    // 4 real players (the "0" placeholder was dropped upstream by the substrate).
    expect(input.players.map((p) => p.playerId)).toEqual(['4046', '6794', '4035', '2133'])
    // Starters → STARTER, reserve(IR) → IR; bench/taxi absent here.
    expect(input.players.filter((p) => p.slotType === 'STARTER').map((p) => p.playerId)).toEqual([
      '4046',
      '6794',
      '4035',
    ])
    expect(input.players.find((p) => p.playerId === '2133')!.slotType).toBe('IR')
  })

  it('(3) degrades player metadata honestly — never fabricates name/position/injury/projection', () => {
    const res = projectCanonicalLineupInput(importedWorld(), 'af-user-777', 'lg-import-1')
    const input = res.input!

    for (const p of input.players) {
      expect(p.playerName).toBe('') // blank, not invented
      expect(p.position).toBe('') // blank, not invented
      expect(p.injuryStatus).toBeNull() // never fabricated
      expect(p.byeWeek).toBeNull()
    }
    expect(input.projectionConfidence).toBeNull()
    expect(input.scanIncomplete).toBe(true)
    expect(res.warnings).toContain('player_metadata_missing')
  })

  it('(4) maps every slot category: STARTER / BENCH / IR / TAXI', () => {
    const raw = makeImportedProviderWorld()
    raw.rosters[0].playerData = {
      ...(raw.rosters[0].playerData as object),
      players: ['s1', 'b1', 'r1', 't1'],
      starters: ['s1'],
      reserve: ['r1'],
      taxi: ['t1'],
    }
    const world = assembleCanonicalWorld(raw, { now: NOW })

    const input = projectCanonicalLineupInput(world, 'af-user-777', 'lg-import-1').input!
    const slot = (id: string) => input.players.find((p) => p.playerId === id)!.slotType
    expect(slot('s1')).toBe('STARTER')
    expect(slot('b1')).toBe('BENCH')
    expect(slot('r1')).toBe('IR')
    expect(slot('t1')).toBe('TAXI')
  })

  it('(5) carries the current week + reuses the same league.settings blob the native path passes', () => {
    const res = projectCanonicalLineupInput(importedWorld(), 'af-user-777', 'lg-import-1')
    const input = res.input!
    expect(input.leagueWeek).toBe(2) // derived from latest TeamPerformance (weeks 1,2)
    expect(input.editingWeek).toBe(2)
    expect(input.leagueSettings).toEqual({ scoring_settings: { rec: 1 } })
  })

  it('(6) supports a NATIVE AllFantasy league identically (origin-blind)', () => {
    const native = assembleCanonicalWorld(makeNativeAfWorld(), { now: NOW })
    const res = projectCanonicalLineupInput(native, 'af-user-001', 'lg-native-1')

    expect(res.source).toBe('canonical_world')
    const input = res.input!
    expect(input.rosterId).toBe('nroster-A')
    expect(input.players.map((p) => p.playerId)).toEqual(['p1', 'p2', 'p3', 'p4'])
    // p1,p2 starters; p3,p4 bench.
    expect(input.players.filter((p) => p.slotType === 'STARTER').map((p) => p.playerId)).toEqual(['p1', 'p2'])
    expect(input.players.filter((p) => p.slotType === 'BENCH').map((p) => p.playerId)).toEqual(['p3', 'p4'])
  })

  it('(7) returns canonical_world_unavailable when the viewer is not a manager in this league', () => {
    const res = projectCanonicalLineupInput(importedWorld(), 'nobody-here', 'lg-import-1')
    expect(res.input).toBeNull()
    expect(res.source).toBe('canonical_world_unavailable')
    expect(res.warnings).toContain('roster_not_resolved')
  })

  it("(8) returns canonical_world_unavailable when the viewer's roster has no players", () => {
    const raw = makeImportedProviderWorld()
    raw.rosters[0].playerData = {
      ...(raw.rosters[0].playerData as object),
      players: [],
      starters: [],
      reserve: [],
      taxi: [],
    }
    const world = assembleCanonicalWorld(raw, { now: NOW })

    const res = projectCanonicalLineupInput(world, 'af-user-777', 'lg-import-1')
    expect(res.input).toBeNull()
    expect(res.source).toBe('canonical_world_unavailable')
    expect(res.warnings).toEqual(expect.arrayContaining(['roster_empty', 'inputs_unavailable']))
  })
})

describe('Phase D — resolveCanonicalLineupInputs (read-only, never throws)', () => {
  it('(9) delegates to the projector when the world resolves', async () => {
    const resolveWorld = vi.fn(async () => importedWorld())
    const res = await resolveCanonicalLineupInputs('af-user-777', 'lg-import-1', { resolveWorld })
    expect(resolveWorld).toHaveBeenCalledWith('lg-import-1')
    expect(res.source).toBe('canonical_world')
    expect(res.input?.rosterId).toBe('roster-row-A')
  })

  it('(10) degrades to canonical_world_unavailable when the world is missing OR the resolver throws', async () => {
    const missing = await resolveCanonicalLineupInputs('u', 'lg', { resolveWorld: async () => null })
    expect(missing.input).toBeNull()
    expect(missing.source).toBe('canonical_world_unavailable')
    expect(missing.warnings).toContain('canonical_world_unavailable')

    const threw = await resolveCanonicalLineupInputs('u', 'lg', {
      resolveWorld: async () => {
        throw new Error('db down')
      },
    })
    expect(threw.input).toBeNull()
    expect(threw.source).toBe('canonical_world_unavailable')
    expect(threw.warnings).toContain('canonical_world_error')
  })
})
