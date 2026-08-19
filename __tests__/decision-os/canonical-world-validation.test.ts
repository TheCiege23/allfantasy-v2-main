/**
 * Decision OS — Phase D.2 CANONICAL WORLD VALIDATION.
 *
 * Goal: PROVE the origin-blind fact contract (lib/decision-os/world) holds across the diversity of
 * league configurations AllFantasy supports — BEFORE the trade bridge builds on it. This is a
 * validation slice, not a feature slice: read-only, no production behavior change.
 *
 * The substrate was previously validated mostly against one shape (theciege24's imported Sleeper
 * redraft) plus one native fixture. Here a matrix of realistic configs is fed through ONE shared
 * invariant harness, so the universal contract is asserted identically for every config:
 *   - Imported Sleeper redraft (FAAB)
 *   - Imported Sleeper dynasty + superflex + IDP + TE-premium (taxi)
 *   - Native AllFantasy (stored FAAB)
 *   - Imported priority/rolling waivers (no FAAB)
 * plus commissioner-vs-non-commissioner views, exercised as viewer-blindness.
 *
 * Findings are documented honestly: the per-team `waiverPriority` carry is now CLOSED (it used to drop
 * on the floor); bye week + projections remain null + warned (no provider-id-keyed source — never
 * fabricated). See PHASE_2_CANONICAL_BRIDGE_ARCHITECTURE §2 (`waiver ← canonical`).
 */
import { describe, expect, it } from 'vitest'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import { projectCanonicalLineupInput } from '@/lib/decision-os/lineup/canonicalBridge'
import type { CanonicalWorld, CanonicalWorldRawInput } from '@/lib/decision-os/world/facts'
import {
  IMPORTED_SETTINGS_SNAPSHOT_WITH_PROVIDER_CHROME,
  makeImportedProviderWorld,
  makeImportedSleeperDynastyWorld,
  makeNativeAfWorld,
  makePriorityWaiverWorld,
} from './canonicalWorldFakes'

const NOW = new Date('2025-10-01T12:00:00.000Z')
const assemble = (input: CanonicalWorldRawInput): CanonicalWorld =>
  assembleCanonicalWorld(input, { now: NOW })

interface ConfigCase {
  name: string
  input: CanonicalWorldRawInput
  /** A manager id that maps to a roster — drives the consumer (lineup bridge) read-path invariant. */
  viewerId: string
  /** Imported leagues carry a provider in PROVENANCE; native leagues do not. */
  imported: boolean
}

/** The configuration matrix. Adding a row here automatically runs every universal invariant against it. */
const CONFIGS: ConfigCase[] = [
  {
    name: 'imported sleeper — redraft / FAAB / commissioner',
    input: makeImportedProviderWorld(),
    viewerId: 'af-user-777',
    imported: true,
  },
  {
    name: 'imported sleeper — dynasty / superflex / IDP / TE-premium / taxi',
    input: makeImportedSleeperDynastyWorld(),
    viewerId: 'af-user-aaa',
    imported: true,
  },
  {
    name: 'native allfantasy — stored FAAB',
    input: makeNativeAfWorld(),
    viewerId: 'af-user-001',
    imported: false,
  },
  {
    name: 'imported sleeper — priority (rolling) waivers / no FAAB',
    input: makePriorityWaiverWorld(),
    viewerId: 'af-user-p1',
    imported: true,
  },
]

// ──────────────────────────────────────────────────────────────────────────
// Universal invariants — the SAME contract must hold for EVERY config.
// ──────────────────────────────────────────────────────────────────────────

