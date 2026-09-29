import { describe, it, expect } from 'vitest'
import { runLineupSetDecision } from '@/lib/decision-os/lineup'
import { fakeWorldDeps, fakeValidate, fakePlayers, payload, action } from './lineupFakes'

const baseInput = {
  sport: 'NFL',
  leagueSettings: {},
  leagueWeek: 1,
  editingWeek: 1,
  userId: 'u1',
  leagueId: 'L1',
  rosterId: 'r1',
  players: fakePlayers(),
}

describe('runLineupSetDecision — DCO-driven, end to end', () => {
  it('clean lineup → "all caught up" success state', async () => {
    const { decision } = await runLineupSetDecision(baseInput, {
      world: fakeWorldDeps(false),
      decision: { recommend: async () => payload('L1', []), ruleDeps: { validateRedraft: fakeValidate() } },
    })
    expect(decision.four_answers.what_happened).toMatch(/lineup is set/i)
    expect(decision.four_answers.what_to_do).toMatch(/caught up/i)
    expect(decision.recommended_actions).toHaveLength(0)
    expect(decision.confidence).toBeGreaterThanOrEqual(50)
  })

  it('an empty-starter action → surfaced as the decision, recommender output carried unchanged', async () => {
    const act = action('L1') // empty QB, critical
    const { decision } = await runLineupSetDecision(baseInput, {
      world: fakeWorldDeps(false),
      decision: { recommend: async () => payload('L1', [act]), ruleDeps: { validateRedraft: fakeValidate() } },
    })
    expect(decision.four_answers.what_happened).toMatch(/need attention/i)
    expect(decision.four_answers.what_to_do).toBe('Set a starter for QB.')
    expect(decision.recommended_actions).toHaveLength(1)
    expect(decision.recommended_actions[0]).toEqual(act)
  })

  it('only this league\'s actions are consumed (cross-league isolation)', async () => {
    const here = action('L1', { slotId: 'QB' })
    const elsewhere = action('OTHER', { slotId: 'RB' })
    const { decision } = await runLineupSetDecision(baseInput, {
      world: fakeWorldDeps(false),
      decision: { recommend: async () => payload('L1', [here, elsewhere]), ruleDeps: { validateRedraft: fakeValidate() } },
    })
    // payload() puts both in actions[]; the decision filters to L1
    expect(decision.recommended_actions.every((a) => a.leagueId === 'L1')).toBe(true)
  })

  it('locked + incomplete scan lowers confidence and records uncertainty honestly', async () => {
    const { decision } = await runLineupSetDecision(baseInput, {
      world: fakeWorldDeps(true), // locked → lock uncertainty
      decision: { recommend: async () => payload('L1', [], true), ruleDeps: { validateRedraft: fakeValidate() } },
    })
    expect(decision.data_completeness).toBeLessThanOrEqual(60)
    expect(decision.uncertainty_sources.length).toBeGreaterThan(0)
    expect(decision.four_answers.how_confident).toMatch(/confidence/i)
  })
})
