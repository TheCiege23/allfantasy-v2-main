import { describe, expect, it } from 'vitest'

import { planTemplateActions } from '@/lib/commissioner-os/template/planTemplateActions'
import { resolveCommissionerLeagueProfile } from '@/lib/commissioner-os/profile/resolveCommissionerLeagueProfile'
import { SURVIVOR_ALL_STARS_GUILLOTINE_V1 } from '@/lib/commissioner-os/template/definitions/survivorAllStarsGuillotine'
import { EFL_PROMOTION_RELEGATION_DYNASTY_V1 } from '@/lib/commissioner-os/template/definitions/eflPromotionRelegationDynasty'
import { resolveActionAuthority } from '@/lib/commissioner-os/authority'
import type { CommissionerLeagueRow } from '@/lib/commissioner-os/profile/resolveCommissionerLeagueProfile'

/**
 * Phase C5 — the template runtime: determinism, idempotency and the execute/prepare/verify split.
 */

function leagueRow(over: Partial<CommissionerLeagueRow> = {}): CommissionerLeagueRow {
  return {
    id: 'league-sasg',
    sport: 'NFL',
    season: 2026,
    leagueType: 'guillotine',
    settings: {
      conceptRules: {
        extensions: {
          commissionerTemplate: { id: 'survivor_all_stars_guillotine', version: '1.0.0' },
        },
      },
    },
    platform: 'allfantasy',
    status: 'active',
    lifecycleState: 'in_season',
    ...over,
  }
}

const profile = (over: Partial<CommissionerLeagueRow> = {}) =>
  resolveCommissionerLeagueProfile({ league: leagueRow(over), commissionerRole: 'commissioner' })

const planSeason = (over: Partial<CommissionerLeagueRow> = {}) =>
  planTemplateActions({
    profile: profile(over),
    template: SURVIVOR_ALL_STARS_GUILLOTINE_V1,
    trigger: 'onManualRun',
    season: 2026,
  })

describe('planning is deterministic', () => {
  it('the same inputs produce byte-identical output', () => {
    expect(JSON.stringify(planSeason())).toBe(JSON.stringify(planSeason()))
  })

  it('output order is a function of the schedule, not of declaration order', () => {
    /*
     * ⚠ Reordering a template's `scheduledEffects` array is an editorial change and must not change
     * a plan. Sorting by (week, effectId, occurrence) is what makes that true.
     */
    const shuffled = {
      ...SURVIVOR_ALL_STARS_GUILLOTINE_V1,
      scheduledEffects: [...SURVIVOR_ALL_STARS_GUILLOTINE_V1.scheduledEffects].reverse(),
    }
    const a = planTemplateActions({ profile: profile(), template: SURVIVOR_ALL_STARS_GUILLOTINE_V1, trigger: 'onManualRun', season: 2026 })
    const b = planTemplateActions({ profile: profile(), template: shuffled, trigger: 'onManualRun', season: 2026 })
    expect(a.actions.map((x) => x.idempotencyKey)).toEqual(b.actions.map((x) => x.idempotencyKey))
  })

  it('plans no dice roll of its own — the random shuffle demands a seed from its executor', () => {
    const shuffle = planSeason().actions.find((a) => a.effectId === 'sasg.shuffle_tribes_wk7')
    expect(shuffle).toBeDefined()
    expect(shuffle!.metadata.seedRequired).toBe(true)
  })
})