describe('Phase D.2 — Canonical World contract holds across all league configs', () => {
  // (1) Structural origin-blindness: identical fact KEY shape regardless of origin/config.
  it('(1) every config produces the IDENTICAL fact key shape (origin-blind structure)', () => {
    const shapeOf = (w: CanonicalWorld) => ({
      league: Object.keys(w.league).sort(),
      team: Object.keys(w.teams[0]).sort(),
      roster: Object.keys(w.rosters[0]).sort(),
    })
    const reference = shapeOf(assemble(CONFIGS[0].input))
    for (const cfg of CONFIGS) {
      const shape = shapeOf(assemble(cfg.input))
      expect(shape.league, `${cfg.name} — league keys`).toEqual(reference.league)
      expect(shape.team, `${cfg.name} — team keys`).toEqual(reference.team)
      expect(shape.roster, `${cfg.name} — roster keys`).toEqual(reference.roster)
    }
  })

  for (const cfg of CONFIGS) {
    describe(cfg.name, () => {
      const world = assemble(cfg.input)

      // (2) No origin leakage into the core facts: the provider name + source league id live ONLY in
      //     provenance, never inside league or roster facts. (Team facts legitimately carry a provenance-
      //     typed manager id — that boundary matches the substrate contract, so teams are excluded.)
      it('(2) provider identity does not leak into league/roster facts', () => {
        const provider = cfg.input.league.platform
        const srcLeagueId = cfg.input.league.platformLeagueId
        const leagueJson = JSON.stringify(world.league)
        const rostersJson = JSON.stringify(world.rosters)
        if (provider) {
          expect(leagueJson).not.toContain(provider)
          expect(rostersJson).not.toContain(provider)
          expect(world.provenance.provider).toBe(provider) // origin survives here, by design
        } else {
          expect(world.provenance.provider).toBeNull()
        }
        if (srcLeagueId) {
          expect(leagueJson).not.toContain(srcLeagueId)
          expect(rostersJson).not.toContain(srcLeagueId)
        }
      })

      // (3) Honest completeness: bounded score, array gaps, and assembly never throws.
      it('(3) completeness is honest and bounded; assembly never throws', () => {
        expect(() => assemble(cfg.input)).not.toThrow()
        expect(world.completeness.dataCompleteness).toBeGreaterThanOrEqual(0)
        expect(world.completeness.dataCompleteness).toBeLessThanOrEqual(100)
        expect(Array.isArray(world.completeness.warnings)).toBe(true)
        expect(Array.isArray(world.completeness.unsupported)).toBe(true)
      })

      // (4) No fabrication: derived facts are either honestly null or provably real.
      it('(4) FAAB / points-against / enrichment are never fabricated', () => {
        for (const team of world.teams) {
          // FAAB remaining is null or a number; a DERIVED remaining must have both budget AND used.
          expect(team.faab.remaining === null || typeof team.faab.remaining === 'number').toBe(true)
          if (team.faab.remainingDerived) {
            expect(team.faab.budget).not.toBeNull()
            expect(team.faab.used).not.toBeNull()
          }
          // Points-against: null ⇒ basis 'unavailable'; a value ⇒ a real basis (never invented).
          if (team.pointsAgainst === null) {
            expect(team.pointsAgainstBasis).toBe('unavailable')
          } else {
            expect(['stored', 'derived_from_performances']).toContain(team.pointsAgainstBasis)
          }
        }
        // Substrate never claims enrichment it did not do.
        for (const roster of world.rosters) {
          expect(roster.playerMetadataEnriched).toBe(false)
        }
      })

      // (5) Provenance fidelity: origin recorded as metadata; assembledAt is an ISO instant; the read
      //     models reflect the rows actually present.
      it('(5) provenance records origin + read models faithfully', () => {
        expect(world.provenance.provider).toBe(cfg.imported ? cfg.input.league.platform : null)
        expect(world.provenance.assembledAt).toBe(NOW.toISOString())
        expect(world.provenance.sourceModels).toContain('League')
        expect(world.provenance.sourceModels).toContain('LeagueTeam')
        expect(world.provenance.sourceModels).toContain('Roster')
        expect(world.provenance.sourceModels).toContain('TeamPerformance')
      })

      // (6) Consumer read path holds: the pure lineup bridge projects EVERY config without throwing and
      //     degrades honestly (substrate has no enrichment → scanIncomplete, null projection confidence).
      it('(6) the lineup bridge projects this config honestly (no throw, honest degradation)', () => {
        let res!: ReturnType<typeof projectCanonicalLineupInput>
        expect(() => {
          res = projectCanonicalLineupInput(world, cfg.viewerId, world.league.leagueId)
        }).not.toThrow()
        expect(res.source).toBe('canonical_world')
        expect(res.input).not.toBeNull()
        expect(res.input!.scanIncomplete).toBe(true) // no metadata enrichment at the substrate level
        expect(res.input!.projectionConfidence).toBeNull() // never fabricated

        const team = world.teams.find((t) => t.managerUserId === cfg.viewerId)!
        const roster = world.rosters.find((r) => r.teamId === team.teamId)!
        expect(res.input!.players.length).toBe(roster.playerCount)
        // Starters are honestly marked STARTER (the substrate knows membership, not the specific slot).
        for (const starterId of roster.starterIds) {
          expect(res.input!.players.find((p) => p.playerId === starterId)?.slotType).toBe('STARTER')
        }
      })
    })
  }
})

