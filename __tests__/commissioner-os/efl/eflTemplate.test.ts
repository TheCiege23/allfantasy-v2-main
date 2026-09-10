import { describe, expect, it } from 'vitest'

import { EFL_PROMOTION_RELEGATION_DYNASTY_V1 } from '@/lib/commissioner-os/template/definitions/eflPromotionRelegationDynasty'
import { EFL_PROMOTION_RELEGATION_DYNASTY_V1_1 } from '@/lib/commissioner-os/template/definitions/eflPromotionRelegationDynastyV1_1'
import { latestVersionOf, listVersionsOf, resolveTemplate } from '@/lib/commissioner-os/template/registry'
import { validateTemplateDefinition } from '@/lib/commissioner-os/template/types'
import { planTemplateActions } from '@/lib/commissioner-os/template/planTemplateActions'
import { resolveCommissionerLeagueProfile } from '@/lib/commissioner-os/profile/resolveCommissionerLeagueProfile'
import { RULE_EFFECTS } from '@/lib/commissioner-os/ruleEffects'

/**
 * The EFL template across two published versions, and what its plan is allowed to claim.
 */

function eflLeague(platform: string) {
  return {
    id: 'efl-1',
    sport: 'NFL',
    season: 2026,
    leagueType: 'dynasty',
    isDynasty: true,
    platform,
    status: 'active',
    lifecycleState: 'in_season',
    settings: {
      conceptRules: {
        extensions: {
          aliasTags: ['efl_promotion_relegation'],
          commissionerTemplate: { id: 'efl_promotion_relegation_dynasty', version: '1.1.0' },
        },
      },
    },
  }
}

const profileFor = (platform: string) =>
  resolveCommissionerLeagueProfile({ league: eflLeague(platform), commissionerRole: 'commissioner' })

const planFor = (platform: string) =>
  planTemplateActions({
    profile: profileFor(platform),
    template: EFL_PROMOTION_RELEGATION_DYNASTY_V1_1,
    trigger: 'onManualRun',
    season: 2026,
  })

describe('1.0.0 is published and was NOT edited', () => {
  it('still carries its original capability set', () => {
    expect([...EFL_PROMOTION_RELEGATION_DYNASTY_V1.capabilityIds].sort()).toEqual([
      'draft.custom_rookie_order',
      'governance.configurable_rules',
      'phase.state_machine',
      'roster.dynasty_carryover',
      'standings.frozen_input',
      'standings.promotion_relegation',
      'standings.tier_playoffs',
    ])
  })

  it('still declares the three modules that have since been built as deferred', () => {
    /*
     * 🛑 THIS IS THE POINT OF PINNING. 1.0.0 said the playoff-decided slots, the freeze and the
     * order generator did not exist. They do now — and a league pinned to 1.0.0 must still read the
     * contract it was pinned to, not a retroactively improved one.
     */
    const deferred = (EFL_PROMOTION_RELEGATION_DYNASTY_V1.governancePolicy?.deferredModules ?? []).join(' ')
    expect(deferred).toMatch(/playoff-decided/i)
    expect(deferred).toMatch(/Max PF freeze snapshot/i)
    expect(deferred).toMatch(/rookie order generator/i)
  })

  it('declares no per-effect backing', () => {
    expect(EFL_PROMOTION_RELEGATION_DYNASTY_V1.scheduledEffects.every((e) => e.backedBy === undefined)).toBe(true)
  })

  it('is still resolvable at its exact pin', () => {
    expect(resolveTemplate('efl_promotion_relegation_dynasty', '1.0.0')?.version).toBe('1.0.0')
  })
})

