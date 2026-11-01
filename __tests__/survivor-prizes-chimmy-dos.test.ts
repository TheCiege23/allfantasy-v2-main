/**
 * Chimmy and Decision OS see the new rewards: the rules answers and rulebook explain the weekly
 * prizes and quote the house rules (English / Spanish), Chimmy's grounding line describes the
 * prizes, and Decision OS turns a manager's OWN reward state into attention signals.
 */
import { describe, expect, it } from 'vitest'
import { answerSurvivorRules, buildSurvivorRulebook, survivorRulesTopic } from '@/lib/survivor/survivorRulesAnswers'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { SURVIVOR_WEEKLY_PRIZE_DEFAULTS } from '@/lib/survivor/survivorWeeklyPrizes'
import { describeWeeklyPrizesForChimmy } from '@/lib/survivor/ai/survivorContextForChimmy'
import { deriveSurvivorAttentionSignals } from '@/lib/decision-os/survivorPrizeSignals'

const base = { sport: 'NFL', settings: normalizeSurvivorFoundationSettings({}), plan: null }
const prizes = { ...SURVIVOR_WEEKLY_PRIZE_DEFAULTS, winningTribeFaabPerPlayer: 100, topScorerReward: 'advantage' as const, tribeTieBreakPosition: 'QB' }

describe('rules answers', () => {
  it('routes prize and house-rules questions, leaving a vote-steal idol with idols', () => {
    expect(survivorRulesTopic('what are the weekly prizes?')).toBe('prizes')
    expect(survivorRulesTopic('how does the tie-breaker work?')).toBe('prizes')
    expect(survivorRulesTopic('what are the house rules?')).toBe('house_rules')
    expect(survivorRulesTopic('can I take screenshots?')).toBe('house_rules')
    expect(survivorRulesTopic('how does the vote steal idol work?')).toBe('idols')
  })

  it('explains this league’s prizes and quotes the house rules as written', () => {
    const answer = answerSurvivorRules('prizes', { ...base, prizes })
    expect(answer).toContain('$100 FAAB per player')
    expect(answer).toContain('starting QB scored more wins the tie')
    expect(answerSurvivorRules('house_rules', { ...base, houseRules: 'No screenshots.\n- Be kind.' })).toBe('**House rules (from the commissioner)**\n• No screenshots.\n• Be kind.')
    expect(answerSurvivorRules('house_rules', base)).toContain('has not written any house rules')
  })

  it('answers in Spanish for a Spanish league', () => {
    expect(answerSurvivorRules('prizes', { ...base, prizes, language: 'es' })).toContain('$100 de FAAB por jugador')
    expect(answerSurvivorRules('house_rules', { ...base, houseRules: 'Sé amable.', language: 'es' })).toContain('Reglas de la casa')
  })

  it('adds the prize and house-rules sections to the rulebook only when set', () => {
    expect(buildSurvivorRulebook(base).map((s) => s.topic)).not.toContain('prizes')
    const book = buildSurvivorRulebook({ ...base, prizes, houseRules: 'Be kind.' }).map((s) => s.topic)
    expect(book.indexOf('prizes')).toBe(book.indexOf('challenges') + 1)
    expect(book[book.length - 1]).toBe('house_rules')
  })
})

describe('Chimmy grounding', () => {
  it('describes the prizes in one line, or none', () => {
    expect(describeWeeklyPrizesForChimmy(SURVIVOR_WEEKLY_PRIZE_DEFAULTS)).toBe('none')
    expect(describeWeeklyPrizesForChimmy(prizes)).toBe('top-scoring tribe gets $100 FAAB per player; its top scorer wins an advantage (extra vote); tribe-total ties go to the tribe with the higher-scoring QB')
  })
})

describe('Decision OS survivor signals', () => {
  const now = new Date('2026-10-31T12:00:00Z')
  const r = (over: Record<string, unknown>) => ({ rewardId: 'k', type: 'faab_grant', status: 'applied', week: 6, applyWeek: 6, text: '$100 FAAB', sourceKind: 'weekly_prize', ...over })

  it('asks for a pending choice first, then a held free trade, then fresh wins', () => {
    const signals = deriveSurvivorAttentionSignals([{
      leagueId: 'L1', currentWeek: 6, rewards: [
        r({ rewardId: 'won' }),
        r({ rewardId: 'old', week: 2 }),
        r({ rewardId: 'pick', type: 'tribemate_points', status: 'awaiting_choice', sourceKind: 'challenge' }),
        r({ rewardId: 'trade', type: 'free_trade_token', status: 'available' }),
        r({ rewardId: 'gone', type: 'free_trade_token', status: 'consumed' }),
      ],
    }], now)
    expect(signals.map((s) => [s.id, s.severity, s.title])).toEqual([
      ['survivor_reward:L1:won:applied', 'informational', 'Your tribe won FAAB'],
      ['survivor_reward:L1:pick:awaiting_choice', 'high', 'Choose who gets your Survivor reward'],
      ['survivor_reward:L1:trade:available', 'medium', 'You hold a free trade'],
    ])
    expect(signals.every((s) => s.type === 'survivor_reward' && s.source === 'survivor' && s.leagueId === 'L1')).toBe(true)
  })

  it('speaks Spanish for a Spanish league', () => {
    const [s] = deriveSurvivorAttentionSignals([{ leagueId: 'L1', currentWeek: 6, language: 'es', rewards: [r({})] }], now)
    expect(s.title).toBe('Tu tribu ganó FAAB')
  })
})
