import { describe, expect, it } from 'vitest'
import { assembleManagerRecommendations } from '@/lib/decision-os/phase6/recommendations/recommendations'
import type { ManagerRecommendationInput } from '@/lib/decision-os/phase6/recommendations/types'

/**
 * Milestone 32 — raw behavioural profiles unavailable through public API paths, for the manager
 * recommendation surface.
 *
 * 🛑 WHY THIS IS A PUBLIC PATH AND NOT AN INTERNAL STRUCTURE. `managerCommandCenter.ts` passes the
 * whole `Recommendation` object through untouched, and
 * `/api/decision-os/manager-command-center` answers with `NextResponse.json({ ...snapshot })`. So
 * `recommendations[].evidence`, `.derivation`, `.rollbackCriteria`, `.uncertainty` and every
 * `recommendedActions[].rationale` reach a client verbatim. Fourteen of those strings named the
 * classification outright.
 *
 * ⚠ A FIELD-NAME DENYLIST WOULD HAVE MISSED ALL OF IT. The values sat inside `evidence` and
 * `derivation`, which are legitimate field names holding free text.
 *
 * ⚠ AND A VALUE DENYLIST ALONE IS ALSO WRONG, IN THE OPPOSITE DIRECTION. Several label values are
 * ordinary English — `balanced`, `passive`, `neutral`, `reactive`, `reliable`. This module already
 * ships "more balanced proposals" as legitimate product copy. Asserting on the whole union would
 * fail on a sentence that leaks nothing, and the usual repair for a noisy check is to weaken it.
 * So the denylist below carries only the DISTINCTIVE compound tokens, and the real guarantee comes
 * from the equivalence test underneath it.
 */

/** Distinctive enough that an appearance is always a leak. Ordinary words are deliberately absent. */
const LEAKY_TOKENS = [
  'ghost_manager', 'set_and_forget', 'reactive_manager', 'indecisive_tinkerer',
  'serial_trader', 'waiver_hawk', 'trade_seeker', 'committed_grinder',
  'trade_dominant', 'waiver_dominant', 'risk_taking', 'risk_averse',
  'primaryIdentity', 'decisionStyle', 'transactionStyle', 'riskTendency',
  'engagementReliability', 'DNA assembler', 'Set-and-forget',
]

const identity = (over: Partial<Record<string, unknown>> = {}) => ({
  primaryIdentity: 'committed_grinder',
  decisionStyle: 'methodical',
  transactionStyle: 'balanced',
  riskTendency: 'neutral',
  engagementReliability: 'reliable',
  traits: [{ trait: 'consistency', strength: 'strong' }],
  completeness: 90,
  ...over,
}) as ManagerRecommendationInput['identity']

const forIdentity = (over: Record<string, unknown>): ManagerRecommendationInput => ({
  managerId: 'mgr_1',
  leagueId: 'lge_1',
  identity: identity(over),
})

/** Every string a client could read, flattened. */
function emittedStrings(set: ReturnType<typeof assembleManagerRecommendations>): string[] {
  const out: string[] = []
  for (const r of set.recommendations) {
    out.push(...r.evidence, ...r.derivation, ...r.rollbackCriteria, ...r.uncertainty, ...r.prerequisites)
    out.push(r.expectedImpact, ...(r.benchmarkComparison ? [r.benchmarkComparison] : []))
    for (const a of r.recommendedActions) out.push(a.action, a.rationale)
  }
  return out
}

const leaksIn = (strings: string[]) =>
  strings.flatMap((s) => LEAKY_TOKENS.filter((t) => s.includes(t)).map((t) => `${t} :: ${s}`))

describe('the leak detector itself can fire', () => {
  /*
   * 🛑 A DENYLIST THAT HAS NEVER MATCHED IS NOT EVIDENCE. This reproduces the exact string the
   * producer used to emit, so a later refactor that breaks `emittedStrings` (returning [] because a
   * field was renamed, say) fails here rather than going quietly green everywhere below.
   */
  it('flags the sentence this module used to ship', () => {
    expect(leaksIn(['Manager classified as ghost_manager by DNA assembler'])).not.toHaveLength(0)
    expect(leaksIn(['Dismiss when transactionStyle improves to waiver_dominant or balanced'])).not.toHaveLength(0)
  })

  it('does not flag legitimate copy that merely uses an ordinary word', () => {
    expect(leaksIn(['Higher trade acceptance rate, more balanced proposals'])).toHaveLength(0)
  })
})

