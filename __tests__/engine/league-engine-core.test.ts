/**
 * Unit coverage for preset engine, validation, scoring, draft order, waiver ordering,
 * lifecycle permissions, specialty validation, and engine invariants.
 */

import { describe, expect, it } from 'vitest'
import { generateFullPickOrder } from '@/lib/draft-engine/order/generateFullPickOrder'
import {
  assertDraftPickCountInvariant,
  assertDraftSessionBelongsToLeague,
  assertLifecycleActionInState,
  assertLifecycleTransitionAllowed,
  assertNoDuplicateAutomationRun,
  assertNoDuplicateWaiverRun,
  assertNonEmptyIdempotencyKey,
  assertStandingsGamesPlayedConsistency,
  assertStandingsRecordShape,
} from '@/lib/engine-testing/hardening/engineInvariants'
import { LEAGUE_ENGINE_SCENARIO_FIXTURES, getScenarioFixture } from '@/lib/engine-testing/fixtures/leagueScenarioFixtures'
import {
  buildDynastyDevyImportFixture,
  buildGuillotineImportFixture,
  buildMinimalNormalizedImport,
} from '@/lib/engine-testing/fixtures/importNormalizationFixtures'
import { repeatSimulationScenario } from '@/lib/engine-testing/simulation/stressRepeatability'
import { runAllFixtures, runLeagueSimulationScenario } from '@/lib/engine-testing/simulation/leagueSimulationHarness'
import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { calculateFantasyPoints, normalizeSleeperNflStats } from '@/lib/scoring-engine/ScoringCalculator'
import { getStandingsTiebreakerOrder } from '@/lib/scoring-engine/scoringSettingsResolved'
import { validateConceptRulesShape } from '@/lib/specialty-automation/validation'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { orderClaimsForProcessing } from '@/lib/waiver-wire/process-engine'

function slotOrder(n: number): SlotOrderEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    slot: i + 1,
    rosterId: `r${i + 1}`,
    displayName: `T${i + 1}`,
  }))
}

describe('calculateFantasyPoints', () => {
  it('sums stat keys by rules (NFL)', () => {
    const rules = { passing_yards: 0.04, passing_td: 4 }
    const pts = calculateFantasyPoints('NFL', { passing_yards: 300, passing_td: 2 }, rules)
    expect(pts).toBe(300 * 0.04 + 2 * 4)
  })

  it('normalizes Sleeper NFL stats then scores', () => {
    const raw = { pass_yd: 250, pass_td: 2, rec: 5, rec_yd: 40 }
    const norm = normalizeSleeperNflStats(raw)
    const rules = { passing_yards: 0.04, passing_td: 4, reception: 0.5, receiving_yards: 0.1 }
    expect(calculateFantasyPoints('NFL', norm, rules)).toBeGreaterThan(0)
  })
})

describe('getStandingsTiebreakerOrder', () => {
  it('returns default order when missing', () => {
    expect(getStandingsTiebreakerOrder(null)).toEqual(['wins', 'pointsFor', 'pointsAgainst', 'rosterId'])
  })

  it('respects custom order in rules', () => {
    const order = getStandingsTiebreakerOrder({
      rules: { standingsTiebreakerOrder: ['pointsFor', 'wins'] },
    })
    expect(order[0]).toBe('pointsFor')
    expect(order[1]).toBe('wins')
  })
})

describe('generateFullPickOrder', () => {
  it('produces rounds * teams picks for snake', () => {
    const order = slotOrder(12)
    const plan = generateFullPickOrder({
      teamCount: 12,
      rounds: 16,
      draftType: 'snake',
      thirdRoundReversal: false,
      slotOrder: order,
    })
    expect(plan.length).toBe(12 * 16)
    expect(plan[0]?.rosterId).toBe('r1')
  })

  it('linear advances slot order monotonically per round', () => {
    const order = slotOrder(4)
    const plan = generateFullPickOrder({
      teamCount: 4,
      rounds: 2,
      draftType: 'linear',
      thirdRoundReversal: false,
      slotOrder: order,
    })
    expect(plan.length).toBe(8)
    expect(plan[0]?.slot).toBe(1)
    expect(plan[4]?.slot).toBe(1)
  })
})

