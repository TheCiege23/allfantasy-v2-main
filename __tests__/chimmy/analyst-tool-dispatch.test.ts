import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  optimizer: vi.fn(),
  trade: vi.fn(),
  startSit: vi.fn(),
  waiver: vi.fn(),
  outlook: vi.fn(),
  matchup: vi.fn(),
}))

vi.mock('@/lib/chimmy/lineupOptimizerGrounding', () => ({ buildLineupOptimizerContext: h.optimizer }))
vi.mock('@/lib/chimmy/tools/scenarioTools', () => ({
  runTradeScenarioTool: h.trade,
  runStartSitScenarioTool: h.startSit,
  runWaiverScenarioTool: h.waiver,
}))
vi.mock('@/lib/chimmy/playoffOutlookGrounding', () => ({ buildPlayoffOutlookContext: h.outlook }))
vi.mock('@/lib/chimmy/matchupPreviewGrounding', () => ({ buildMatchupPreviewContext: h.matchup }))

import { CHIMMY_TOOL_SPECS, executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'

/**
 * 🛑 THE ANALYST TOOLS READ WHOLE LEAGUES. Every one of them must take its league from the session
 * context — the membership-proven id — and never from anything the model put in its arguments.
 */

const CTX = { leagueId: 'L1', userId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of Object.values(h)) fn.mockResolvedValue('BLOCK')
})

const LEAGUE_GATED = ['optimize_my_lineup', 'compare_start_options', 'evaluate_trade', 'evaluate_waiver_move'] as const

describe('league-gated analyst tools', () => {
  it.each(LEAGUE_GATED)('%s refuses with no league in scope and runs nothing', async (name) => {
    const out = await executeChimmyTool(name, {}, { leagueId: null, userId: 'u1' })
    expect(out).toMatch(/NO LEAGUE IS SELECTED/)
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled()
  })

  it.each(LEAGUE_GATED)('%s ignores a league id smuggled into the arguments', async (name) => {
    await executeChimmyTool(name, { leagueId: 'SOMEONE-ELSES', league_id: 'SOMEONE-ELSES', give: ['A B'], get: ['C D'], add: 'A B', players: ['A B', 'C D'] }, CTX)
    const called = Object.values(h).find((fn) => fn.mock.calls.length > 0)!
    expect(called.mock.calls[0][0]).toMatchObject({ leagueId: 'L1', userId: 'u1' })
    expect(JSON.stringify(called.mock.calls[0][0])).not.toContain('SOMEONE-ELSES')
  })

  it('passes the structured trade sides through to the evaluator', async () => {
    await executeChimmyTool('evaluate_trade', { give: ["Ja'Marr Chase"], get: ['Justin Jefferson'] }, CTX)
    expect(h.trade).toHaveBeenCalledWith({ give: ["Ja'Marr Chase"], get: ['Justin Jefferson'], leagueId: 'L1', userId: 'u1' })
  })
})

describe('cross-league analyst tools', () => {
  it.each([
    ['get_playoff_outlook', h.outlook],
    ['get_my_matchup', h.matchup],
  ] as const)('%s answers across every league when none is in scope', async (name, fn) => {
    expect(await executeChimmyTool(name, {}, { leagueId: null, userId: 'u1' })).toBe('BLOCK')
    expect(fn).toHaveBeenCalledWith({ leagueId: null, userId: 'u1' })
  })

  it.each([
    ['get_playoff_outlook', h.outlook],
    ['get_my_matchup', h.matchup],
  ] as const)('%s uses the session league when there is one', async (name, fn) => {
    await executeChimmyTool(name, { leagueId: 'SOMEONE-ELSES' }, CTX)
    expect(fn).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1' })
  })

  it.each(['get_playoff_outlook', 'get_my_matchup'])('%s looks nothing up without a signed-in user', async (name) => {
    expect(await executeChimmyTool(name, {}, { leagueId: 'L1', userId: null })).toMatch(/cannot tell who is signed in/)
    expect(h.outlook).not.toHaveBeenCalled()
    expect(h.matchup).not.toHaveBeenCalled()
  })
})

describe('analyst tool specs', () => {
  it('declare no league or user parameter', () => {
    const analyst = CHIMMY_TOOL_SPECS.filter((s) =>
      [...LEAGUE_GATED, 'get_playoff_outlook', 'get_my_matchup'].includes(s.function.name as never),
    )
    expect(analyst).toHaveLength(6)
    for (const spec of analyst) {
      expect(Object.keys((spec.function.parameters as { properties: object }).properties)).not.toContain('leagueId')
    }
  })
})