describe('1.1.0 is a new version beside it, not a replacement', () => {
  it('validates', () => {
    expect(validateTemplateDefinition(EFL_PROMOTION_RELEGATION_DYNASTY_V1_1)).toEqual([])
  })

  it('both versions are registered', () => {
    expect(listVersionsOf('efl_promotion_relegation_dynasty').map((t) => t.version)).toEqual(['1.0.0', '1.1.0', '1.2.0'])
  })

  it('resolves at its exact pin, and an unknown version still returns null', () => {
    expect(resolveTemplate('efl_promotion_relegation_dynasty', '1.1.0')?.version).toBe('1.1.0')
    /* An unpublished version. 1.2.0 exists now, so the "unknown" case needs a version that does not. */
    expect(resolveTemplate('efl_promotion_relegation_dynasty', '9.9.9')).toBeNull()
  })

  it('latestVersionOf — which is for NEW leagues only — now points at the newest published version', () => {
    /*
     * ⚠ THIS MOVES EVERY TIME A VERSION SHIPS, AND THAT IS THE CORRECT BEHAVIOUR. It must NEVER be
     * used to decide what to run for a league already pinned to 1.1.0 — `resolveTemplate` with the
     * league's own pin is that answer, and it still returns 1.1.0 (asserted above).
     */
    expect(latestVersionOf('efl_promotion_relegation_dynasty')?.version).toBe('1.2.0')
  })

  it('claims the SAME capabilities, so what the league IS did not change', () => {
    expect([...EFL_PROMOTION_RELEGATION_DYNASTY_V1_1.capabilityIds].sort()).toEqual(
      [...EFL_PROMOTION_RELEGATION_DYNASTY_V1.capabilityIds].sort(),
    )
  })

  it('is a standalone object, not a spread of 1.0.0', () => {
    /*
     * ⚠ IF THESE EVER SHARE A REFERENCE, EDITING ONE EDITS THE OTHER and pinning stops meaning
     * anything. Cheap to assert, and the failure it catches is silent.
     */
    expect(EFL_PROMOTION_RELEGATION_DYNASTY_V1_1.scheduledEffects).not.toBe(
      EFL_PROMOTION_RELEGATION_DYNASTY_V1.scheduledEffects,
    )
    expect(EFL_PROMOTION_RELEGATION_DYNASTY_V1_1.phaseGraph).not.toBe(
      EFL_PROMOTION_RELEGATION_DYNASTY_V1.phaseGraph,
    )
  })
})

