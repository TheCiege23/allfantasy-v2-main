/**
 * War Room phase 2 — trades that move your odds (lib/core-app/warRoomTrades.ts).
 *
 * Pins: a suggested swap lifts YOUR lineup and does not weaken THEIRS; it is priced through the
 * scenario model and an odds runner, and dropped when the simulation says it does not help; the
 * trade deadline closes the section; a redraft team out of the race gets no trades, a dynasty one gets
 * "sell" ideas for veterans past their position's decline age — with no invented return package.
 */

import { describe, expect, it, vi } from 'vitest'

import type { ScenarioModel, ScenarioPlayer, ScenarioTeam } from '@/lib/core-app/outlookScenario'
import type { SimAdjustment } from '@/lib/core-app/outlookSim'
import { buildWarTrades, MIN_GAIN, screenSwaps, type OddsRunner, type WarTradesInput } from '@/lib/core-app/warRoomTrades'

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']

let n = 0
const p = (name: string, position: string, points: number, over: Partial<ScenarioPlayer> = {}): ScenarioPlayer => ({
  id: `${name}-${n++}`,
  name,
  position,
  team: 'NYG',
  points,
  slot: 'B',
  injury: null,
  byeWeek: null,
  age: 25,
  ...over,
})

/**
 * You: deep at RB (a good RB4 on the bench), thin at WR (your WR2 scores 6).
 * Them: deep at WR (a good WR4 on the bench), thin at RB (their RB2 scores 5).
 * The complementary swap — your RB4 for their WR4 — lifts both lineups.
 */
function league(): { you: ScenarioTeam; them: ScenarioTeam; other: ScenarioTeam } {
  const you: ScenarioTeam = {
    rosterId: 'you',
    name: 'My Team',
    isYou: true,
    players: [
      p('My QB', 'QB', 20, { slot: 'S' }),
      p('My RB1', 'RB', 18, { slot: 'S' }),
      p('My RB2', 'RB', 16, { slot: 'S' }),
      p('My RB3', 'RB', 15, { slot: 'S' }),
      p('My RB4', 'RB', 14, { age: 29 }),
      p('My WR1', 'WR', 15, { slot: 'S' }),
      p('My WR2', 'WR', 6, { slot: 'S' }),
      p('My TE', 'TE', 9, { slot: 'S' }),
    ],
  }
  const them: ScenarioTeam = {
    rosterId: 'them',
    name: 'Team Taco',
    isYou: false,
    players: [
      p('Their QB', 'QB', 19, { slot: 'S' }),
      p('Their RB1', 'RB', 15, { slot: 'S' }),
      p('Their RB2', 'RB', 5, { slot: 'S' }),
      p('Their WR1', 'WR', 17, { slot: 'S' }),
      p('Their WR2', 'WR', 16, { slot: 'S' }),
      p('Their WR3', 'WR', 15, { slot: 'S' }),
      p('Their WR4', 'WR', 14),
      p('Their TE', 'TE', 8, { slot: 'S' }),
    ],
  }
  // A full, balanced team with no surplus: nothing you could send would improve it without costing it more.
  const other: ScenarioTeam = {
    rosterId: 'other',
    name: 'Balanced Bunch',
    isYou: false,
    players: [
      p('B QB', 'QB', 30, { slot: 'S' }),
      p('B RB1', 'RB', 30, { slot: 'S' }),
      p('B RB2', 'RB', 30, { slot: 'S' }),
      p('B WR1', 'WR', 30, { slot: 'S' }),
      p('B WR2', 'WR', 30, { slot: 'S' }),
      p('B TE', 'TE', 30, { slot: 'S' }),
      p('B FLEX', 'WR', 30, { slot: 'S' }),
    ],
  }
  return { you, them, other }
}

function model(over: Partial<ScenarioModel> = {}, teams?: ScenarioTeam[]): ScenarioModel {
  const t = league()
  return {
    leagueId: 'L',
    basisWeek: { season: '2026', week: 10 },
    refusal: null,
    slots: SLOTS,
    teams: teams ?? [t.you, t.them, t.other],
    freeAgents: [],
    sim: {} as ScenarioModel['sim'],
    seed: 1,
    weeks: [10, 11, 12, 13],
    youRosterId: 'you',
    ...over,
  }
}

/** Odds rise with the weekly points the adjustments give YOU: 1 point a week = 2 points of playoff odds. */
const runner: OddsRunner = (adjustments: SimAdjustment[]) => {
  const mine = adjustments.filter((a) => a.rosterId === 'you').reduce((s, a) => s + a.points, 0) / 4
  return { playoff: 40 + 2 * mine, title: 5 + 0.5 * mine }
}

function input(over: Partial<WarTradesInput> = {}): WarTradesInput {
  return {
    model: model(),
    posture: 'bubble',
    horizon: 'this_season',
    sport: 'NFL',
    deadlineOpen: true,
    deadlineWeek: 12,
    teamPlayoffPct: new Map([['them', 62.4], ['other', 88]]),
    odds: runner,
    ...over,
  }
}

describe('screenSwaps — both lineups, priced on the projection week', () => {
  it('finds the complementary swap and refuses one that only helps you', () => {
    const m = model()
    const { kept, screened } = screenSwaps(m, m.teams[0]!)
    expect(screened).toBeGreaterThan(0)
    expect(kept.length).toBeGreaterThan(0)
    for (const k of kept) {
      expect(k.youGain).toBeGreaterThanOrEqual(MIN_GAIN)
      expect(k.partnerGain).toBeGreaterThanOrEqual(0)
    }
    // The balanced team has no surplus: every swap that helps you costs it, so it is never a partner.
    expect(kept.some((k) => k.partner.rosterId === 'other')).toBe(false)
    expect(kept.some((k) => k.send.name === 'My RB4' && k.receive.name === 'Their WR4')).toBe(true)
  })
})

