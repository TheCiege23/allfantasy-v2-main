/**
 * Decision OS — Canonical World NATIVE REDRAFT COVERAGE.
 *
 * Proves the ADR decision (lib/decision-os/ADR_CANONICAL_WORLD_REDRAFT_COVERAGE.md, Option A): the
 * substrate now resolves native AF redraft leagues whose players live in `RedraftRoster` /
 * `RedraftRosterPlayer` — not only those in `Roster.playerData` — by projecting both into the SAME
 * origin-blind `RawRosterRow` shape. Read-only and additive; the pure assembler is unchanged.
 *
 * Maps the ticket's required proofs 1–8 (proof 9 is the real-DB conformance script, run separately):
 *   (1) still resolves Roster.playerData            (5) redraft slot types map correctly
 *   (2) resolves RedraftRosterPlayer when Roster ∅  (6) no redraft-only metadata leaks into facts
 *   (3) both → identical RawRosterRow / RosterFacts (7) no writes occur (structural + injected port)
 *   (4) canonical Roster wins on owner conflict     (8) assembler stays provider/origin-blind
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import { projectRosterSlots } from '@/lib/decision-os/world/derive'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import {
  mapRedraftRosterRowToRawRoster,
  normalizeRedraftWaiverPriority,
  projectRedraftRosterPlayerData,
  unionRosterRows,
  type RawRedraftRosterRow,
} from '@/lib/decision-os/world/redraftRoster'
import type {
  CanonicalWorldPort,
  CanonicalWorldRawInput,
  RawRosterRow,
} from '@/lib/decision-os/world/facts'
import { makeNativeAfWorld } from './canonicalWorldFakes'

const NOW = new Date('2025-10-01T12:00:00.000Z')
const assemble = (input: CanonicalWorldRawInput) => assembleCanonicalWorld(input, { now: NOW })

/** A representative RedraftRoster row exercising every slotType bucket; owner joins native fixture team. */
const REDRAFT_ROW: RawRedraftRosterRow = {
  id: 'rdr-A',
  ownerId: 'af-user-001', // matches makeNativeAfWorld nteam-A platformUserId / claimedByUserId
  faabBalance: 55,
  waiverPriority: 2,
  players: [
    { playerId: 'p1', slotType: 'QB' }, // position token → starter
    { playerId: 'p2', slotType: 'starter' }, // literal → starter
    { playerId: 'p3', slotType: 'BENCH' }, // → bench (derived downstream)
    { playerId: 'p4', slotType: 'BN' }, // → bench (derived downstream)
    { playerId: 'p5', slotType: 'IR' }, // → reserve
    { playerId: 'p6', slotType: 'RESERVE' }, // → reserve
    { playerId: 'p7', slotType: 'TAXI' }, // → taxi
    { playerId: 'p8', slotType: 'DEVY' }, // → taxi
  ],
}

/** A native redraft league input: same league/teams/performances as the native fixture, redraft-sourced rosters. */
function makeRedraftSourcedInput(): CanonicalWorldRawInput {
  const base = makeNativeAfWorld()
  return { ...base, rosters: [mapRedraftRosterRowToRawRoster(REDRAFT_ROW)] }
}

// ──────────────────────────────────────────────────────────────────────────
// Pure projection — the deterministic mapping (no IO).
// ──────────────────────────────────────────────────────────────────────────