describe('orderClaimsForProcessing', () => {
  const baseClaim = {
    id: 'c1',
    leagueId: 'L',
    rosterId: 'r1',
    addPlayerId: 'p1',
    dropPlayerId: null,
    priorityOrder: 1,
    status: 'pending',
    roster: {
      id: 'r1',
      platformUserId: 'u1',
      playerData: {},
      faabRemaining: 50,
      waiverPriority: 3,
    },
  }

  it('orders FAAB by bid desc then priority', () => {
    const a = {
      ...baseClaim,
      id: 'a',
      faabBid: 10,
      priorityOrder: 2,
      roster: { ...baseClaim.roster, waiverPriority: 2 },
    }
    const b = {
      ...baseClaim,
      id: 'b',
      rosterId: 'r2',
      faabBid: 20,
      priorityOrder: 1,
      roster: { ...baseClaim.roster, id: 'r2', waiverPriority: 1 },
    }
    const out = orderClaimsForProcessing([a, b] as any, 'faab', new Map())
    expect(out[0]?.id).toBe('b')
  })

  it('orders reverse_standings by rank map', () => {
    const rank = new Map<string, number>([
      ['u1', 2],
      ['u2', 1],
    ])
    const c1 = { ...baseClaim, id: 'x', roster: { ...baseClaim.roster, platformUserId: 'u1' } }
    const c2 = {
      ...baseClaim,
      id: 'y',
      rosterId: 'r2',
      roster: { ...baseClaim.roster, id: 'r2', platformUserId: 'u2' },
    }
    const out = orderClaimsForProcessing([c1, c2] as any, 'reverse_standings', rank)
    // currentRank 1 is first place, so the rank-2 team (the worse one) claims first.
    expect(out[0]?.roster.platformUserId).toBe('u1')
  })

  it('reverse_standings puts an unranked team after every ranked one', () => {
    const rank = new Map<string, number>([['u1', 1]])
    const c1 = { ...baseClaim, id: 'x', roster: { ...baseClaim.roster, platformUserId: 'u1' } }
    const c2 = {
      ...baseClaim,
      id: 'y',
      rosterId: 'r2',
      roster: { ...baseClaim.roster, id: 'r2', platformUserId: 'u-unranked' },
    }
    const out = orderClaimsForProcessing([c2, c1] as any, 'reverse_standings', rank)
    expect(out.map((c: any) => c.id)).toEqual(['x', 'y'])
  })

  it('FAAB reverse-standings tiebreak gives an equal bid to the worse team', () => {
    const rank = new Map<string, number>([['u1', 1], ['u2', 4]])
    const c1 = { ...baseClaim, id: 'x', faabBid: 10, roster: { ...baseClaim.roster, platformUserId: 'u1' } }
    const c2 = {
      ...baseClaim,
      id: 'y',
      faabBid: 10,
      rosterId: 'r2',
      roster: { ...baseClaim.roster, id: 'r2', platformUserId: 'u2' },
    }
    const out = orderClaimsForProcessing([c1, c2] as any, 'faab', rank, 'reverse_standings')
    expect(out[0]?.id).toBe('y')
  })

  it('orders rolling by waiverPriority', () => {
    const hi = {
      ...baseClaim,
      id: 'hi',
      roster: { ...baseClaim.roster, waiverPriority: 5 },
    }
    const lo = {
      ...baseClaim,
      id: 'lo',
      rosterId: 'r2',
      roster: { ...baseClaim.roster, id: 'r2', waiverPriority: 1 },
    }
    const out = orderClaimsForProcessing([hi, lo] as any, 'rolling', new Map())
    expect(out[0]?.id).toBe('lo')
  })
})

describe('validateCreatePayload', () => {
  it('accepts a valid NFL redraft body', () => {
    const r = validateCreatePayload({
      concept: 'redraft',
      sport: 'NFL',
      teamCount: 12,
      draftType: 'snake',
      scoringPreset: 'half_ppr',
      leagueName: 'X',
    })
    expect(r.ok).toBe(true)
  })

  it('rejects unknown concept', () => {
    const r = validateCreatePayload({
      concept: 'not_a_real_concept_xyz',
      sport: 'NFL',
      teamCount: 12,
      draftType: 'snake',
      scoringPreset: 'half_ppr',
      leagueName: 'X',
    })
    expect(r.ok).toBe(false)
  })

  it('rejects soccer without pipeline', () => {
    const r = validateCreatePayload({
      concept: 'redraft',
      sport: 'SOCCER',
      teamCount: 12,
      draftType: 'snake',
      scoringPreset: 'half_ppr',
      leagueName: 'X',
    })
    expect(r.ok).toBe(false)
  })
})

