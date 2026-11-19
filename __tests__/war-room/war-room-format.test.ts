/**
 * War Room phase 3 — the format brief (lib/core-app/warRoomFormat.ts) and the next-season mapping
 * (lib/core-app/warRoomNextSeason.ts).
 *
 * Pins: scarcity is MEASURED from the league's own best lineups against its best free agent, ranked
 * most-scarce first, with your team compared to the league average (never to a named rival); a
 * position with no free agent is kept and marked, not dropped; superflex is read off the slots; the
 * scoring lines are the shared `describeScoringDifferences` wording; and the next-season view carries
 * the engines' own "needs more data" rather than an empty plan.
 */

import { describe, expect, it } from 'vitest'

import type { ScenarioModel, ScenarioPlayer, ScenarioTeam } from '@/lib/core-app/outlookScenario'
import { buildFormatBrief, measureScarcity } from '@/lib/core-app/warRoomFormat'
import { dynastyView, keeperView, nextSeasonEngineFor } from '@/lib/core-app/warRoomNextSeason'
import type { KeeperValueLine } from '@/lib/keeper-war-room/keeperValueEngine'

let n = 0
const p = (position: string, points: number, slot: ScenarioPlayer['slot'] = 'S', name?: string): ScenarioPlayer => ({
  id: `p${n++}`,
  name: name ?? `${position} ${points}`,
  position,
  team: null,
  points,
  slot,
  injury: null,
  byeWeek: null,
  age: 26,
})

const SLOTS = ['QB', 'RB', 'WR', 'TE']

/** Two teams. TEs are 12 and 10 with a 3-point free agent (gap 8); WRs 15 and 13 with a 12-point one (gap 2). */
function model(over: Partial<ScenarioModel> = {}): ScenarioModel {
  const you: ScenarioTeam = { rosterId: 'you', name: 'Me', isYou: true, players: [p('QB', 20), p('RB', 14), p('WR', 15), p('TE', 12)] }
  const them: ScenarioTeam = { rosterId: 'them', name: 'Rival', isYou: false, players: [p('QB', 18), p('RB', 16), p('WR', 13), p('TE', 10)] }
  return {
    leagueId: 'L',
    basisWeek: { season: '2026', week: 10 },
    refusal: null,
    slots: SLOTS,
    teams: [you, them],
    freeAgents: [p('TE', 3, 'F', 'Waiver TE'), p('WR', 12, 'F', 'Waiver WR'), p('WR', 9, 'F'), p('RB', 8, 'F'), p('QB', 11, 'F')],
    sim: {} as ScenarioModel['sim'],
    seed: 1,
    weeks: [10, 11],
    youRosterId: 'you',
    ...over,
  }
}

describe('measureScarcity — where this league is won', () => {
  it('ranks positions by the gap between the average starter and the best free agent', () => {
    const rows = measureScarcity(model())
    expect(rows.map((r) => r.position)).toEqual(['QB', 'TE', 'RB', 'WR'])
    const te = rows.find((r) => r.position === 'TE')!
    expect(te).toMatchObject({ starters: 2, avgStarter: 11, bestFreeAgent: { name: 'Waiver TE', points: 3 }, gap: 8 })
    expect(rows.find((r) => r.position === 'WR')!.gap).toBe(2)
  })

  it('compares YOUR starters to the league average, by position', () => {
    const rows = measureScarcity(model())
    expect(rows.find((r) => r.position === 'TE')).toMatchObject({ you: 12, youVsLeague: 1 })
    expect(rows.find((r) => r.position === 'RB')).toMatchObject({ you: 14, youVsLeague: -1 })
  })

  it('a position with no scanned free agent is kept and sorted last, not dropped', () => {
    const rows = measureScarcity(model({ freeAgents: [p('WR', 12, 'F')] }))
    expect(rows.map((r) => r.position)).toContain('TE')
    expect(rows[rows.length - 1]!.gap).toBeNull()
  })

  it('unpriced rosters produce no rows rather than invented ones', () => {
    expect(measureScarcity(model({ refusal: 'No projection week is on file yet.' }))).toEqual([])
    expect(measureScarcity(model({ slots: [] }))).toEqual([])
  })
})

