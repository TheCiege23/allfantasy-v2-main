import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

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

const root = process.cwd()

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
 * 🛑 `priority` AND `severity` ARE EXCLUDED HERE, AND THE LIMIT IS LARGER THAN THAT EXCLUSION
 * ADMITS. See the pinned measurement at the bottom of this file: the label is recoverable, and not
 * only from the ordinal. This describe block therefore proves something narrow — that the TEXT
 * carries nothing — and must not be read as proving the classification is unrecoverable.
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

/**
 * 🛑 PINNED MEASUREMENT: THE CLASSIFICATION IS STILL RECOVERABLE, AND THIS RECORDS EXACTLY HOW.
 *
 * The text carries nothing (above). That is not the same as the label being unrecoverable, and the
 * difference was found only by running the test a reviewer proposed: hold everything fixed, vary
 * only the label, and check whether the emitted urgency pairs COLLIDE. They do not — all eight
 * labels produce distinct (priority, severity).
 *
 * ⚠ AND THE URGENCY IS NOT THE BINDING CHANNEL, WHICH IS THE FINDING THAT MATTERS. The SET OF
 * CATEGORIES that fires is already injective on the label, before any field is read. So
 * "flatten priority/severity" would cost real product behaviour and close nothing.
 *
 * That residue is inseparable from a recommender that tailors advice: giving the advice reveals the
 * condition that triggered it. It is pinned rather than fixed, so that if someone later changes the
 * category-to-label mapping — or decides the residue is unacceptable and removes the tailoring —
 * this goes red and the decision is explicit instead of silent.
 *
 * ✅ AND IT HAS BEEN RULED ON RATHER THAN LEFT OPEN. Guap, 2026-09-11, shown the measurement:
 * "keep the recommendations, it's self-scoped." So these assertions are not a to-do list — they
 * record an accepted residue. They exist so that a change to its SHAPE is visible, because the
 * ruling was given about this shape and does not automatically transfer to another one.
 *
 * ⚠ THE RULING'S PREMISE IS ENFORCED IN THE LAST DESCRIBE BLOCK OF THIS FILE. Self-scoping is what
 * made the residue acceptable; it is a reachability fact, and a future commit can break it without
 * touching anything these tests read.
 */
describe('PINNED LIMIT: the label survives in the shape of the response', () => {
  const LABELS = [
    'ghost_manager', 'set_and_forget', 'reactive_manager', 'indecisive_tinkerer',
    'serial_trader', 'waiver_hawk', 'trade_seeker', 'committed_grinder',
  ]

  /** The categories that fire for a label, sorted — the channel that binds. */
  const firedFor = (label: string) =>
    assembleManagerRecommendations(forIdentity({ primaryIdentity: label }))
      .recommendations.map((r) => r.category).sort().join('+')

  it('the set of categories that fires identifies the label', () => {
    const seen = new Map<string, string[]>()
    for (const l of LABELS) {
      const k = firedFor(l)
      seen.set(k, [...(seen.get(k) ?? []), l])
    }
    // Labels that produce a NON-EMPTY, unique category set are individually recoverable.
    const recoverable = [...seen.entries()]
      .filter(([k, ls]) => k !== '' && ls.length === 1)
      .map(([, ls]) => ls[0])
      .sort()
    expect(recoverable).toEqual(
      ['ghost_manager', 'indecisive_tinkerer', 'set_and_forget', 'trade_seeker'],
    )
  })

  it('and the urgency pair does not collide either, so flattening it would close nothing', () => {
    const pairs = new Set<string>()
    let emitted = 0
    for (const l of LABELS) {
      for (const r of assembleManagerRecommendations(forIdentity({ primaryIdentity: l })).recommendations) {
        pairs.add(`${r.category}:${r.priority}/${r.severity}`)
        emitted += 1
      }
    }
    // One distinct (category, priority, severity) per emitted recommendation = no collisions at all.
    expect(pairs.size).toBe(emitted)
  })
})

