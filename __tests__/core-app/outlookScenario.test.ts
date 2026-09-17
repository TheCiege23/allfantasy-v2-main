import { describe, expect, it } from 'vitest'
import {
  averageWeeklyDelta,
  bestLineup,
  EMPTY_SCENARIO,
  scenarioEffect,
  setLineupPoints,
  type ScenarioModel,
  type ScenarioPlayer,
} from '@/lib/core-app/outlookScenario'

function p(id: string, position: string, points: number | null, slot: ScenarioPlayer['slot'] = 'B', extra: Partial<ScenarioPlayer> = {}): ScenarioPlayer {
  return { id, name: `P${id}`, position, team: null, points, slot, injury: null, byeWeek: null, age: null, ...extra }
}

const SLOTS = ['QB', 'RB', 'WR', 'FLEX']

function model(over: Partial<ScenarioModel> = {}): ScenarioModel {
  return {
    leagueId: 'L',
    basisWeek: { season: '2026', week: 3 },
    refusal: null,
    slots: SLOTS,
    teams: [
      {
        rosterId: '1',
        name: 'Mine',
        isYou: true,
        players: [
          p('qb', 'QB', 20, 'S'),
          p('rb1', 'RB', 15, 'S'),
          p('wr1', 'WR', 12, 'S'),
          p('rb2', 'RB', 8, 'S'),
          p('wr2', 'WR', 10, 'B'),
          p('te', 'TE', 4, 'B'),
        ],
      },
      {
        rosterId: '2',
        name: 'Theirs',
        isYou: false,
        players: [p('qb2', 'QB', 18, 'S'), p('rbx', 'RB', 22, 'S'), p('wrx', 'WR', 9, 'S'), p('wry', 'WR', 7, 'S')],
      },
    ],
    freeAgents: [p('fa', 'WR', 14, 'F')],
    sim: { teams: [], remaining: [], playoffTeams: 2, byeTeams: 0 },
    seed: 1,
    weeks: [3, 4, 5],
    youRosterId: '1',
    ...over,
  }
}

describe('bestLineup', () => {
  it('fills the narrow slots first and flexes the best of the rest', () => {
    const r = bestLineup(model().teams[0].players, SLOTS)
    expect(r.points).toBe(20 + 15 + 12 + 10)
    expect(new Set(r.starterIds)).toEqual(new Set(['qb', 'rb1', 'wr1', 'wr2']))
  })

  it('skips ruled-out, reserve and bye-week players, and unpriced ones', () => {
    const players = [
      p('qb', 'QB', 20, 'S', { injury: { status: 'Out', kind: 'out' } }),
      p('qb2', 'QB', 11, 'B'),
      p('rb', 'RB', 15, 'S', { byeWeek: 4 }),
      p('rb2', 'RB', 9, 'B'),
      p('wr', 'WR', null, 'S'),
      p('wr2', 'WR', 5, 'I'),
    ]
    const r = bestLineup(players, ['QB', 'RB', 'WR'], 4)
    expect(r.points).toBe(11 + 9)
    expect(r.unfilled).toEqual(['WR'])
  })

  it('reports a slot it does not recognise instead of silently scoring it as empty', () => {
    expect(bestLineup([p('x', 'WR', 5)], ['WR', 'MYSTERY']).unknown).toEqual(['MYSTERY'])
  })
})

describe('setLineupPoints', () => {
  it('prices the lineup as set, counting a ruled-out starter as zero', () => {
    const players = [p('a', 'QB', 10, 'S'), p('b', 'RB', 7, 'S', { injury: { status: 'Out', kind: 'out' } }), p('c', 'WR', 9, 'B')]
    expect(setLineupPoints(players)).toBe(10)
  })
  it('refuses to price a lineup with an unpriced starter', () => {
    expect(setLineupPoints([p('a', 'QB', 10, 'S'), p('b', 'RB', null, 'S')])).toBeNull()
  })
})