describe('no manager classification reaches a client', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['a dormant manager', { primaryIdentity: 'ghost_manager', engagementReliability: 'unreliable' }],
    ['a conservative manager', { primaryIdentity: 'set_and_forget' }],
    ['an indecisive manager', { primaryIdentity: 'indecisive_tinkerer', decisionStyle: 'indecisive' }],
    ['a trade seeker', { primaryIdentity: 'trade_seeker' }],
    ['a passive transactor', { transactionStyle: 'passive' }],
    ['an inconsistent manager', { engagementReliability: 'inconsistent' }],
  ]

  it.each(cases)('%s leaks no label vocabulary', (_name, over) => {
    const leaks = leaksIn(emittedStrings(assembleManagerRecommendations(forIdentity(over))))
    expect(leaks).toEqual([])
  })

  it('and the recommendations still fire — withholding evidence must not silence the product', () => {
    for (const [, over] of cases) {
      expect(assembleManagerRecommendations(forIdentity(over)).recommendations.length).toBeGreaterThan(0)
    }
  })

  it('every fired recommendation still carries some evidence', () => {
    /*
     * ⚠ THE IDENTITY-ONLY PATH USED TO PRODUCE AN EMPTY `evidence` ARRAY on lineup_discipline —
     * advice with nothing behind it. The pre-existing suite asserts `evidence.length > 0` and
     * passed anyway, because every one of its fixtures also carried a pattern. Withholding a label
     * is not a licence to say nothing.
     */
    for (const [, over] of cases) {
      for (const r of assembleManagerRecommendations(forIdentity(over)).recommendations) {
        expect(r.evidence.length, `${r.category} produced no evidence`).toBeGreaterThan(0)
      }
    }
  })
})

/**
 * 🛑 THE GUARANTEE THE DENYLIST CANNOT GIVE. A denylist only rules out the words someone thought
 * to list — it says nothing about a NEW label, or a paraphrase like "shows minimal in-season roster
 * activity", which is `set_and_forget`'s definition written out in friendlier words.
 *
 * This asserts the property directly instead: change ONLY the classification, and the text a client
 * receives must not change. If the output carries no information about which label fired, no label
 * can be recovered from it — and that holds for labels nobody has invented yet.
 *
 * ⚠ `priority` AND `severity` ARE DELIBERATELY EXCLUDED, AND THAT IS A REAL LIMIT, NOT AN OVERSIGHT.
 * They genuinely vary with the classification — a dormant manager is more urgent than a
 * conservative one — so a coarse urgency signal does still correlate. Flattening it would remove
 * product behaviour the privacy rule never asked for. The line drawn is the vocabulary and any
 * restatement of it, not the existence of a decision. Said out loud so nobody reads this test as
 * proving more than it does.
 */
describe('the text a client receives does not vary with the classification', () => {
  const textOf = (over: Record<string, unknown>, category: string) => {
    const rec = assembleManagerRecommendations(forIdentity(over))
      .recommendations.find((r) => r.category === category)
    if (!rec) return null
    return JSON.stringify({
      evidence: rec.evidence,
      // `priority=`/`severity=` entries are excluded per the note above.
      derivation: rec.derivation.filter((d) => !d.startsWith('priority=')),
      rollbackCriteria: rec.rollbackCriteria,
      uncertainty: rec.uncertainty,
      actions: rec.recommendedActions.map((a) => [a.action, a.rationale]),
    })
  }

  it('league_participation reads identically for a dormant and a conservative manager', () => {
    const ghost = textOf({ primaryIdentity: 'ghost_manager' }, 'league_participation')
    const setForget = textOf({ primaryIdentity: 'set_and_forget' }, 'league_participation')
    expect(ghost).not.toBeNull()
    expect(setForget).not.toBeNull()
    expect(ghost).toEqual(setForget)
  })

  it('engagement_boost reads identically for an unreliable and an inconsistent manager', () => {
    const unreliable = textOf({ engagementReliability: 'unreliable' }, 'engagement_boost')
    const inconsistent = textOf({ engagementReliability: 'inconsistent' }, 'engagement_boost')
    expect(unreliable).not.toBeNull()
    expect(unreliable).toEqual(inconsistent)
  })
})

/**
 * ⚠ LEAGUE ARCHETYPES ARE NOT IN SCOPE AND MUST NOT BE SWEPT UP. `inactive_or_stale`,
 * `high_churn_risk` and the platform-wide `archetypeDistribution` classify a LEAGUE, not a person.
 * Milestone 32 is about manager dossiers; removing league-health language would gut the
 * commissioner and platform recommendations for no privacy gain. This pins the distinction so a
 * later "finish the privacy pass" sweep does not quietly delete the wrong thing.
 */
describe('league-level archetypes are deliberately untouched', () => {
  it('the manager denylist contains no league archetype term', () => {
    expect(LEAKY_TOKENS).not.toContain('inactive_or_stale')
    expect(LEAKY_TOKENS).not.toContain('high_churn_risk')
  })
})