describe('runPresetEngine + fixtures', () => {
  it('resolves every scenario fixture without throwing', () => {
    for (const f of LEAGUE_ENGINE_SCENARIO_FIXTURES) {
      const out = runPresetEngine(f.preset)
      expect(out.presetKey.length).toBeGreaterThan(0)
      expect(out.leagueFormatId).toBeTruthy()
    }
  })

  it('idp fixture carries idp modifier', () => {
    const fx = getScenarioFixture('idp_nfl')
    expect(fx).toBeDefined()
    const out = runPresetEngine(fx!.preset)
    const tags = (out.conceptRules as { aliasTags?: string[] })?.aliasTags ?? []
    expect(tags).toContain('idp')
  })
})

describe('engine invariants', () => {
  it('blocks invalid lifecycle transition', () => {
    const r = assertLifecycleTransitionAllowed('archived', 'in_season')
    expect(r.ok).toBe(false)
  })

  it('allows drafting -> post_draft', () => {
    expect(assertLifecycleTransitionAllowed('drafting', 'post_draft').ok).toBe(true)
  })

  it('blocks waiver claim in setup', () => {
    const r = assertLifecycleActionInState('waiver_claim_submit', 'setup')
    expect(r.ok).toBe(false)
  })

  it('draft pick count invariant', () => {
    expect(assertDraftPickCountInvariant({ teamCount: 10, rounds: 15, expectedPicks: 150 }).ok).toBe(true)
    expect(assertDraftPickCountInvariant({ teamCount: 10, rounds: 15, expectedPicks: 149 }).ok).toBe(false)
  })

  it('idempotency + duplicate guards', () => {
    expect(assertNonEmptyIdempotencyKey('').ok).toBe(false)
    expect(assertNonEmptyIdempotencyKey('run-1').ok).toBe(true)
    expect(
      assertNoDuplicateAutomationRun({ thisRunKey: 'k', lastCompletedRunKey: 'k', force: false }).ok,
    ).toBe(false)
    expect(assertNoDuplicateWaiverRun({ runKey: 'w1', completedRunKeys: new Set(['w1']), force: false }).ok).toBe(
      false,
    )
    expect(assertDraftSessionBelongsToLeague({ sessionLeagueId: 'a', expectedLeagueId: 'b' }).ok).toBe(false)
  })

  it('standings shape + games played', () => {
    expect(assertStandingsRecordShape({ wins: -1, losses: 0, ties: 0 }).ok).toBe(false)
    expect(assertStandingsGamesPlayedConsistency({ wins: 5, losses: 5, ties: 1, gamesPlayed: 11 }).ok).toBe(true)
    expect(assertStandingsGamesPlayedConsistency({ wins: 5, losses: 4, ties: 1, gamesPlayed: 9 }).ok).toBe(false)
  })
})

describe('validateConceptRulesShape', () => {
  it('rejects non-object extensions', () => {
    const v = validateConceptRulesShape({ extensions: 'bad' as unknown as Record<string, unknown> })
    expect(v.ok).toBe(false)
  })
})

describe('import normalization bundle', () => {
  it('builds canonical bundle from minimal import', () => {
    const bundle = buildCanonicalImportBundle(buildMinimalNormalizedImport())
    expect(bundle.settingsSnapshot.snapshotVersion).toBeTruthy()
    expect(bundle.settingsSnapshot.conceptRules?.concept).toBeTruthy()
  })

  it('dynasty devy fixture sets devy flags', () => {
    const bundle = buildCanonicalImportBundle(buildDynastyDevyImportFixture())
    expect(bundle.derivedFlags.devy).toBe(true)
  })

  it('guillotine name infers concept', () => {
    const bundle = buildCanonicalImportBundle(buildGuillotineImportFixture())
    expect(bundle.inferredConcept).toBe('guillotine')
    expect(bundle.settingsSnapshot.conceptRules?.concept).toBe('guillotine')
  })
})

describe('simulation harness', () => {
  it('runAllFixtures passes all built-in scenarios', () => {
    const { failed, passed } = runAllFixtures(LEAGUE_ENGINE_SCENARIO_FIXTURES)
    expect(failed).toBe(0)
    expect(passed).toBe(LEAGUE_ENGINE_SCENARIO_FIXTURES.length)
  })

  it('repeatSimulationScenario is stable', () => {
    const fx = getScenarioFixture('standard_redraft_nfl')!
    const rep = repeatSimulationScenario(fx, 25)
    expect(rep.stable).toBe(true)
    expect(rep.uniqueFingerprints).toBe(1)
  })

  it('optional invalid lifecycle path surfaces errors', () => {
    const fx = getScenarioFixture('standard_redraft_nfl')!
    const bad = runLeagueSimulationScenario(fx, {
      lifecyclePath: ['setup', 'in_season'],
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.length).toBeGreaterThan(0)
  })
})
