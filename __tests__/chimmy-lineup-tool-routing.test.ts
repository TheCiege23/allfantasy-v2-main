/**
 * Chimmy's lineup tools answer from My Team first (2026-11-16): the weekly-feed tools answer only when My Team
 * steps aside, and a fallback caused by My Team failing to load is SAID, so chat never silently disagrees with the
 * screen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ myLineup: vi.fn(), myStartSit: vi.fn(), feedLineup: vi.fn(), scenario: vi.fn() }))
vi.mock('@/lib/chimmy/myTeamLineupGrounding', () => ({ buildMyTeamLineupContext: m.myLineup, buildMyTeamStartSitContext: m.myStartSit }))
vi.mock('@/lib/chimmy/lineupOptimizerGrounding', () => ({ buildLineupOptimizerContext: m.feedLineup }))
vi.mock('@/lib/chimmy/tools/scenarioTools', () => ({ runStartSitScenarioTool: m.scenario }))

import { executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'

const CTX = { leagueId: 'L', userId: 'u' }

beforeEach(() => {
  vi.clearAllMocks()
  m.feedLineup.mockResolvedValue('FEED LINEUP')
  m.scenario.mockResolvedValue('FEED START/SIT')
})

describe('optimize_my_lineup', () => {
  it('answers from My Team when it can', async () => {
    m.myLineup.mockResolvedValue('MY TEAM LINEUP')
    expect(await executeChimmyTool('optimize_my_lineup', {}, CTX)).toBe('MY TEAM LINEUP')
    expect(m.feedLineup).not.toHaveBeenCalled()
  })

  it('outside the NFL uses the feed tool with no note — that is the design, not a failure', async () => {
    m.myLineup.mockResolvedValue({ fallback: 'not_nfl' })
    expect(await executeChimmyTool('optimize_my_lineup', {}, CTX)).toBe('FEED LINEUP')
  })

  it('when My Team cannot load, the feed answer says it came from another source', async () => {
    m.myLineup.mockResolvedValue({ fallback: 'no_my_team' })
    const out = await executeChimmyTool('optimize_my_lineup', {}, CTX)
    expect(out).toMatch(/^NOTE: My Team could not load this lineup/)
    expect(out).toContain('FEED LINEUP')
    m.myLineup.mockRejectedValue(new Error('boom'))
    expect(await executeChimmyTool('optimize_my_lineup', {}, CTX)).toMatch(/^NOTE: My Team could not load/)
  })
})

describe('compare_start_options', () => {
  it('answers from My Team when both players are on the roster', async () => {
    m.myStartSit.mockResolvedValue('MY TEAM CALL')
    expect(await executeChimmyTool('compare_start_options', { players: [' A Guy ', 'B Guy'] }, CTX)).toBe('MY TEAM CALL')
    expect(m.myStartSit.mock.calls[0]![0].players).toEqual(['A Guy', 'B Guy'])
    expect(m.scenario).not.toHaveBeenCalled()
  })

  it('falls back to the scenario tool otherwise, noting a My Team load failure', async () => {
    m.myStartSit.mockResolvedValue({ fallback: 'not_nfl' })
    expect(await executeChimmyTool('compare_start_options', { players: ['A', 'B'] }, CTX)).toBe('FEED START/SIT')
    m.myStartSit.mockResolvedValue({ fallback: 'no_my_team' })
    expect(await executeChimmyTool('compare_start_options', { players: ['A', 'B'] }, CTX)).toMatch(/^NOTE: My Team could not load[\s\S]*FEED START\/SIT$/)
  })

  it('anything but exactly two names goes straight to the scenario tool, which explains', async () => {
    await executeChimmyTool('compare_start_options', { players: ['Only One'] }, CTX)
    expect(m.myStartSit).not.toHaveBeenCalled()
    expect(m.scenario).toHaveBeenCalled()
  })
})
