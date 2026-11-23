/** get_player_value routing (2026-11-16): an NBA league in scope answers from its board; otherwise the NFL values. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ board: vi.fn(), metrics: vi.fn(), nfl: vi.fn() }))
vi.mock('@/lib/af-projections/leaguePlayerMetrics', () => ({ loadLeaguePlayerMetrics: h.metrics }))
vi.mock('@/lib/chimmy/sportBoardValue', () => ({ buildSportBoardValueContext: h.board }))
vi.mock('@/lib/chimmy/tools/playerValueTool', () => ({ buildPlayerValueContext: h.nfl }))

import { executeChimmyTool, type ChimmyToolContext } from '@/lib/chimmy/tools/chimmyTools'

beforeEach(() => {
  vi.clearAllMocks()
  h.nfl.mockResolvedValue('NFL VALUE')
  h.metrics.mockResolvedValue({ sport: 'NBA', rows: [{ playerName: 'Nikola Jokic', tradeValue: 125, tradeValueUnit: 'fantasy points over replacement' }] })
})

describe('get_player_value', () => {
  it('in an NBA league: the league board, and the NFL table is not read', async () => {
    h.board.mockResolvedValue('NBA VALUE for Nikola Jokic')
    const out = await executeChimmyTool('get_player_value', { player: 'Nikola Jokic' }, { leagueId: 'L1', userId: 'u1' } as ChimmyToolContext)
    expect(out).toContain('Nikola Jokic has an AF trade value of 125.00 fantasy points over replacement')
    // No Chimmy plan in this context, so the board is read without AF's learned factors (AF Intelligence).
    expect(h.metrics).toHaveBeenCalledWith({ leagueId: 'L1', playerName: 'Nikola Jokic', limit: 2, afIntelligence: false })
    expect(h.nfl).not.toHaveBeenCalled()
  })

  it('withholds missing league values and preserves the global lookup without a league', async () => {
    h.metrics.mockResolvedValue(null)
    expect(await executeChimmyTool('get_player_value', { player: 'Josh Allen' }, { leagueId: 'L2', userId: 'u1' } as ChimmyToolContext)).toContain('no verified trade value')
    expect(await executeChimmyTool('get_player_value', { player: 'Josh Allen' }, { leagueId: null, userId: 'u1' } as ChimmyToolContext)).toBe('NFL VALUE')
    expect(h.metrics).toHaveBeenCalledTimes(1)
  })
})

describe('explain_value in an NBA league', () => {
  it('answers "why" from the league board; another sport asked for goes to the engine path', async () => {
    h.board.mockResolvedValue('NBA VALUE for Nikola Jokic …')
    const out = await executeChimmyTool('explain_value', { player: 'Nikola Jokic' }, { leagueId: 'L1', userId: 'u1' } as ChimmyToolContext)
    expect(out).toContain('AF trade value of 125.00')
    expect(out).toContain('NBA VALUE for Nikola Jokic …')
    h.board.mockClear()
    await executeChimmyTool('explain_value', { player: 'Josh Allen', sport: 'NFL' }, { leagueId: 'L1', userId: 'u1' } as ChimmyToolContext).catch(() => null)
    expect(h.board).not.toHaveBeenCalled()
  })
})
