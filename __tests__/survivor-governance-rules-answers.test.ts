import { describe, expect, it } from 'vitest'
import { answerSurvivorRules, buildSurvivorRulebook, isSurvivorChimmyAsk, survivorRulesTopic } from '@/lib/survivor/survivorRulesAnswers'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/normalizeSurvivorSettings'
import { SURVIVOR_GOVERNANCE_DEFAULTS } from '@/lib/survivor/survivorGovernanceSettings'

const settings = normalizeSurvivorFoundationSettings({})
const governance = { ...SURVIVOR_GOVERNANCE_DEFAULTS, tradeRulesEnabled: true, alliancesEnabled: true, allianceMaxSize: 3, weeklyTradeFreezeEnabled: true, swapSchedule: [{ week: 5, mode: 'return_to_original' as const }] }
const ctx = { sport: 'NFL', settings, plan: null, governance }

describe('Chimmy answers the governance rules', () => {
  it('routes trade, strike, alliance and swap questions to their topics', () => {
    expect(survivorRulesTopic('@chimmy can I trade with another tribe after tribal?')).toBe('trades')
    expect(survivorRulesTopic('what are the trade rules?')).toBe('trades')
    expect(survivorRulesTopic('how many strikes until I am removed?')).toBe('strikes')
    expect(survivorRulesTopic('how do alliances work?')).toBe('alliances')
    expect(survivorRulesTopic('when is the next tribe swap?')).toBe('swaps')
    expect(survivorRulesTopic('¿cuáles son las reglas de cambios?')).toBe('trades')
    expect(isSurvivorChimmyAsk('how many strikes do I have?')).toBe(true)
    // A plain fantasy trade question is not pulled away from general Chimmy.
    expect(survivorRulesTopic('should I trade Bijan for Chase?')).toBeNull()
  })

  it('trade rules from this league’s settings', () => {
    const answer = answerSurvivorRules('trades', ctx)
    expect(answer).toContain('Trades between tribes open after Tribal Council (Tuesday 8:00 PM ET) and close Thursday 7:00 PM ET each week.')
    expect(answer).toContain('cannot be traded until after Tribal Council')
    expect(answer).toContain('Trades freeze Saturday 11:59 PM ET')
    expect(answerSurvivorRules('trades', { ...ctx, governance: SURVIVOR_GOVERNANCE_DEFAULTS })).toContain('no extra Survivor trade rules')
  })

  it('alliances, strikes and swaps, in Spanish when the league is', () => {
    expect(answerSurvivorRules('alliances', ctx)).toContain('up to 3 castaways')
    expect(answerSurvivorRules('alliances', ctx)).toContain('Chimmy never joins an alliance.')
    expect(answerSurvivorRules('strikes', ctx)).toContain('At 2 strikes the commissioner decides')
    expect(answerSurvivorRules('swaps', ctx)).toContain('after week 5')
    expect(answerSurvivorRules('alliances', { ...ctx, language: 'es' })).toContain('Chimmy nunca se une a una alianza.')
    expect(answerSurvivorRules('strikes', { ...ctx, language: 'es-MX' })).toMatch(/^\*\*Conducta\*\*/)
  })

  it('the rulebook adds the sections a league uses, and nothing for a context without governance', () => {
    const topics = buildSurvivorRulebook(ctx).map((s) => s.topic)
    expect(topics.slice(-4)).toEqual(['trades', 'alliances', 'swaps', 'strikes'])
    expect(buildSurvivorRulebook({ sport: 'NFL', settings, plan: null }).map((s) => s.topic)).not.toContain('strikes')
  })
})
