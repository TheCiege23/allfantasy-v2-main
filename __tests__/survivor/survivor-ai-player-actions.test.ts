import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Three paid player actions now have code behind them: an idol timing plan, jury management and a
 * weekly game plan. Each is a player helper (no commissioner check), charges its own price rule on
 * the server, and is written from the viewer's already-filtered context: their own idols, public
 * jury and tribe data, never another manager's idol or anyone's vote.
 */

const h = vi.hoisted(() => ({ gate: vi.fn(), role: vi.fn() }))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({ requireFeatureEntitlement: h.gate }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: h.role }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({ EntitlementResolver: class { resolveSnapshot = vi.fn(async () => ({})) } }))

import { resolveSurvivorAiAccess, SURVIVOR_AI_VALID_TYPES } from '@/lib/survivor/survivor-ai-route-guard'
import { SURVIVOR_AI_TYPE_RULE_CODE, SURVIVOR_SOLD_AI_ACTIONS } from '@/lib/survivor/survivor-ai-token-catalog'
import { SURVIVOR_AI_MAX_TOKENS, buildSurvivorAIPrompt } from '@/lib/survivor/ai/SurvivorAIPrompts'
import type { SurvivorAIDeterministicContext } from '@/lib/survivor/ai/SurvivorAIContext'
import { getTokenSpendRuleMatrixEntry } from '@/lib/tokens/pricing-matrix'

const NEW_ACTIONS = [
  ['idol_timing_help', 'survivor_ai_idol_timing'],
  ['jury_help', 'survivor_ai_jury_management'],
  ['weekly_plan', 'survivor_ai_weekly_advice_pack'],
] as const

beforeEach(() => {
  h.gate.mockReset().mockResolvedValue({ ok: true, decision: { allowed: true }, tokenSpend: { id: 'ledger-1', balanceAfter: 70 }, tokenPreview: { tokenCost: 30 } })
  h.role.mockReset()
})

describe('the server charges each new action its own rule', () => {
  it.each(NEW_ACTIONS)('%s is a player helper charged %s, metered even on a plan', async (type, ruleCode) => {
    expect(SURVIVOR_AI_VALID_TYPES).toContain(type)
    expect(SURVIVOR_AI_TYPE_RULE_CODE[type]).toBe(ruleCode)
    const result = await resolveSurvivorAiAccess({ userId: 'u1', userEmail: null, leagueId: 'lg', type, confirmTokenSpend: true })
    expect(result).toMatchObject({ ok: true, ruleCode, tokenSpend: { id: 'ledger-1' } })
    expect(h.role).not.toHaveBeenCalled()
    expect(h.gate).toHaveBeenCalledWith(expect.objectContaining({
      featureId: 'survivor_ai', tokenRuleCode: ruleCode, confirmTokenSpend: true,
      // 30 tokens is above the 2-token line, so a subscriber pays too, after confirming.
      forceTokenFallback: true,
    }))
    expect(getTokenSpendRuleMatrixEntry(ruleCode)?.tokenCost).toBe(30)
  })

  it('the price list sells them at the price the route charges', () => {
    for (const [type, ruleCode] of NEW_ACTIONS) {
      expect(SURVIVOR_SOLD_AI_ACTIONS.find((a) => a.aiType === type)).toMatchObject({ lane: 'player', ruleCode, tokenCost: 30 })
    }
  })

  it('[control] an unknown type is refused before anything is charged', async () => {
    const result = await resolveSurvivorAiAccess({ userId: 'u1', userEmail: null, leagueId: 'lg', type: 'idol_peek' as never, confirmTokenSpend: true })
    expect(result.ok).toBe(false)
    expect(h.gate).not.toHaveBeenCalled()
  })
})

const deadline = new Date('2026-10-29T23:00:00Z')

function ctx(over: Partial<SurvivorAIDeterministicContext> = {}): SurvivorAIDeterministicContext {
  return {
    leagueId: 'lg', sport: 'NFL', currentWeek: 8,
    config: { mode: 'redraft', tribeCount: 2, tribeSize: 6, mergeTrigger: 'week', mergeWeek: 9, mergePlayerCount: null, juryStartAfterMerge: true, exileReturnEnabled: true, exileReturnTokens: 3, voteDeadlineDayOfWeek: null, voteDeadlineTimeUtc: null, selfVoteDisallowed: true },
    tribes: [{ id: 't1', name: 'Fire', slotIndex: 0, members: [{ rosterId: 'r-me', isLeader: false }, { rosterId: 'r-bo', isLeader: false }] }],
    council: { id: 'c1', week: 8, phase: 'voting', attendingTribeId: 't1', voteDeadlineAt: new Date('2026-10-30T05:00:00Z'), closedAt: null, eliminatedRosterId: null },
    challenges: [], jury: [{ rosterId: 'r-cy', votedOutWeek: 7 }], exileLeagueId: null, exileTokens: [],
    votedOutHistory: [{ rosterId: 'r-cy', week: 7 }], merged: false,
    rosterDisplayNames: { 'r-me': 'Ana FC', 'r-bo': 'Bo United', 'r-cy': 'Cy City' },
    myRosterId: 'r-me', myIdols: [{ id: 'i1', playerId: 'p1', powerType: 'immunity_idol' }], myActiveEffects: [], myExileStatus: null,
    idolRules: { playDeadlineAt: deadline, cutoffText: 'Idols must be played at least 6 hours before votes close.', expiryText: 'Idols expire when 5 players remain.' },
    finale: null,
    ...over,
  }
}

describe('the prompts use only what the viewer may see', () => {
  it('idol timing: the manager\'s own idols, the exact deadline, the cutoff and the expiry rule', () => {
    const { system, user } = buildSurvivorAIPrompt(ctx(), 'idol_timing_help')
    expect(user).toContain("User's idols: immunity_idol.")
    expect(user).toContain(deadline.toISOString())
    expect(user).toContain('at least 6 hours before votes close')
    expect(user).toContain('Idols expire when 5 players remain.')
    expect(system).toMatch(/never know or guess which other managers hold idols/)
  })

  it('idol timing with no open council says there is no deadline instead of inventing one', () => {
    const { user } = buildSurvivorAIPrompt(ctx({ idolRules: { playDeadlineAt: null, cutoffText: null, expiryText: 'Idols expire at the merge.' } }), 'idol_timing_help')
    expect(user).toContain('no idol deadline right now')
    expect(user).toContain('Idols can be played until votes close.')
  })

  it('jury: the public jury with when each left, and never a juror\'s vote', () => {
    const { system, user } = buildSurvivorAIPrompt(ctx(), 'jury_help')
    expect(user).toContain('Jury so far: Cy City (out week 7).')
    expect(system).toMatch(/never know how any juror will vote or has voted/)
  })

  it('weekly plan: five headed sections, with room to write them', () => {
    const { system, user } = buildSurvivorAIPrompt(ctx(), 'weekly_plan')
    for (const section of ['Where you stand', "This week's council", 'Challenges', 'Idols', 'Long game']) expect(system).toContain(section)
    expect(user).toContain(deadline.toISOString())
    expect(SURVIVOR_AI_MAX_TOKENS.weekly_plan).toBe(1000)
  })
})