describe('1.1.0 states what actually backs each effect, in both directions', () => {
  const byId = new Map(EFL_PROMOTION_RELEGATION_DYNASTY_V1_1.scheduledEffects.map((e) => [e.id, e]))

  it('NARROWS promote/relegate away from the global engine claim', () => {
    /*
     * 🛑 THE HALF THAT MATTERS. `PROMOTE_TEAM` is globally `engine` because `PromotionEngine`
     * genuinely applies STANDINGS-ZONE movement. EFL's is playoff-decided and nothing applies it,
     * so inheriting the global claim would assert an execution path that exists for a different
     * competition.
     */
    expect(RULE_EFFECTS.PROMOTE_TEAM.executorStatus).toBe('engine')
    expect(byId.get('efl.apply_promotions')!.backedBy?.status).toBe('planned')
    expect(byId.get('efl.apply_relegations')!.backedBy?.status).toBe('planned')
  })

  it('WIDENS the draft slot effect, which has no generic engine at all', () => {
    expect(RULE_EFFECTS.ASSIGN_DRAFT_SLOT.executorStatus).toBe('none')
    const e = byId.get('efl.publish_rookie_order')!
    expect(e.backedBy?.engine).toBe('lib/commissioner-os/efl/rookieDraftOrder.ts')
    expect(e.backedBy?.status).toBe('planned')
  })

  it('every backing names a module', () => {
    for (const e of EFL_PROMOTION_RELEGATION_DYNASTY_V1_1.scheduledEffects) {
      if (!e.backedBy) continue
      expect(e.backedBy.engine).toMatch(/^lib\//)
    }
  })

  it('the planner reports the template backing, not the global default', () => {
    const plan = planFor('allfantasy')
    const promote = plan.actions.find((a) => a.effectId === 'efl.apply_promotions')!
    expect(promote.metadata.executorStatus).toBe('planned')
    expect(promote.metadata.canonicalEngine).toBe('lib/commissioner-os/efl/seasonTransitionResolver.ts')

    const draft = plan.actions.find((a) => a.effectId === 'efl.publish_rookie_order')!
    /* Widened away from `none`, so it no longer emits the "guidance only" warning. */
    expect(draft.metadata.executorStatus).toBe('planned')
    expect(plan.warnings.join(' ')).not.toMatch(/no executor exists for ASSIGN_DRAFT_SLOT/)
  })
})

describe('a read-only Sleeper league plans no external write', () => {
  const plan = planFor('sleeper')

  it('the league is SHADOW even with a commissioner asking', () => {
    expect(profileFor('sleeper').writeAuthority).toBe('SHADOW')
    expect(profileFor('sleeper').commissionerRole).toBe('commissioner')
  })

  it('nothing in the plan is executable', () => {
    expect(plan.actions.every((a) => a.executable === false)).toBe(true)
  })

  it('EFL contains NO external-scope effect, so nothing could claim a Sleeper write', () => {
    /*
     * ⚠ THE HONEST FINDING, NOT A LOOPHOLE. Tiers, divisions and rookie order are AllFantasy
     * constructs — the source Sleeper league is one flat 32-team league that has never heard of the
     * Premier League. So EFL needs no write-back at all, and its plan says so by construction.
     */
    for (const a of plan.actions) {
      expect(RULE_EFFECTS[a.effectType].scope).toBe('internal')
    }
  })

  it('the draft order is prepared for a human to enter, and never reported as applied', () => {
    const draft = plan.actions.find((a) => a.effectId === 'efl.publish_rookie_order')!
    expect(draft.authority.canPrepare).toBe(true)
    expect(draft.executable).toBe(false)
    expect(
      EFL_PROMOTION_RELEGATION_DYNASTY_V1_1.externalPlatformBehavior.notes!.join(' '),
    ).toMatch(/cannot set it, and must never say it did/i)
  })
})

describe('internal effects retain valid AllFantasy execution capability', () => {
  it('authority says yes even on a shadow league — the block is the template, not the platform', () => {
    /*
     * 🛑 TWO DIFFERENT VERDICTS AND BOTH MATTER. `authority.canExecute` is "may AllFantasy write
     * this at all", and for AF-owned state the answer is yes on any platform. `executable` is the
     * three-way AND that also requires an engine and an executing template. Collapsing them would
     * either block AF from its own state machine or claim an execution that has not been built.
     */
    for (const a of planFor('sleeper').actions) {
      expect(a.authority.canExecute).toBe(true)
      expect(a.executable).toBe(false)
    }
  })

  it('a native league is no more executable than a shadow one while the flag is off', () => {
    const native = planFor('allfantasy')
    expect(native.executionEnabled).toBe(false)
    expect(native.actions.some((a) => a.executable)).toBe(false)
    expect(native.warnings.join(' ')).toMatch(/non-executing/i)
  })

  it('execution stays off because persistence and an applier are still missing', () => {
    const deferred = (EFL_PROMOTION_RELEGATION_DYNASTY_V1_1.governancePolicy?.deferredModules ?? []).join(' ')
    expect(deferred).toMatch(/durable storage for the Max PF freeze/i)
    expect(deferred).toMatch(/applier that consumes a settled SeasonEndTransition/i)
    expect(deferred).toMatch(/optimal-lineup Max PF/i)
  })
})

describe('the two versions produce different idempotency keys for the same effect', () => {
  it('so a rules change cannot re-fire what already ran under the old ruleset', () => {
    const shared = { profile: profileFor('allfantasy'), trigger: 'onManualRun' as const, season: 2026 }
    const a = planTemplateActions({ ...shared, template: EFL_PROMOTION_RELEGATION_DYNASTY_V1 })
    const b = planTemplateActions({ ...shared, template: EFL_PROMOTION_RELEGATION_DYNASTY_V1_1 })

    const keyOf = (p: typeof a) => p.actions.find((x) => x.effectId === 'efl.apply_promotions')!.idempotencyKey
    expect(keyOf(a)).toContain('@1.0.0')
    expect(keyOf(b)).toContain('@1.1.0')
    expect(keyOf(a)).not.toBe(keyOf(b))
  })
})