/**
 * 🛑 THE PRECONDITION THE PRODUCT RULING RESTS ON, ENFORCED RATHER THAN OBSERVED.
 *
 * Guap ruled on 2026-09-11: KEEP the tailored recommendations — the residual channel above is
 * acceptable BECAUSE IT IS SELF-SCOPED. A viewer can infer their own classification and nobody
 * else's. That ruling is conditional, and the condition is a reachability fact that a future commit
 * can silently break.
 *
 * ⚠ THE LATENT PATH IS ALREADY IN THE FILE. `assembleRecommendations` — the unified orchestrator —
 * does `input.managerInputs.map(assembleManagerRecommendations)`, i.e. MANY managers at once. It is
 * exported from the phase6 barrel and has NO production caller today; only tests reach it. Wire it
 * to a route and the ruling's premise is gone, with nothing else going red: the text still carries
 * no label, the equivalence test still passes, and third parties' classifications become
 * recoverable from the categories that fire for each of them.
 *
 * ⚠ A CALLER CENSUS BY `from '@/lib/x'` ALONE HAS GIVEN THE WRONG ANSWER FOUR SEPARATE TIMES IN
 * THIS REPO — missing relative imports, dynamic `await import(...)`, re-export facades and test
 * mocks. This scan walks the production trees and reads every import form, and it carries positive
 * controls, because a census that silently finds nothing is indistinguishable from a safe one.
 */
describe('PRECONDITION: manager recommendations stay self-scoped', () => {
  const ROOTS = ['app', 'lib', 'server', 'components']
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) }
      else if (/\.tsx?$/.test(e.name)) files.push(p.split(path.sep).join('/'))
    }
  }
  for (const r of ROOTS) walk(path.join(root, r))
  const rootPosix = root.split(path.sep).join('/')
  const withText = (needle: string) =>
    files.filter((f) => readFileSync(f, 'utf8').includes(needle))
      .map((f) => f.slice(rootPosix.length + 1))

  it('the census can see the repo at all', () => {
    // Positive control. A broken walk returns [] and every assertion below would pass vacuously.
    expect(files.length).toBeGreaterThan(500)
    expect(withText('assembleManagerRecommendations')).toContain(
      'lib/decision-os/dashboard-intelligence.ts',
    )
  })

  it('exactly one production module calls the per-manager assembler', () => {
    const refs = withText('assembleManagerRecommendations').filter(
      (f) => f !== 'lib/decision-os/phase6/recommendations/recommendations.ts' // the definition
        && f !== 'lib/decision-os/phase6/index.ts'                            // the barrel re-export
        && f !== 'lib/validation-cohort/validation/compositionBridge.ts',     // a string literal, not a call
    )
    expect(refs).toEqual(['lib/decision-os/dashboard-intelligence.ts'])
  })

  it('that caller selects the profile by the requesting manager id', () => {
    const src = readFileSync(path.join(root, 'lib/decision-os/dashboard-intelligence.ts'), 'utf8')
    expect(src).toContain('p.managerId === managerId')
  })

  it('the route resolves the session user, never a managerId from the request', () => {
    const src = readFileSync(
      path.join(root, 'app/api/decision-os/manager-command-center/route.ts'), 'utf8')
    expect(src).toContain('getServerSession')
    expect(src).toMatch(/status:\s*401/)
    // No managerId is read off the URL — that is what would let a caller name someone else.
    expect(src).not.toMatch(/searchParams\.get\(\s*['"]managerId['"]\s*\)/)
  })

  it('the MANY-manager orchestrator still has no production caller', () => {
    /*
     * If this goes red, someone wired `assembleRecommendations`. That is not automatically wrong —
     * but it removes the premise the 2026-09-11 ruling was given on, so it needs a fresh decision
     * rather than inheriting this one.
     */
    const refs = withText('assembleRecommendations').filter(
      (f) => f !== 'lib/decision-os/phase6/recommendations/recommendations.ts'
        && f !== 'lib/decision-os/phase6/index.ts',
    )
    expect(refs).toEqual([])
  })
})