describe('buildWarTrades — win now', () => {
  it('suggests the swap, priced in playoff odds, with the partner described by facts', () => {
    const out = buildWarTrades(input())
    if (out.mode !== 'win_now') throw new Error(out.mode)
    expect(out.rankedBy).toBe('playoff')
    expect(out.ideas.length).toBeGreaterThan(0)
    const idea = out.ideas[0]!
    expect(idea.partnerName).toBe('Team Taco')
    expect(idea.partnerPlayoffPct).toBe(62.4)
    expect(idea.youGainPerWeek).toBeGreaterThanOrEqual(MIN_GAIN)
    expect(idea.partnerGainPerWeek).toBeGreaterThanOrEqual(0)
    expect(idea.playoffDelta).toBeGreaterThan(0)
    expect(out.basisWeek).toEqual({ season: '2026', week: 10 })
  })

  it('one idea per partner and per player you send, three at most', () => {
    const out = buildWarTrades(input())
    if (out.mode !== 'win_now') throw new Error(out.mode)
    expect(out.ideas.length).toBeLessThanOrEqual(3)
    expect(new Set(out.ideas.map((i) => i.partnerRosterId)).size).toBe(out.ideas.length)
    expect(new Set(out.ideas.map((i) => i.send.id)).size).toBe(out.ideas.length)
  })

  it('an idea the simulation says does not help is dropped, whatever the lineup arithmetic said', () => {
    const flat: OddsRunner = () => ({ playoff: 40, title: 5 })
    const out = buildWarTrades(input({ odds: flat }))
    if (out.mode !== 'win_now') throw new Error(out.mode)
    expect(out.ideas).toEqual([])
    expect(out.screened).toBeGreaterThan(0)
  })

  it('a clinched team ranks by title odds', () => {
    const out = buildWarTrades(input({ posture: 'clinched' }))
    if (out.mode !== 'win_now') throw new Error(out.mode)
    expect(out.rankedBy).toBe('title')
    expect(out.ideas[0]!.titleDelta).toBeGreaterThan(0)
  })

  it('every priced idea goes through the odds runner against one baseline', () => {
    const spy = vi.fn(runner)
    buildWarTrades(input({ odds: spy }))
    expect(spy.mock.calls[0]![0]).toEqual([])
    expect(spy.mock.calls.length).toBeGreaterThan(1)
  })

  it('a redraft long shot is still alive, so it still gets win-now ideas', () => {
    expect(buildWarTrades(input({ posture: 'long_shot', horizon: 'this_season' })).mode).toBe('win_now')
  })
})

describe('buildWarTrades — the gates', () => {
  it('a passed deadline closes the section', () => {
    expect(buildWarTrades(input({ deadlineOpen: false, deadlineWeek: 9 }))).toEqual({ mode: 'closed', deadlineWeek: 9 })
  })

  it('no stated deadline is not a closed one', () => {
    expect(buildWarTrades(input({ deadlineOpen: null, deadlineWeek: null })).mode).toBe('win_now')
  })

  it('🛑 a redraft team out of the race gets no trades — nothing carries over', () => {
    expect(buildWarTrades(input({ posture: 'eliminated', horizon: 'this_season' }))).toEqual({ mode: 'none', why: 'redraft_out', reason: null })
  })

  it('rosters the model could not price say so, with the model’s reason', () => {
    expect(buildWarTrades(input({ model: model({ refusal: 'No projection week is on file yet.' }) }))).toEqual({
      mode: 'none',
      why: 'not_priced',
      reason: 'No projection week is on file yet.',
    })
  })

  it('no team of yours, or an unplaced league, is said plainly', () => {
    expect(buildWarTrades(input({ model: model({ youRosterId: null }) }))).toMatchObject({ mode: 'none', why: 'no_team' })
    expect(buildWarTrades(input({ posture: 'unplaced' }))).toMatchObject({ mode: 'none', why: 'unplaced' })
  })
})

describe('buildWarTrades — sell, for a dynasty team playing for next season', () => {
  it('lists veterans past their position’s decline age, and who gains most from them', () => {
    const out = buildWarTrades(input({ posture: 'long_shot', horizon: 'carries_over' }))
    if (out.mode !== 'sell') throw new Error(out.mode)
    // My RB4 is 29 (RBs decline from 27); everyone else on the roster is 25.
    expect(out.ideas.map((i) => i.player.name)).toEqual(['My RB4'])
    expect(out.ideas[0]!.agingFrom).toBe(27)
    expect(out.ideas[0]!.partners[0]).toMatchObject({ rosterId: 'them', name: 'Team Taco', playoffPct: 62.4 })
    expect(out.ideas[0]!.partners[0]!.gainPerWeek).toBeGreaterThanOrEqual(MIN_GAIN)
  })

  it('🛑 names no return package — a dynasty value this model does not hold would be invented', () => {
    const out = buildWarTrades(input({ posture: 'eliminated', horizon: 'carries_over' }))
    if (out.mode !== 'sell') throw new Error(out.mode)
    for (const idea of out.ideas) expect(Object.keys(idea).sort()).toEqual(['agingFrom', 'partners', 'player'])
  })
})