describe('scenarioEffect', () => {
  it('an injury costs the lineup difference, only in the weeks it covers', () => {
    const m = model()
    const e = scenarioEffect(m, { ...EMPTY_SCENARIO, injuries: [{ playerId: 'rb1', weeks: 2 }] })
    // RB1 out: RB2 (8) takes the RB slot and WR2 keeps FLEX.
    const before = bestLineup(m.teams[0].players, SLOTS).points
    const without = bestLineup(m.teams[0].players.filter((x) => x.id !== 'rb1'), SLOTS).points
    expect(e.adjustments).toEqual([
      { rosterId: '1', fromWeek: 3, toWeek: 3, points: without - before },
      { rosterId: '1', fromWeek: 4, toWeek: 4, points: without - before },
    ])
    expect(e.problems).toEqual([])
  })

  it('a rest-of-season injury carries into the playoffs', () => {
    const e = scenarioEffect(model(), { ...EMPTY_SCENARIO, injuries: [{ playerId: 'qb', weeks: null }] })
    expect(e.adjustments.filter((a) => a.rosterId === '1')).toHaveLength(4)
    expect(e.adjustments.at(-1)).toMatchObject({ fromWeek: 6, toWeek: null })
  })

  it('a trade moves points out of one lineup and into the other, permanently', () => {
    const e = scenarioEffect(model(), {
      ...EMPTY_SCENARIO,
      trades: [{ partnerRosterId: '2', send: ['wr1'], receive: ['rbx'] }],
    })
    const mine = e.adjustments.filter((a) => a.rosterId === '1')
    const theirs = e.adjustments.filter((a) => a.rosterId === '2')
    expect(mine).toHaveLength(4)
    expect(theirs).toHaveLength(4)
    expect(mine[0].points).toBeGreaterThan(0)
    expect(theirs[0].points).toBeLessThan(0)
    expect(mine.at(-1)!.toWeek).toBeNull()
  })

  it('🛑 an injury and a trade compose week by week', () => {
    // Trade for a back while RB1 is hurt for one week: week 3 sees both, weeks 4-5 only the trade.
    const m = model()
    const e = scenarioEffect(m, {
      ...EMPTY_SCENARIO,
      injuries: [{ playerId: 'rb1', weeks: 1 }],
      trades: [{ partnerRosterId: '2', send: ['te'], receive: ['rbx'] }],
    })
    const mine = e.adjustments.filter((a) => a.rosterId === '1')
    const wk3 = mine.find((a) => a.fromWeek === 3)!.points
    const wk4 = mine.find((a) => a.fromWeek === 4)!.points
    expect(wk3).toBeLessThan(wk4)
  })

  it('a waiver add is priced against the roster it joins', () => {
    const e = scenarioEffect(model(), { ...EMPTY_SCENARIO, waivers: [{ addId: 'fa', dropId: 'te' }] })
    // FA WR 14 displaces WR2 (10) from FLEX: +4 every week.
    expect(e.adjustments.map((a) => a.points)).toEqual([4, 4, 4, 4])
    expect(averageWeeklyDelta(e, '1', [3, 4, 5])).toBe(4)
  })

  it('a lineup call is relative to the lineup as set, for one week', () => {
    const e = scenarioEffect(model(), { ...EMPTY_SCENARIO, lineup: [{ startId: 'wr2', sitId: 'rb2', week: 4 }] })
    expect(e.adjustments).toEqual([{ rosterId: '1', fromWeek: 4, toWeek: 4, points: 2 }])
  })

  it('refuses roster changes it cannot price, and says why, while results still apply', () => {
    const e = scenarioEffect(model({ refusal: 'Roster changes cannot be priced here: no rulebook.' }), {
      ...EMPTY_SCENARIO,
      injuries: [{ playerId: 'qb', weeks: 1 }],
      results: [{ week: 3, a: '1', b: '2', winner: '1' }],
    })
    expect(e.adjustments).toEqual([])
    expect(e.problems[0]).toMatch(/no rulebook/)
    expect(e.forced).toHaveLength(1)
  })

  it('does not price a trade involving an unpriced player', () => {
    const m = model()
    m.teams[1].players.push(p('ghost', 'WR', null, 'B'))
    const e = scenarioEffect(m, { ...EMPTY_SCENARIO, trades: [{ partnerRosterId: '2', send: [], receive: ['ghost'] }] })
    expect(e.adjustments).toEqual([])
    expect(e.problems[0]).toMatch(/no projection/)
  })
})
