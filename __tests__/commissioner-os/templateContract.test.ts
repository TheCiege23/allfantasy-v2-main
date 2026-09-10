import { describe, expect, it } from 'vitest'

import { EFL_PROMOTION_RELEGATION_DYNASTY_V1 } from '@/lib/commissioner-os/template/definitions/eflPromotionRelegationDynasty'
import { SURVIVOR_ALL_STARS_GUILLOTINE_V1 } from '@/lib/commissioner-os/template/definitions/survivorAllStarsGuillotine'
import {
  latestVersionOf,
  listTemplateVersions,
  resolveTemplate,
  resolveTemplateByKey,
} from '@/lib/commissioner-os/template/registry'
import { validateTemplateDefinition, type LeagueTemplateDefinition } from '@/lib/commissioner-os/template/types'
import { RULE_EFFECTS } from '@/lib/commissioner-os/ruleEffects'
import { LINEUP_SCHEDULE, SUPERFLEX_WEEK } from '@/lib/trade-intel/survivorGuillotine'

/**
 * Phase C5 — the template contract and its two proof fixtures.
 */

describe('the validator can actually fail', () => {
  /*
   * 🛑 THE POSITIVE CONTROL. `validateTemplateDefinition` returning `[]` for both fixtures is not
   * evidence that they are valid until the validator has been seen to go red. A check that has
   * never once failed is not a check.
   */
  const base = SURVIVOR_ALL_STARS_GUILLOTINE_V1

  it('catches a phase pointing at a phase that does not exist', () => {
    const broken: LeagueTemplateDefinition = {
      ...base,
      phaseGraph: {
        initialPhaseId: 'a',
        phases: [
          { id: 'a', label: 'A', summary: '', next: ['ghost'] },
          { id: 'b', label: 'B', summary: '', next: [], terminal: true },
        ],
      },
    }
    expect(validateTemplateDefinition(broken).map((i) => i.code)).toContain('phase_next_missing')
  })

  it('catches a missing initial phase', () => {
    const broken: LeagueTemplateDefinition = {
      ...base,
      phaseGraph: { initialPhaseId: 'nope', phases: [{ id: 'a', label: 'A', summary: '', next: [], terminal: true }] },
    }
    expect(validateTemplateDefinition(broken).map((i) => i.code)).toContain('initial_phase_missing')
  })

  it('catches a graph with no way out', () => {
    const broken: LeagueTemplateDefinition = {
      ...base,
      phaseGraph: {
        initialPhaseId: 'a',
        phases: [
          { id: 'a', label: 'A', summary: '', next: ['b'] },
          { id: 'b', label: 'B', summary: '', next: ['a'] },
        ],
      },
    }
    expect(validateTemplateDefinition(broken).map((i) => i.code)).toContain('no_terminal_phase')
  })

  it('catches duplicate scheduled-effect ids', () => {
    /*
     * ⚠ THE EXPENSIVE ONE. Effect ids are part of the idempotency key, so two effects sharing an id
     * collide and one of them silently never plans.
     */
    const e = base.scheduledEffects[0]!
    const broken: LeagueTemplateDefinition = { ...base, scheduledEffects: [e, { ...e }] }
    expect(validateTemplateDefinition(broken).map((i) => i.code)).toContain('duplicate_effect_id')
  })

  it('catches a non-semver version', () => {
    expect(validateTemplateDefinition({ ...base, version: 'v1' }).map((i) => i.code)).toContain(
      'version_not_semver',
    )
  })
})

describe('both fixtures validate', () => {
  it.each(listTemplateVersions().map((t) => [`${t.id}@${t.version}`, t] as const))(
    '%s',
    (_key, t) => {
      expect(validateTemplateDefinition(t)).toEqual([])
    },
  )

  it('every scheduled effect names a known rule effect', () => {
    for (const t of listTemplateVersions()) {
      for (const e of t.scheduledEffects) {
        expect(RULE_EFFECTS[e.effect]).toBeDefined()
      }
    }
  })

  it('every PROOF FIXTURE may not execute, and the one executing template earns it', () => {
    /*
     * 🛑 THE BRIEF FORBIDS DEMO DATA PRESENTED AS COMPLETE. This asserted `false` for EVERY version
     * while all of them were fixtures. EFL 1.2.0 is the first with real execution paths — TRUE Max
     * PF, a durable freeze, and an applier that hands a settled plan to PromotionEngine — so the
     * assertion is now per version rather than blanket. Anything NOT on the allowlist must still be
     * false, which is what stops a fixture quietly flipping.
     */
    const mayExecute = new Set(['efl_promotion_relegation_dynasty@1.2.0'])
    for (const t of listTemplateVersions()) {
      const key = `${t.id}@${t.version}`
      expect({ key, executes: t.executionEnabled }).toEqual({ key, executes: mayExecute.has(key) })
    }
  })

  it('every fixture defaults to asking first', () => {
    for (const t of listTemplateVersions()) {
      expect(t.commissionerAutomationDefaults).toBe('ask_first')
    }
  })
})