describe('redraft roster projection — pure mapping', () => {
  it('(5) projects slotType into starters/reserve/taxi; bench derives downstream', () => {
    const blob = projectRedraftRosterPlayerData(REDRAFT_ROW.players)
    expect(blob.players).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'])
    expect(blob.starters).toEqual(['p1', 'p2'])
    expect(blob.reserve).toEqual(['p5', 'p6'])
    expect(blob.taxi).toEqual(['p7', 'p8'])
    // The blob is the canonical playerData shape, so the EXISTING projector derives bench identically.
    const projected = projectRosterSlots(blob)
    expect(projected.bench).toEqual(['p3', 'p4']) // BENCH/BN → bench by derivation, not invented
    expect(projected.starters).toEqual(['p1', 'p2'])
    expect(projected.reserve).toEqual(['p5', 'p6'])
    expect(projected.taxi).toEqual(['p7', 'p8'])
  })

  it('(5) slot matching is case-insensitive and drops empty player ids', () => {
    const blob = projectRedraftRosterPlayerData([
      { playerId: 'a', slotType: 'ir' },
      { playerId: 'b', slotType: 'Taxi' },
      { playerId: 'c', slotType: 'bn' },
      { playerId: '  ', slotType: 'QB' }, // empty after trim → dropped
      { playerId: 'd', slotType: null }, // unknown slot → starter
    ])
    expect(blob.players).toEqual(['a', 'b', 'c', 'd'])
    expect(blob.reserve).toEqual(['a'])
    expect(blob.taxi).toEqual(['b'])
    expect(blob.starters).toEqual(['d'])
  })

  it('normalizes waiverPriority: 0/default ⇒ null (unset), >0 carries, never invents', () => {
    expect(normalizeRedraftWaiverPriority(0)).toBeNull()
    expect(normalizeRedraftWaiverPriority(3)).toBe(3)
    expect(normalizeRedraftWaiverPriority(null)).toBeNull()
    expect(normalizeRedraftWaiverPriority(-1)).toBeNull()
  })

  it('maps RedraftRoster → RawRosterRow (owner→platformUserId, faabBalance, sourceModel tag)', () => {
    const row = mapRedraftRosterRowToRawRoster(REDRAFT_ROW)
    expect(row.id).toBe('rdr-A')
    expect(row.platformUserId).toBe('af-user-001')
    expect(row.faabRemaining).toBe(55)
    expect(row.waiverPriority).toBe(2)
    expect(row.settings).toBeNull()
    expect(row.sourceModel).toBe('RedraftRoster')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Deduplication — canonical Roster wins on owner conflict; redraft fills gaps.
// ──────────────────────────────────────────────────────────────────────────

describe('(4) roster union — canonical Roster wins on owner conflict', () => {
  const canonicalX: RawRosterRow = {
    id: 'canon-X',
    platformUserId: 'owner-X',
    playerData: { players: ['a'] },
    faabRemaining: 10,
    waiverPriority: null,
    settings: null,
    sourceModel: 'Roster',
  }
  const redraftX = mapRedraftRosterRowToRawRoster({
    id: 'redraft-X',
    ownerId: 'owner-X', // same owner as canonicalX → must be dropped
    faabBalance: 5,
    waiverPriority: 0,
    players: [{ playerId: 'z', slotType: 'QB' }],
  })
  const redraftY = mapRedraftRosterRowToRawRoster({
    id: 'redraft-Y',
    ownerId: 'owner-Y', // no canonical roster → fills the gap
    faabBalance: 5,
    waiverPriority: 1,
    players: [{ playerId: 'w', slotType: 'QB' }],
  })

  it('drops the redraft roster whose owner already has a canonical roster, keeps gap-fillers', () => {
    const unioned = unionRosterRows([canonicalX], [redraftX, redraftY])
    expect(unioned.map((r) => r.id)).toEqual(['canon-X', 'redraft-Y'])
    // The surviving owner-X roster is the CANONICAL one (faab 10), not the redraft one (faab 5).
    expect(unioned.find((r) => r.platformUserId === 'owner-X')!.faabRemaining).toBe(10)
  })

  it('keeps redraft rosters with empty owner ids (never collapses distinct rosters on "")', () => {
    const redraftNoOwner = mapRedraftRosterRowToRawRoster({
      id: 'redraft-blank',
      ownerId: null,
      faabBalance: null,
      waiverPriority: 0,
      players: [{ playerId: 'q', slotType: 'QB' }],
    })
    const unioned = unionRosterRows([canonicalX], [redraftNoOwner])
    expect(unioned.map((r) => r.id)).toEqual(['canon-X', 'redraft-blank'])
  })
})

// ──────────────────────────────────────────────────────────────────────────
// End-to-end assembly — origin-blind facts from a redraft-sourced league.
// ──────────────────────────────────────────────────────────────────────────

describe('canonical world — redraft-sourced league assembly', () => {
  it('(2) resolves rosters from RedraftRosterPlayer when there is no Roster.playerData', () => {
    const world = assemble(makeRedraftSourcedInput())
    const roster = world.rosters[0]
    expect(roster.playerCount).toBe(8)
    expect(roster.playerIds).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'])
    expect(roster.starterIds).toEqual(['p1', 'p2'])
    expect(roster.benchIds).toEqual(['p3', 'p4'])
    expect(roster.reserveIds).toEqual(['p5', 'p6'])
    expect(roster.taxiIds).toEqual(['p7', 'p8'])
    expect(roster.waiverPriority).toBe(2)
    // Joined to the native team via owner id (write-free matchTeamIdForRoster, no owner repair).
    expect(roster.teamId).toBe('nteam-A')
    // FAAB carried from RedraftRoster.faabBalance as a stored remaining (not derived, not fabricated).
    expect(world.teams[0].faab.remaining).toBe(55)
    expect(world.teams[0].faab.remainingDerived).toBe(false)
  })

  it('(5) provenance honestly reports RedraftRoster + RedraftRosterPlayer, not Roster', () => {
    const world = assemble(makeRedraftSourcedInput())
    expect(world.provenance.sourceModels).toEqual([
      'League',
      'LeagueTeam',
      'RedraftRoster',
      'RedraftRosterPlayer',
      'TeamPerformance',
    ])
    expect(world.provenance.sourceModels).not.toContain('Roster')
  })

  it('(3) redraft-sourced RosterFacts has the IDENTICAL key shape as Roster-sourced', () => {
    const redraftFacts = assemble(makeRedraftSourcedInput()).rosters[0]
    const canonicalFacts = assemble(makeNativeAfWorld()).rosters[0]
    expect(Object.keys(redraftFacts).sort()).toEqual(Object.keys(canonicalFacts).sort())
  })

  it('(6) no redraft-only metadata (position/injury/bye/team/slotType) leaks into roster facts', () => {
    const world = assemble(makeRedraftSourcedInput())
    const roster = world.rosters[0]
    expect(roster.playerMetadataEnriched).toBe(false)
    const json = JSON.stringify(roster)
    for (const token of ['position', 'injuryStatus', 'byeWeek', 'slotType', 'RedraftRoster']) {
      expect(json).not.toContain(token)
    }
    // Roster facts carry raw ids only — never enriched player objects.
    expect(roster.playerIds.every((id) => typeof id === 'string')).toBe(true)
  })

  it('(8) the assembler is origin-blind: identical logical content ⇒ identical facts regardless of source', () => {
    // Same players/slots expressed as a canonical Roster blob vs redraft rows must assemble identically.
    const canonicalEquivalent: RawRosterRow = {
      id: 'rdr-A',
      platformUserId: 'af-user-001',
      playerData: {
        players: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
        starters: ['p1', 'p2'],
        reserve: ['p5', 'p6'],
        taxi: ['p7', 'p8'],
      },
      faabRemaining: 55,
      waiverPriority: 2,
      settings: null,
      sourceModel: 'Roster',
    }
    const fromRoster = assemble({ ...makeNativeAfWorld(), rosters: [canonicalEquivalent] }).rosters[0]
    const fromRedraft = assemble(makeRedraftSourcedInput()).rosters[0]
    // Facts are byte-identical (sourceModel is provenance only and never reaches RosterFacts).
    expect(fromRedraft).toEqual(fromRoster)
  })

  it('(8) provider/origin identity never leaks into the redraft-sourced facts', () => {
    const world = assemble(makeRedraftSourcedInput())
    expect(world.provenance.provider).toBeNull() // native league
    expect(JSON.stringify(world.league)).not.toContain('RedraftRoster')
    expect(JSON.stringify(world.rosters)).not.toContain('RedraftRoster')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Regression + read-only safety.
// ──────────────────────────────────────────────────────────────────────────

describe('canonical world — read-only safety & Roster.playerData regression', () => {
  it('(1) still resolves Roster.playerData with provenance Roster (no RedraftRoster)', () => {
    const world = assemble(makeNativeAfWorld())
    expect(world.rosters[0].playerIds.length).toBe(4)
    expect(world.provenance.sourceModels).toContain('Roster')
    expect(world.provenance.sourceModels).not.toContain('RedraftRoster')
  })

  it('(7) resolveCanonicalWorld calls ONLY read methods (redraft rows flow through unchanged)', async () => {
    const input = makeRedraftSourcedInput()
    const port: CanonicalWorldPort = {
      loadLeague: vi.fn(async () => input.league),
      loadTeams: vi.fn(async () => input.teams),
      loadRosters: vi.fn(async () => input.rosters), // redraft-sourced RawRosterRows
      loadPerformances: vi.fn(async () => input.performances),
    }
    const world = await resolveCanonicalWorld('lg-native-1', { port, now: NOW })
    expect(world).not.toBeNull()
    expect(world!.rosters[0].playerIds).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'])
    // The port surface exposes ONLY read methods — there is no write method to call.
    expect(Object.keys(port).sort()).toEqual(['loadLeague', 'loadPerformances', 'loadRosters', 'loadTeams'])
  })

  it('(7) the redraft read path contains NO write surface and never calls owner-repair', () => {
    const portSrc = readFileSync(join(process.cwd(), 'lib/decision-os/world/port.ts'), 'utf8')
    const redraftSrc = readFileSync(join(process.cwd(), 'lib/decision-os/world/redraftRoster.ts'), 'utf8')
    for (const src of [portSrc, redraftSrc]) {
      // No prisma write methods anywhere in the substrate read path.
      expect(src).not.toMatch(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/)
      // Must never CALL the write-prone legacy owner-repair resolver. (The port's doc comment names it
      // to document the path it deliberately avoids, so match a call `(` — not a bare mention.)
      expect(src).not.toMatch(/resolveRedraftRosterLookup\s*\(/)
    }
    // The pure projection module imports no prisma at all (read-only is structural).
    expect(redraftSrc).not.toContain("from '@/lib/prisma'")
  })
})
