// @vitest-environment node
/**
 * The challenge builder's wiring: ONE command-center argument carrying every Survivor signal source
 * (one failing source never costs the others), Chimmy's weekly report line, the rules answer, and
 * the real-game settings block.
 */
import { describe, expect, it, vi } from 'vitest'

const src = vi.hoisted(() => ({ rewards: vi.fn(), finale: vi.fn(), challenges: vi.fn() }))
vi.mock('@/lib/survivor/survivorDecisionSignals', () => ({ loadSurvivorDecisionSignals: src.rewards }))
vi.mock('@/lib/survivor/survivorFinaleSignalsLoader', () => ({ loadSurvivorFinaleSignals: src.finale }))
vi.mock('@/lib/survivor/survivorChallengeSignalsLoader', () => ({ loadSurvivorChallengeSignals: src.challenges }))

import { loadSurvivorFormatSignals } from '@/lib/survivor/survivorFormatSignals'
import { chimmyWeeklyReportBody } from '@/lib/survivor/chimmyWeeklyReport'
import { answerSurvivorRules, survivorRulesTopic, type SurvivorRulesContext } from '@/lib/survivor/survivorRulesAnswers'
import { realGameSettingsFromForm, SURVIVOR_CHALLENGE_SETTING_DEFAULTS, type SurvivorSettingsForm } from '@/lib/survivor/survivorSettingsScreen'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/normalizeSurvivorSettings'

describe('loadSurvivorFormatSignals', () => {
  it('concatenates every source; a throwing source costs only itself', async () => {
    src.rewards.mockResolvedValue([{ id: 'r' }])
    src.finale.mockRejectedValue(new Error('boom'))
    src.challenges.mockResolvedValue([{ id: 'c' }])
    const out = await loadSurvivorFormatSignals({ userId: 'u', leagueIds: ['L'], now: new Date() })
    expect(out.map((s) => s.id)).toEqual(['r', 'c'])
    expect(await loadSurvivorFormatSignals({ userId: 'u', leagueIds: [], now: new Date() })).toEqual([])
  })
})

describe('Chimmy weekly report', () => {
  it('says how many challenges Chimmy answered, in the league language, and nothing when none', () => {
    expect(chimmyWeeklyReportBody(9, [{ name: 'Seat 4', state: 'active', voted: 0, exileTeam: null, challenges: 2 }])).toContain('Seat 4: still in the game, answered 2 challenges.')
    expect(chimmyWeeklyReportBody(9, [{ name: 'Seat 4', state: 'active', voted: 0, exileTeam: null, challenges: 1 }], 'es')).toContain('respondió un reto')
    expect(chimmyWeeklyReportBody(9, [{ name: 'Seat 4', state: 'active', voted: 0, exileTeam: null }])).toContain('Seat 4: still in the game.')
  })
})

describe('rules answers', () => {
  const ctx = (language: string): SurvivorRulesContext => ({
    sport: 'NFL', settings: normalizeSurvivorFoundationSettings({}) as never, plan: null, language,
    challenges: { faabWeeklyCap: 60, realGame: { enabled: true, perWeek: 1, prizeText: '+5 points' } },
  })
  it('explains commissioner challenges, the FAAB cap and the real-game setup, in both languages', () => {
    expect(survivorRulesTopic('how do challenges work?')).toBe('challenges')
    const en = answerSurvivorRules('challenges', ctx('en'))
    expect(en).toContain('the first answer stands')
    expect(en).toContain('$60 per winner per week')
    expect(en).toContain('1 a week, prize +5 points')
    expect(answerSurvivorRules('challenges', ctx('es'))).toContain('la primera respuesta cuenta')
  })
})

describe('real-game settings block', () => {
  it('keeps unknown keys and writes the amount under the prize type’s own key', () => {
    const form = { ...SURVIVOR_CHALLENGE_SETTING_DEFAULTS, realGamePrizeType: 'score_bonus', realGamePrizeAmount: 10, realGamePerWeek: 1 } as unknown as SurvivorSettingsForm
    expect(realGameSettingsFromForm(form, { enabled: true, legacy: 'x', faabAmount: 5 })).toEqual({ enabled: true, legacy: 'x', faabAmount: 5, perWeek: 1, prizeType: 'score_bonus', pointsAmount: 10 })
  })
})