// ──────────────────────────────────────────────────────────────────────────
// Per-config distinctive behavior — each config's defining dimension is correct.
// ──────────────────────────────────────────────────────────────────────────

describe('Phase D.2 — per-config distinctive facts', () => {
  it('imported redraft: not dynasty, FAAB league, commissioner flagged', () => {
    const world = assemble(makeImportedProviderWorld())
    expect(world.league.isDynasty).toBe(false)
    expect(world.league.leagueType).toBe('redraft')
    expect(world.league.waiverSettings.type).toBe('faab')
    expect(world.teams.find((t) => t.teamId === 'team-A')!.isCommissioner).toBe(true)
  })

  it('dynasty/superflex/IDP/TEP: dynasty + taxi carried, superflex & IDP slots survive, TEP opaque', () => {
    const world = assemble(makeImportedSleeperDynastyWorld())
    expect(world.league.isDynasty).toBe(true)
    expect(world.league.rosterSettings.taxiSlots).toBe(4)

    // Superflex + IDP starter slots survive as raw strings (no position branching in the substrate).
    const slots = world.league.rosterSettings.starterSlots ?? []
    expect(slots).toContain('SUPER_FLEX')
    expect(slots).toEqual(expect.arrayContaining(['DL', 'LB', 'DB']))

    // Taxi stash projected from playerData.taxi.
    const roster = world.rosters.find((r) => r.rosterId === 'droster-row-A')!
    expect(roster.taxiIds).toEqual(['taxi-1', 'taxi-2'])
    // IDP players are real roster members + starters.
    expect(roster.starterIds).toEqual(expect.arrayContaining(['idp-dl-1', 'idp-lb-1', 'idp-db-1']))

    // TE-premium scoring rides through OPAQUE — preserved verbatim, never interpreted by the substrate.
    expect(world.league.scoringSettings).toEqual({ scoring_settings: { rec: 1, bonus_rec_te: 0.5 } })
  })

  it('native AF: no provider, stored FAAB remaining, points-against basis "stored"', () => {
    const world = assemble(makeNativeAfWorld())
    expect(world.provenance.provider).toBeNull()
    const team = world.teams[0]
    expect(team.faab.remaining).toBe(73)
    expect(team.faab.remainingDerived).toBe(false)
    expect(team.pointsAgainstBasis).toBe('stored')
  })

  it('priority waivers: FAAB degrades honestly to null + warning (never fabricated)', () => {
    const world = assemble(makePriorityWaiverWorld())
    expect(world.league.waiverSettings.type).toBe('priority')
    expect(world.league.waiverSettings.budget).toBeNull()
    const team = world.teams[0]
    expect(team.faab.remaining).toBeNull()
    expect(team.faab.remainingDerived).toBe(false)
    expect(world.completeness.warnings.some((w) => w.startsWith('faab_remaining_unavailable'))).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Commissioner vs non-commissioner: the WORLD is viewer-blind (commissioner status is a fact, not a
// view). Viewer scoping is a downstream BRIDGE concern, never a substrate concern.
// ──────────────────────────────────────────────────────────────────────────

describe('Phase D.2 — commissioner status is an origin-blind, viewer-independent fact', () => {
  it('assembling the same league is deterministic and takes NO viewer input', () => {
    const input = makeImportedProviderWorld()
    // There is no viewer parameter to assembleCanonicalWorld — proven by two identical assemblies.
    expect(assemble(input)).toEqual(assemble(input))
  })

  it('commissioner / co-commissioner / member are distinct, correctly-set facts', () => {
    const redraft = assemble(makeImportedProviderWorld())
    const commish = redraft.teams.find((t) => t.teamId === 'team-A')!
    const member = redraft.teams.find((t) => t.teamId === 'team-B')!
    expect(commish.isCommissioner).toBe(true)
    expect(commish.isCoCommissioner).toBe(false)
    expect(member.isCommissioner).toBe(false)
    expect(member.isCoCommissioner).toBe(false)

    // Co-commissioner is a distinct flag, surfaced independently of the primary commissioner.
    const dynasty = assemble(makeImportedSleeperDynastyWorld())
    const coCommish = dynasty.teams.find((t) => t.teamId === 'dteam-B')!
    expect(coCommish.isCommissioner).toBe(false)
    expect(coCommish.isCoCommissioner).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Documented findings — what D.2 surfaced and how it was disposed of.
// ──────────────────────────────────────────────────────────────────────────

describe('Phase D.2 — documented substrate findings', () => {
  // FINDING (CLOSED): per-team waiver order was loaded by the port but dropped before reaching the
  // facts. It is now carried honestly on RosterFacts (1-line carry, no business logic) — the waiver
  // bridge consumes it (`waiver ← canonical`).
  it('CLOSED: per-team waiverPriority is now carried onto roster facts', () => {
    const priority = assemble(makePriorityWaiverWorld())
    expect(priority.rosters[0].waiverPriority).toBe(3)

    // FAAB leagues leave it null (no priority order) — still surfaced, never invented.
    const faab = assemble(makeImportedProviderWorld())
    expect(faab.rosters.every((r) => r.waiverPriority === null)).toBe(true)
  })

  // FINDING (DOCUMENTED, unchanged): bye week + projections have NO provider-id-keyed source, so the
  // substrate/bridge leave them null and never fabricate. This is the honest gap the trade/lineup
  // bridges must degrade around — asserted here so the contract stays explicit, not silently assumed.
  it('DOCUMENTED: bye week + projection confidence remain honestly null (never fabricated)', () => {
    const world = assemble(makeImportedSleeperDynastyWorld())
    const res = projectCanonicalLineupInput(world, 'af-user-aaa', world.league.leagueId)
    expect(res.input).not.toBeNull()
    expect(res.input!.projectionConfidence).toBeNull()
    expect(res.input!.players.every((p) => p.byeWeek === null)).toBe(true)
  })

  // FINDING F0-1 (CLOSED): a REAL imported settings snapshot carries league chrome + provenance whose
  // strings include the provider name (a `sleepercdn.com` logo URL, `scoringSettings.source`, etc.).
  // The opaque pass-through used to leak those into `world.league.scoringSettings`. The narrowing now
  // surfaces ONLY scoring config — proven here against the realistic chrome-laden blob. See ADR §10.
  it('CLOSED (F0-1): a provider-branded settings blob does NOT leak into league facts', () => {
    const input = makeImportedProviderWorld({
      league: {
        ...makeImportedProviderWorld().league,
        settings: IMPORTED_SETTINGS_SNAPSHOT_WITH_PROVIDER_CHROME as unknown as Record<string, unknown>,
      },
    })
    const world = assemble(input)

    // No provider string (nor the leaking logo URL host) survives anywhere in the league facts.
    const leagueJson = JSON.stringify(world.league)
    expect(leagueJson).not.toContain('sleeper')
    expect(leagueJson).not.toContain('sleepercdn.com')

    // The genuine scoring config IS preserved (origin-blind), with provenance (`source`) stripped.
    const scoring = world.league.scoringSettings as Record<string, unknown>
    expect(scoring).not.toBeNull()
    expect(scoring.scoring_settings).toEqual({ rec: 1, rec_yd: 0.1, bonus_rec_te: 0.5 })
    expect(scoring.scoring).toBe('PPR TEP')
    const slice = scoring.scoringSettings as Record<string, unknown>
    expect(slice.rules).toEqual({ rec: 1, rec_yd: 0.1, bonus_rec_te: 0.5 })
    expect(slice.format).toBe('custom')
    expect(slice.scoringTemplateId).toBe('fb_half_ppr')
    expect('source' in slice).toBe(false) // provenance dropped

    // Chrome never rides through: no logo/visualTheme/avatar/name/leagueSize keys on the scoring facts.
    expect('visualTheme' in scoring).toBe(false)
    expect('mediaSettings' in scoring).toBe(false)
    expect('avatar' in scoring).toBe(false)
    expect('name' in scoring).toBe(false)
    expect('leagueSize' in scoring).toBe(false)
    expect('conceptRules' in scoring).toBe(false)
    expect('identity_mappings' in scoring).toBe(false)
  })
})
