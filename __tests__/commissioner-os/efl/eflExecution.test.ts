import { beforeEach, describe, expect, it, vi } from 'vitest'

/* `vi.mock` is hoisted above every top-level const, so the fn must be too. */
const { runPromotionRelegationMock } = vi.hoisted(() => ({ runPromotionRelegationMock: vi.fn() }))

vi.mock('@/lib/promotion-relegation/PromotionEngine', () => ({
  runPromotionRelegation: runPromotionRelegationMock,
}))

import { applyEflSeasonTransitions } from '@/lib/commissioner-os/efl/applyEflSeasonTransitions'
import { EFL_PROMOTION_RELEGATION_DYNASTY_V1_1 } from '@/lib/commissioner-os/template/definitions/eflPromotionRelegationDynastyV1_1'
import { EFL_PROMOTION_RELEGATION_DYNASTY_V1_2 } from '@/lib/commissioner-os/template/definitions/eflPromotionRelegationDynastyV1_2'
import { latestVersionOf, listVersionsOf, resolveTemplate } from '@/lib/commissioner-os/template/registry'
import { validateTemplateDefinition } from '@/lib/commissioner-os/template/types'
import { planTemplateActions } from '@/lib/commissioner-os/template/planTemplateActions'
import { resolveCommissionerLeagueProfile } from '@/lib/commissioner-os/profile/resolveCommissionerLeagueProfile'
import { RULE_EFFECTS } from '@/lib/commissioner-os/ruleEffects'
import { ALL_OUTCOMES, ALL_TIERS } from './fixtures'

/**
 * EFL execution: the resolver hands a SETTLED plan to the canonical engine, and the template only
 * claims what is now real.
 */

beforeEach(() => {
  runPromotionRelegationMock.mockReset()
  runPromotionRelegationMock.mockResolvedValue({
    leagueId: 'efl-1',
    applied: true,
    transitions: [],
    source: 'supplied',
  })
})

describe('the applier refuses anything that is not settled', () => {
  it('🛑 does not call the engine while a playoff is outstanding', async () => {
    const result = await applyEflSeasonTransitions({
      leagueId: 'efl-1',
      season: 2026,
      tiers: ALL_TIERS,
      playoffOutcomes: [],
    })
    expect(result.applied).toBeNull()
    expect(result.refusedReason).toMatch(/no recorded result/i)
    expect(runPromotionRelegationMock).not.toHaveBeenCalled()
  })

  it('names WHICH playoff is outstanding rather than saying "not ready"', async () => {
    const result = await applyEflSeasonTransitions({
      leagueId: 'efl-1',
      season: 2026,
      tiers: ALL_TIERS,
      playoffOutcomes: ALL_OUTCOMES.filter((o) => o.tierLevel !== 3),
    })
    expect(result.refusedReason).toMatch(/League 1/)
  })

  it('does not call the engine when the inputs contradict each other', async () => {
    const result = await applyEflSeasonTransitions({
      leagueId: 'efl-1',
      season: 2026,
      tiers: ALL_TIERS,
      playoffOutcomes: [
        ...ALL_OUTCOMES.filter((o) => !(o.kind === 'promotion' && o.tierLevel === 4)),
        /* The team that finished first went up automatically; it never played in the playoff. */
        { kind: 'promotion', tierLevel: 4, winnerTeamId: 't4-1', loserTeamId: 't4-3' },
      ],
    })
    expect(result.applied).toBeNull()
    expect(result.refusedReason).toMatch(/did not qualify/i)
    expect(runPromotionRelegationMock).not.toHaveBeenCalled()
  })
})

