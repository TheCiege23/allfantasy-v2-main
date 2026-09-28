import { describe, expect, it } from 'vitest'
import { tradeSeasonEstimate } from '@/lib/chimmy/tradeSeasonEstimate'
import type { ScenarioModel } from '@/lib/core-app/outlookScenario'
import type { ReadyTradeScenario } from '@/lib/chimmy/tradeScenarioTypes'

const player = (id: string, points: number | null) => ({ id, name: id, position: 'RB', points, team: null, slot: 'B' as const, injury: null, byeWeek: null, age: null })
function fixture() {
  const model: ScenarioModel = { leagueId: 'l', basisWeek: { season: '2026', week: 3 }, refusal: null, slots: ['RB'], weeks: [3, 4, 5], seed: 42, youRosterId: 'you', freeAgents: [],
    teams: [{ rosterId: 'you', name: 'You', isYou: true, players: [player('send', 10)] }, { rosterId: 'other', name: 'Other', isYou: false, players: [player('get', 30)] }],
    sim: { playoffTeams: 1, byeTeams: 0, teams: ['you', 'other'].map(rosterId => ({ rosterId, wins: 1, losses: 1, pointsFor: 100, profile: { mu: 50, sigma: 10, n: 8 } })), remaining: [3, 4, 5].map(week => ({ week, a: 'you', b: 'other' })) } }
  const scenario = { give: [{ playerId: 'send', name: 'send' }], get: [{ playerId: 'get', name: 'get' }, { playerId: 'pick:2027:1:x', name: '2027 1st' }], lineupWeek: 3 } as unknown as ReadyTradeScenario
  return { model, scenario }
}
describe('trade season sensitivity', () => {
  it('computes reproducible paired before/after odds from actual moved players, ignoring future picks', () => {
    const { model, scenario } = fixture()
    const out = tradeSeasonEstimate(scenario, model, '2026-09-27')
    expect(out.available).toBe(true)
    if (!out.available) throw new Error(out.reason)
    expect(out.after).toBeGreaterThan(out.before)
    expect(out.delta).toBeCloseTo(out.after - out.before)
    expect(out).toEqual(tradeSeasonEstimate(scenario, model, '2026-09-27'))
    expect(out.reason).toContain('same projection week')
    expect(out.reason).toContain('not a rest-of-season')
  })
  it.each(['missing-profile', 'unpriced-bench', 'wrong-owner', 'wrong-week', 'invalid-schedule', 'unfilled-after'])('withholds odds for %s rather than substituting data', gap => {
    const { model, scenario } = fixture()
    if (gap === 'missing-profile') model.sim.teams[1].profile = null
    if (gap === 'unpriced-bench') model.teams[0].players.push(player('unknown', null))
    if (gap === 'wrong-owner') scenario.give[0].playerId = 'get'
    if (gap === 'wrong-week') scenario.lineupWeek = 4
    if (gap === 'invalid-schedule') model.sim.remaining[0].b = 'absent'
    if (gap === 'unfilled-after') model.teams[1].players[0].byeWeek = 4
    expect(tradeSeasonEstimate(scenario, model, 'now').available).toBe(false)
  })
  it('does not use taxi players to repair an empty legal lineup', () => {
    const { model, scenario } = fixture()
    model.teams[0].players[0].slot = 'T'
    expect(tradeSeasonEstimate(scenario, model, 'now').available).toBe(false)
  })
})