describe('idempotency keys are stable and correctly scoped', () => {
  const keys = planSeason().actions.map((a) => a.idempotencyKey)

  it('every key is unique', () => {
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('a key carries league, season, pinned version, effect and occurrence', () => {
    const one = planSeason().actions.find((a) => a.effectId === 'sasg.expand_lineup_wk9')!
    expect(one.idempotencyKey).toBe(
      'commissioner-os:league-sasg:2026:survivor_all_stars_guillotine@1.0.0:sasg.expand_lineup_wk9:w9',
    )
  })

  it('a different season produces different keys', () => {
    const other = planTemplateActions({
      profile: profile(),
      template: SURVIVOR_ALL_STARS_GUILLOTINE_V1,
      trigger: 'onManualRun',
      season: 2027,
    })
    expect(other.actions.map((a) => a.idempotencyKey)).not.toEqual(keys)
  })

  it('the same effect reached through a different trigger keeps the SAME key', () => {
    /*
     * 🛑 DELIBERATE, AND THE OPPOSITE OF `buildIdempotencyKey` IN THE SPECIALTY PIPELINE. There the
     * unit is one automation PASS, so the trigger belongs in the key. Here the unit is "this
     * scheduled effect, once per season" — including the trigger would let a manual re-run plan a
     * week-11 elimination a second time under a fresh key.
     */
    const viaWeek = planTemplateActions({
      profile: profile(),
      template: SURVIVOR_ALL_STARS_GUILLOTINE_V1,
      trigger: 'onWeekFinalized',
      season: 2026,
    })
    expect(viaWeek.actions.map((a) => a.idempotencyKey)).toEqual(keys)
  })

  it('the recurring Gauntlet elimination gets one key per week, not one for all three', () => {
    /*
     * ⚠ COLLAPSING THESE IS NOT A DUPLICATE-SUPPRESSION WIN — IT IS SIX TEAMS THAT NEVER LEAVE.
     */
    const gauntlet = planSeason().actions.filter((a) => a.effectId === 'sasg.gauntlet_double_elimination')
    expect(gauntlet.map((a) => a.occurrence)).toEqual(['w11', 'w12', 'w13'])
    expect(new Set(gauntlet.map((a) => a.idempotencyKey)).size).toBe(3)
  })
})

describe('planning is scoped to what is due', () => {
  it('a week query returns only that week', () => {
    const plan = planTemplateActions({
      profile: profile(),
      template: SURVIVOR_ALL_STARS_GUILLOTINE_V1,
      trigger: 'onWeekFinalized',
      season: 2026,
      week: 9,
    })
    expect(plan.actions.map((a) => a.effectId)).toEqual(['sasg.expand_lineup_wk9'])
  })

  it('a phase query returns that phase entry', () => {
    const plan = planTemplateActions({
      profile: profile(),
      template: SURVIVOR_ALL_STARS_GUILLOTINE_V1,
      trigger: 'onPhaseTransition',
      season: 2026,
      currentPhaseId: 'merge',
    })
    expect(plan.actions.map((a) => a.effectId)).toEqual(['sasg.merge_tribes'])
  })
})

describe('a read-only provider cannot execute, and says so honestly', () => {
  const sleeper = planSeason({ platform: 'sleeper' })

  it('nothing in the plan is executable', () => {
    expect(sleeper.actions.every((a) => a.executable === false)).toBe(true)
  })

  it('a roster effect is refused execution and names the system of record', () => {
    const expand = sleeper.actions.find((a) => a.effectId === 'sasg.expand_lineup_wk7')!
    expect(expand.authority.mode).toBe('SHADOW')
    expect(expand.authority.canExecute).toBe(false)
    expect(expand.authority.blockedReason).toContain('Sleeper')
  })

  it('an AllFantasy-owned effect is NOT blocked by the platform', () => {
    /*
     * ⚠ A TRIBE HAS NO COUNTERPART ON ANY HOST PLATFORM, so AF owns it outright even on an imported
     * league. `canExecute` here is the AUTHORITY verdict; the action is still not `executable`,
     * because the template forbids execution and the effect has no engine.
     */
    const merge = sleeper.actions.find((a) => a.effectId === 'sasg.merge_tribes')!
    expect(merge.authority.canExecute).toBe(true)
    expect(merge.executable).toBe(false)
  })
})

describe('a read-only provider can still prepare supported guidance', () => {
  const sleeper = planSeason({ platform: 'sleeper' })

  it('roster expansions are prepared, and verifiable on the next sync', () => {
    const expand = sleeper.actions.find((a) => a.effectId === 'sasg.expand_lineup_wk11')!
    expect(expand.authority.canPrepare).toBe(true)
    expect(expand.authority.canVerify).toBe(true)
  })

  it('an effect the template calls unsupported is NOT offered as prepared', () => {
    /*
     * Reward FAAB on an imported league would be arithmetic on a balance AllFantasy cannot see.
     */
    const authority = resolveActionAuthority({
      platform: 'sleeper',
      scope: 'external',
      verifiableFromImport: true,
      preparable: false,
    })
    expect(authority.canPrepare).toBe(false)
    expect(authority.canExecute).toBe(false)
  })

  it('an unobservable effect reports canVerify false rather than implying we will notice', () => {
    const authority = resolveActionAuthority({
      platform: 'sleeper',
      scope: 'external',
      verifiableFromImport: false,
    })
    expect(authority.canVerify).toBe(false)
  })
})

describe('a non-executing template cannot be made to execute', () => {
  it('not even on a native league where authority allows it', () => {
    const native = planSeason({ platform: 'allfantasy' })
    expect(native.executionEnabled).toBe(false)
    expect(native.actions.some((a) => a.executable)).toBe(false)
    expect(native.warnings.join(' ')).toMatch(/non-executing/i)
  })

  it('an effect with a real engine is still refused while the fixture flag is off', () => {
    /*
     * 🛑 THREE INDEPENDENT CONDITIONS. `ELIMINATE_ROSTER` has a genuine engine
     * (GuillotineEliminationEngine) and a native league grants authority — and it is still not
     * executable, because the template is a fixture.
     */
    const native = planSeason({ platform: 'allfantasy' })
    const elim = native.actions.find((a) => a.effectType === 'ELIMINATE_ROSTER')!
    expect(elim.authority.canExecute).toBe(true)
    expect(elim.metadata.executorStatus).toBe('engine')
    expect(elim.executable).toBe(false)
  })
})

describe('planned actions stay readable by the existing specialty pipeline', () => {
  it('reuses the action-type strings that pipeline already persists', () => {
    const plan = planSeason()
    const byEffect = new Map(plan.actions.map((a) => [a.effectType, a.actionType]))
    expect(byEffect.get('ELIMINATE_ROSTER')).toBe('eliminate_roster')
    expect(byEffect.get('RELEASE_ROSTER')).toBe('release_to_waiver_pool')
    expect(byEffect.get('CREATE_COMMISSIONER_TASK')).toBe('commissioner_task')
  })

  it('EFL reuses the promote/relegate strings', () => {
    const eflProfile = resolveCommissionerLeagueProfile({
      league: leagueRow({
        id: 'league-efl',
        leagueType: 'dynasty',
        isDynasty: true,
        settings: {
          conceptRules: {
            extensions: {
              commissionerTemplate: { id: 'efl_promotion_relegation_dynasty', version: '1.0.0' },
            },
          },
        },
      }),
      commissionerRole: 'commissioner',
    })
    const plan = planTemplateActions({
      profile: eflProfile,
      template: EFL_PROMOTION_RELEGATION_DYNASTY_V1,
      trigger: 'onManualRun',
      season: 2026,
    })
    const types = plan.actions.map((a) => a.actionType)
    expect(types).toContain('promote_team')
    expect(types).toContain('relegate_team')
  })
})

describe('an incompatible sport skips the whole plan', () => {
  it('rather than planning an NFL week schedule against an NBA season', () => {
    const plan = planTemplateActions({
      profile: profile({ sport: 'NBA' }),
      template: SURVIVOR_ALL_STARS_GUILLOTINE_V1,
      trigger: 'onManualRun',
      season: 2026,
    })
    expect(plan.skipped).toBe(true)
    expect(plan.actions).toEqual([])
    expect(plan.skipReason).toContain('NBA')
  })
})