describe('a settled plan reaches the canonical engine unchanged', () => {
  it('hands over exactly the twelve settled transitions', async () => {
    const result = await applyEflSeasonTransitions({
      leagueId: 'efl-1',
      season: 2026,
      tiers: ALL_TIERS,
      playoffOutcomes: ALL_OUTCOMES,
    })

    expect(result.refusedReason).toBeNull()
    expect(runPromotionRelegationMock).toHaveBeenCalledTimes(1)
    const call = runPromotionRelegationMock.mock.calls[0]![0]
    expect(call.leagueId).toBe('efl-1')
    expect(call.transitions).toHaveLength(12)
    expect(call.transitions).toEqual(result.plan.finalTransitions)
  })

  it('passes dryRun straight through', async () => {
    await applyEflSeasonTransitions({
      leagueId: 'efl-1',
      season: 2026,
      tiers: ALL_TIERS,
      playoffOutcomes: ALL_OUTCOMES,
      dryRun: true,
    })
    expect(runPromotionRelegationMock.mock.calls[0]![0].dryRun).toBe(true)
  })

  it('never asks the engine to compute anything — no rules travel with the plan', async () => {
    await applyEflSeasonTransitions({
      leagueId: 'efl-1',
      season: 2026,
      tiers: ALL_TIERS,
      playoffOutcomes: ALL_OUTCOMES,
    })
    const call = runPromotionRelegationMock.mock.calls[0]![0]
    expect(Object.keys(call).sort()).toEqual(['dryRun', 'leagueId', 'transitions'])
  })
})

describe('template 1.2.0 exists beside 1.1.0 and neither was edited', () => {
  it('1.1.0 still froze the WRONG metric, and still says so', () => {
    /*
     * 🛑 THE POINT OF PINNING. 1.1.0 froze points ACTUALLY SCORED. A league pinned to it must keep
     * reading that contract, not a retroactively corrected one.
     */
    expect(EFL_PROMOTION_RELEGATION_DYNASTY_V1_1.defaultSettings.reverseMaxPfMetric).toBe(
      'regular_season_points_for',
    )
    expect(EFL_PROMOTION_RELEGATION_DYNASTY_V1_1.executionEnabled).toBe(false)
  })

  it('1.2.0 freezes TRUE Max PF', () => {
    expect(EFL_PROMOTION_RELEGATION_DYNASTY_V1_2.defaultSettings.reverseMaxPfMetric).toBe(
      'optimal_lineup_max_pf',
    )
    expect(EFL_PROMOTION_RELEGATION_DYNASTY_V1_2.draftPolicy?.frozenInput).toEqual({
      field: 'optimal_lineup_max_pf',
      frozenAt: 'regular_season_complete',
    })
  })

  it('validates, and all three versions are registered', () => {
    expect(validateTemplateDefinition(EFL_PROMOTION_RELEGATION_DYNASTY_V1_2)).toEqual([])
    expect(listVersionsOf('efl_promotion_relegation_dynasty').map((t) => t.version)).toEqual([
      '1.0.0',
      '1.1.0',
      '1.2.0',
    ])
    expect(resolveTemplate('efl_promotion_relegation_dynasty', '1.1.0')?.version).toBe('1.1.0')
    expect(latestVersionOf('efl_promotion_relegation_dynasty')?.version).toBe('1.2.0')
  })

  it('is a standalone object, so editing one version cannot rewrite another', () => {
    expect(EFL_PROMOTION_RELEGATION_DYNASTY_V1_2.scheduledEffects).not.toBe(
      EFL_PROMOTION_RELEGATION_DYNASTY_V1_1.scheduledEffects,
    )
  })

  it('capabilities are unchanged, so what the league IS did not move', () => {
    expect([...EFL_PROMOTION_RELEGATION_DYNASTY_V1_2.capabilityIds].sort()).toEqual(
      [...EFL_PROMOTION_RELEGATION_DYNASTY_V1_1.capabilityIds].sort(),
    )
  })
})