describe('buildFormatBrief', () => {
  const base = { scoringSettings: null, playoffTeams: 6, byeTeams: 2, playoffStartWeek: 15, tradeDeadlineWeek: 11, weeksRemaining: 4 }

  it('counts the starting lineup in the league’s own order, without bench or IR', () => {
    const brief = buildFormatBrief({ ...base, model: model({ slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'IR'] }) })
    expect(brief.lineup).toEqual([
      { slot: 'QB', count: 1 },
      { slot: 'RB', count: 2 },
      { slot: 'WR', count: 2 },
      { slot: 'TE', count: 1 },
      { slot: 'FLEX', count: 1 },
    ])
    expect(brief.twoQb).toBe(false)
  })

  it('reads superflex off the slots, and two QB slots as 2QB', () => {
    expect(buildFormatBrief({ ...base, model: model({ slots: ['QB', 'SUPER_FLEX', 'RB'] }) }).twoQb).toBe(true)
    expect(buildFormatBrief({ ...base, model: model({ slots: ['QB', 'QB', 'RB'] }) }).twoQb).toBe(true)
  })

  it('scoring lines are the shared wording, read only off the league’s own settings', () => {
    expect(buildFormatBrief({ ...base, model: model(), scoringSettings: { rec: 0.5 } }).scoringNotes).toEqual(['Receptions are worth 0.5, not 1.'])
    expect(buildFormatBrief({ ...base, model: model(), scoringSettings: null }).scoringNotes).toEqual([])
  })

  it('carries the calendar and says why scarcity is missing when rosters are not readable', () => {
    const brief = buildFormatBrief({ ...base, model: null })
    expect(brief.calendar).toEqual({ playoffTeams: 6, byeTeams: 2, playoffStartWeek: 15, tradeDeadlineWeek: 11, weeksRemaining: 4 })
    expect(brief.scarcity).toEqual([])
    expect(brief.scarcityRefusal).toBe('Rosters could not be read for this league.')
  })
})

describe('next season — a mapping of the existing engines, deciding nothing', () => {
  it('routes each format to its engine; salary cap is said to be not built rather than silently none', () => {
    expect(nextSeasonEngineFor('dynasty')).toBe('dynasty')
    expect(nextSeasonEngineFor('devy')).toBe('dynasty')
    expect(nextSeasonEngineFor('keeper')).toBe('keeper')
    expect(nextSeasonEngineFor('salary_cap')).toBe('not_built')
    expect(nextSeasonEngineFor('redraft')).toBe('none')
    expect(nextSeasonEngineFor(null)).toBe('none')
  })

  it('dynasty carries the engine’s window, posture and its own facts', () => {
    const v = dynastyView({
      rosterId: 'r',
      window: 'rebuild',
      posture: 'sell_for_youth',
      contendScore: 31,
      avgStarterAge: 28.4,
      youngValueShare: 0.2,
      totalStarterValue: 9000,
      pickCapitalValue: 4,
      earlyPickCount: 1,
      explanationFacts: ['Average starter age 28.4.'],
      missingDataFlags: [],
    })
    expect(v).toMatchObject({ kind: 'dynasty', window: 'rebuild', posture: 'sell_for_youth', facts: ['Average starter age 28.4.'] })
  })

  it('keeper caps the bubble and avoid lists, keeps every recommended keeper, and carries needs-more-data', () => {
    const k = (name: string, verdict: KeeperValueLine['verdict'], surplus: number | null): KeeperValueLine => ({
      playerId: name,
      playerName: name,
      position: 'RB',
      adp: 20,
      adpRound: 2,
      keeperCostLabel: surplus == null ? null : 'Round 8',
      keeperCostRound: surplus == null ? null : 8,
      surplusRounds: surplus,
      verdict,
      reason: '',
    })
    const v = keeperView(
      {
        rosterId: 'r',
        maxKeepers: 2,
        recommended: [k('A', 'definite_keep', 6), k('B', 'keep', 3)],
        bubble: [k('C', 'borderline', 1), k('D', 'borderline', 0), k('E', 'borderline', 0), k('F', 'borderline', 0)],
        avoid: [k('G', 'let_go', -2)],
        ranked: [],
        needsMoreData: true,
        missingDataFlags: ['keeper_cost_partial'],
      },
      { rosterId: 'r', totalRounds: 15, consumedRounds: [8, 11], remainingRounds: [], priorityPositions: ['WR', 'TE'], roundPlan: [], costSystem: 'round_based', explanationFacts: [], missingDataFlags: ['adp_partial'] },
    )
    if (v.kind !== 'keeper') throw new Error(v.kind)
    expect(v.recommended.map((r) => r.name)).toEqual(['A', 'B'])
    expect(v.bubble).toHaveLength(3)
    expect(v.recommended[0]).toMatchObject({ cost: 'Round 8', surplusRounds: 6 })
    expect(v.draft).toEqual({ consumedRounds: [8, 11], priorityPositions: ['WR', 'TE'] })
    expect(v.needsMoreData).toBe(true)
    expect(v.missing).toEqual(['keeper_cost_partial', 'adp_partial'])
  })
})