describe('Survivor All-Stars Guillotine exposes BOTH survivor and guillotine capabilities', () => {
  const t = SURVIVOR_ALL_STARS_GUILLOTINE_V1

  it('is guillotine', () => {
    expect(t.baseFormatId).toBe('guillotine')
    expect(t.capabilityIds).toContain('elimination.guillotine')
    expect(t.capabilityIds).toContain('elimination.double')
  })

  it('is ALSO survivor, which no single-concept resolver can say', () => {
    expect(t.capabilityIds).toContain('survivor.tribes')
    expect(t.capabilityIds).toContain('survivor.match_play')
    expect(t.capabilityIds).toContain('survivor.tribe_champion')
    expect(t.capabilityIds).toContain('survivor.merge')
    expect(t.capabilityIds).toContain('survivor.final_placement')
  })

  it('carries powers, rewards, the schoolyard draft and the scheduled roster growth', () => {
    expect(t.capabilityIds).toContain('powers.idol')
    expect(t.capabilityIds).toContain('powers.swap_token')
    expect(t.capabilityIds).toContain('rewards.faab')
    expect(t.capabilityIds).toContain('draft.schoolyard')
    expect(t.capabilityIds).toContain('roster.scheduled_expansion')
    expect(t.capabilityIds).toContain('trades.disabled')
  })

  it('names every published phase', () => {
    expect(t.phaseGraph.phases.map((p) => p.id)).toEqual([
      'tribal_first',
      'tribe_shuffle',
      'tribal_second',
      'gauntlet_draft',
      'gauntlet',
      'merge',
      'merged_guillotine',
      'final_three',
    ])
  })

  it('takes two teams a week during the Gauntlet and one everywhere else', () => {
    expect(t.eliminationPolicy?.perPeriodByPhase?.gauntlet).toBe(2)
    expect(t.eliminationPolicy?.perPeriodByPhase?.tribal_first).toBe(1)
    expect(t.eliminationPolicy?.perPeriodByPhase?.merged_guillotine).toBe(1)
  })

  it('passes an elimination down rather than cancelling it', () => {
    expect(t.eliminationPolicy?.immunityPassesDown).toBe(true)
  })

  it('derives the roster expansions from the published schedule, not a second copy', () => {
    /*
     * ⚠ ONE TRUTH SOURCE. If `LINEUP_SCHEDULE` in lib/trade-intel/survivorGuillotine.ts gains or
     * moves an expansion, this fails rather than letting the template drift a week away from what
     * the FAAB pricing side reads.
     */
    const expansionWeeks = t.scheduledEffects
      .filter((e) => e.effect === 'ADD_ROSTER_SLOT' && e.at.kind === 'week')
      .map((e) => (e.at as { week: number }).week)
      .sort((a, b) => a - b)

    expect(expansionWeeks).toEqual(LINEUP_SCHEDULE.filter((s) => s.fromWeek > 1).map((s) => s.fromWeek))
    expect(expansionWeeks).toContain(SUPERFLEX_WEEK)
  })

  it('says out loud what it cannot do yet', () => {
    /*
     * The repo's own audit records generic Survivor as not production-safe. A fixture that omitted
     * that would read as a shipped feature.
     */
    const deferred = t.governancePolicy?.deferredModules ?? []
    expect(deferred.length).toBeGreaterThan(0)
    expect(deferred.join(' ')).toMatch(/blind mode|privacy/i)
  })
})

describe('EFL exposes dynasty and promotion/relegation capabilities', () => {
  const t = EFL_PROMOTION_RELEGATION_DYNASTY_V1

  it('is dynasty at the base, and does not stop there', () => {
    expect(t.baseFormatId).toBe('dynasty')
    expect(t.capabilityIds).toContain('roster.dynasty_carryover')
    expect(t.capabilityIds).toContain('standings.promotion_relegation')
    expect(t.capabilityIds).toContain('standings.tier_playoffs')
  })

  it('carries the frozen Reverse Max PF rule as a capability, not a comment', () => {
    expect(t.capabilityIds).toContain('standings.frozen_input')
    expect(t.draftPolicy?.frozenInput).toEqual({
      field: 'reverse_max_pf',
      frozenAt: 'regular_season_complete',
    })
    expect(t.draftPolicy?.rookieOrder).toBe('custom')
  })

  it('has four tiers, top-first', () => {
    expect(t.standingsPolicy?.tiers).toEqual([
      { level: 1, label: 'Premier League' },
      { level: 2, label: 'Championship' },
      { level: 3, label: 'League 1' },
      { level: 4, label: 'League 2' },
    ])
  })

  it('exempts the bottom tier from relegation and the top from promotion', () => {
    /*
     * ⚠ TIER 1 IS THE HIGHEST. `LeagueDivision.tierLevel` ascends downward and `PromotionEngine`
     * reads `fromTierLevel` as the division being relegated FROM. Getting this backwards relegates
     * the champions.
     */
    expect(t.standingsPolicy?.promotionRelegation?.noRelegationFromTierLevels).toEqual([4])
    expect(t.standingsPolicy?.promotionRelegation?.noPromotionFromTierLevels).toEqual([1])
  })

  it('splits each movement into an automatic slot and a playoff-decided one', () => {
    const pr = t.standingsPolicy?.promotionRelegation
    expect(pr?.autoRelegateCount).toBe(1)
    expect(pr?.relegationPlayoffCount).toBe(2)
    expect(pr?.autoPromoteCount).toBe(1)
    expect(pr?.promotionPlayoffCount).toBe(2)
  })

  it('records that the existing PromotionEngine cannot decide a playoff slot', () => {
    const deferred = (t.governancePolicy?.deferredModules ?? []).join(' ')
    expect(deferred).toMatch(/playoff-decided/i)
  })

  it('leaves its rules commissioner-configurable rather than hardcoding them', () => {
    const configurable = t.governancePolicy?.commissionerConfigurable ?? []
    expect(configurable).toContain('autoRelegateCount')
    expect(configurable).toContain('relegationPlayoffCount')
    expect(configurable).toContain('reverseMaxPfFreezeAt')
    expect(t.capabilityIds).toContain('governance.configurable_rules')
  })
})