describe('1.2.0 execution claims are true, effect by effect', () => {
  const byId = new Map(EFL_PROMOTION_RELEGATION_DYNASTY_V1_2.scheduledEffects.map((e) => [e.id, e]))

  const profile = (platform: string) =>
    resolveCommissionerLeagueProfile({
      league: {
        id: 'efl-1',
        sport: 'NFL',
        season: 2026,
        leagueType: 'dynasty',
        isDynasty: true,
        platform,
        settings: {
          conceptRules: {
            extensions: { commissionerTemplate: { id: 'efl_promotion_relegation_dynasty', version: '1.2.0' } },
          },
        },
      },
      commissionerRole: 'commissioner',
    })

  const planFor = (platform: string) =>
    planTemplateActions({
      profile: profile(platform),
      template: EFL_PROMOTION_RELEGATION_DYNASTY_V1_2,
      trigger: 'onManualRun',
      season: 2026,
    })

  it('promote/relegate are restored to `engine` now that an applier exists', () => {
    expect(EFL_PROMOTION_RELEGATION_DYNASTY_V1_1.scheduledEffects.find((e) => e.id === 'efl.apply_promotions')!.backedBy?.status).toBe('planned')
    expect(byId.get('efl.apply_promotions')!.backedBy?.status).toBe('engine')
    expect(byId.get('efl.apply_relegations')!.backedBy?.status).toBe('engine')
  })

  it('🛑 the rookie order stays `planned` because Sleeper is read-only, not because it is unfinished', () => {
    const e = byId.get('efl.publish_rookie_order')!
    expect(e.backedBy?.status).toBe('planned')
    expect(e.backedBy?.note).toMatch(/human action/i)
  })

  it('the freeze names its unapplied migration as a runtime dependency', () => {
    const e = byId.get('efl.freeze_reverse_max_pf')!
    expect(e.backedBy?.status).toBe('engine')
    expect(e.backedBy?.note).toMatch(/migrations-pending/)
    expect((EFL_PROMOTION_RELEGATION_DYNASTY_V1_2.governancePolicy?.deferredModules ?? []).join(' ')).toMatch(
      /DEPLOY DEPENDENCY/,
    )
  })

  it('executionEnabled is true, and the rookie-order effect is STILL not executable', () => {
    /*
     * 🛑 THREE INDEPENDENT CONDITIONS. Flipping the template flag does not make a `planned` effect
     * executable — which is exactly why flipping it is safe.
     */
    const native = planFor('allfantasy')
    expect(native.executionEnabled).toBe(true)
    expect(native.actions.find((a) => a.effectId === 'efl.apply_promotions')!.executable).toBe(true)
    expect(native.actions.find((a) => a.effectId === 'efl.publish_rookie_order')!.executable).toBe(false)
    expect(native.actions.find((a) => a.effectId === 'efl.announce_final_tiers')!.executable).toBe(false)
  })

  it('🛑 a Sleeper league can still execute the AllFantasy-owned effects, and writes nothing external', () => {
    /*
     * Tier membership is an AllFantasy construct — the source Sleeper league is one flat 32-team
     * league. So promotion/relegation execute for real HERE, and nothing in the plan is external.
     */
    const sleeper = planFor('sleeper')
    expect(profile('sleeper').writeAuthority).toBe('SHADOW')
    for (const a of sleeper.actions) expect(RULE_EFFECTS[a.effectType].scope).toBe('internal')
    expect(sleeper.actions.find((a) => a.effectId === 'efl.apply_relegations')!.executable).toBe(true)
    expect(sleeper.actions.find((a) => a.effectId === 'efl.publish_rookie_order')!.executable).toBe(false)
  })

  it('the rookie order is prepared for a human and never reported as applied to Sleeper', () => {
    const draft = planFor('sleeper').actions.find((a) => a.effectId === 'efl.publish_rookie_order')!
    expect(draft.authority.canPrepare).toBe(true)
    expect(draft.executable).toBe(false)
    expect(
      EFL_PROMOTION_RELEGATION_DYNASTY_V1_2.externalPlatformBehavior.notes!.join(' '),
    ).toMatch(/cannot set it, and must never say it did/i)
  })

  it('1.1.0 and 1.2.0 produce different idempotency keys for the same effect', () => {
    const shared = { profile: profile('allfantasy'), trigger: 'onManualRun' as const, season: 2026 }
    const a = planTemplateActions({ ...shared, template: EFL_PROMOTION_RELEGATION_DYNASTY_V1_1 })
    const b = planTemplateActions({ ...shared, template: EFL_PROMOTION_RELEGATION_DYNASTY_V1_2 })
    const keyOf = (plan: typeof a) =>
      plan.actions.find((x) => x.effectId === 'efl.apply_promotions')!.idempotencyKey
    expect(keyOf(a)).toContain('@1.1.0')
    expect(keyOf(b)).toContain('@1.2.0')
  })
})
