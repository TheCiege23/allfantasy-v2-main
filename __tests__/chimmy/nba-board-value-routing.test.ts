/** get_player_value routing (2026-11-16): an NBA league in scope answers from its board; otherwise the NFL values. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ board: vi.fn(), nfl: vi.fn() }))
vi.mock('@/lib/chimmy/sportBoardValue', () => ({ buildSportBoardValueContext: h.board }))
vi.mock('@/lib/chimmy/tools/playerValueTool', () => ({ buildPlayerValueContext: h.nfl }))

import { executeChimmyTool, type ChimmyToolContext } from '@/lib/chimmy/tools/chimmyTools'

beforeEach(() => {
  vi.clearAllMocks()
  h.nfl.mockResolvedValue('NFL VALUE')
})

describe('get_player_value', () => {
  it('in an NBA league: the league board, and the NFL table is not read', async () => {
    h.board.mockResolvedValue('NBA VALUE for Nikola Jokic')
    const out = await executeChimmyTool('get_player_value', { player: 'Nikola Jokic' }, { leagueId: 'L1', userId: 'u1' } as ChimmyToolContext)
    expect(out).toBe('NBA VALUE for Nikola Jokic')
    expect(h.board).toHaveBeenCalledWith({ leagueId: 'L1', playerName: 'Nikola Jokic' })
    expect(h.nfl).not.toHaveBeenCalled()
  })

  it('a league of another sport (board returns null), or no league: the NFL values as before', async () => {
    h.board.mockResolvedValue(null)
    expect(await executeChimmyTool('get_player_value', { player: 'Josh Allen' }, { leagueId: 'L2', userId: 'u1' } as ChimmyToolContext)).toBe('NFL VALUE')
    expect(await executeChimmyTool('get_player_value', { player: 'Josh Allen' }, { leagueId: null, userId: 'u1' } as ChimmyToolContext)).toBe('NFL VALUE')
    expect(h.board).toHaveBeenCalledTimes(1)
  })
})

describe('explain_value in an NBA league', () => {
  it('answers "why" from the league board; another sport asked for goes to the engine path', async () => {
    h.board.mockResolvedValue('NBA VALUE for Nikola Jokic …')
    const out = await executeChimmyTool('explain_value', { player: 'Nikola Jokic' }, { leagueId: 'L1', userId: 'u1' } as ChimmyToolContext)
    expect(out).toBe("WHY (the league's own value, step by step):\nNBA VALUE for Nikola Jokic …")
    h.board.mockClear()
    await executeChimmyTool('explain_value', { player: 'Josh Allen', sport: 'NFL' }, { leagueId: 'L1', userId: 'u1' } as ChimmyToolContext).catch(() => null)
    expect(h.board).not.toHaveBeenCalled()
  })
})