describe('a pinned version is stable and never silently upgraded', () => {
  it('resolves the exact pin', () => {
    expect(resolveTemplate('survivor_all_stars_guillotine', '1.0.0')?.version).toBe('1.0.0')
    expect(resolveTemplateByKey('efl_promotion_relegation_dynasty@1.0.0')?.id).toBe(
      'efl_promotion_relegation_dynasty',
    )
  })

  it('returns null for an unknown VERSION of a known template', () => {
    /*
     * 🛑 THE CORE VERSIONING GUARANTEE. Substituting the one version we do have would change the
     * rules of a running season with no conflict, no error and no failing test.
     */
    expect(resolveTemplate('survivor_all_stars_guillotine', '2.0.0')).toBeNull()
  })

  it('returns null for an unknown template id', () => {
    expect(resolveTemplate('not_a_template', '1.0.0')).toBeNull()
  })

  it('returns null rather than guessing when either half is missing', () => {
    expect(resolveTemplate('survivor_all_stars_guillotine', null)).toBeNull()
    expect(resolveTemplate(null, '1.0.0')).toBeNull()
  })

  it('latestVersionOf answers a different question, for NEW leagues only', () => {
    /*
     * ⚠ THIS ASSERTED '1.0.0' UNTIL EFL 1.1.0 SHIPPED, WHICH MADE IT A TEST OF "there is one
     * version" rather than of the comparison. Now that two exist it tests the thing it was named
     * for — and note it must NEVER be used to decide what to run for a league already pinned to
     * 1.0.0; `resolveTemplate` with the league's own pin is that answer.
     */
    expect(latestVersionOf('efl_promotion_relegation_dynasty')?.version).toBe('1.2.0')
    expect(latestVersionOf('survivor_all_stars_guillotine')?.version).toBe('1.0.0')
  })

  it('compares versions numerically, so 1.10.0 would beat 1.9.0', () => {
    /*
     * 🛑 THE STRING-SORT HAZARD, PINNED. `'1.10.0' < '1.9.0'` lexically, so a string comparison
     * hands a NEW league the older ruleset — silently, and only once a tenth minor version exists.
     * Asserted against synthetic versions because the registry does not have one yet, which is
     * exactly when the bug would be introduced unnoticed.
     */
    const semverGreater = (a: string, b: string) => {
      const pa = a.split('.').map(Number)
      const pb = b.split('.').map(Number)
      for (let i = 0; i < 3; i += 1) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
      return false
    }
    expect(semverGreater('1.10.0', '1.9.0')).toBe(true)
    expect('1.10.0' > '1.9.0').toBe(false)
  })

  it('the fixture contents are frozen against accidental edits', () => {
    /*
     * ⚠ PINS THE CAPABILITY LIST OF A PUBLISHED VERSION. Editing a shipped version in place changes
     * the rules for every league pinned to it; the fix for a rules change is a NEW version entry.
     * This fails loudly if someone edits 1.0.0 instead of adding 1.1.0.
     */
    expect([...SURVIVOR_ALL_STARS_GUILLOTINE_V1.capabilityIds].sort()).toEqual([
      'draft.schoolyard',
      'elimination.double',
      'elimination.guillotine',
      'elimination.immunity',
      'phase.state_machine',
      'powers.idol',
      'powers.swap_token',
      'rewards.faab',
      'roster.scheduled_expansion',
      'survivor.final_placement',
      'survivor.match_play',
      'survivor.merge',
      'survivor.tribe_champion',
      'survivor.tribe_shuffle',
      'survivor.tribes',
      'trades.disabled',
    ])
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
})
