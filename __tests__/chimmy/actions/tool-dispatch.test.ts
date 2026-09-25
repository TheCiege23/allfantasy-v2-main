import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The four tools added 2026-09-25, as the tool loop reaches them: the league comes from the
 * session context only, a card reaches the route only through the context's collector, and a
 * surface with no collector is told so instead of promised a button.
 */

const h = vi.hoisted(() => ({
  chat: vi.fn(async () => 'CHAT'),
  waivers: vi.fn(async () => 'WAIVERS'),
  lineup: vi.fn(),
  trade: vi.fn(),
}))

vi.mock('@/lib/chimmy/tools/leagueChatTool', () => ({ buildLeagueChatContext: h.chat }))
vi.mock('@/lib/chimmy/tools/waiverStatusTool', () => ({ buildWaiverStatusContext: h.waivers }))
vi.mock('@/lib/chimmy/actions/lineupAction', () => ({ proposeLineupChange: h.lineup }))
vi.mock('@/lib/chimmy/actions/tradeAction', () => ({ proposeTrade: h.trade }))

import { CHIMMY_TOOL_SPECS, executeChimmyTool, MAX_ACTION_CARDS_PER_ANSWER } from '@/lib/chimmy/tools/chimmyTools'
import type { ChimmyActionCard } from '@/lib/chimmy/actions/types'

const CARD = { actionId: 'a1', kind: 'lineup', token: 'tok' } as unknown as ChimmyActionCard
const NEW = ['get_league_chat', 'get_waiver_status', 'propose_lineup_change', 'propose_trade'] as const

beforeEach(() => {
  vi.clearAllMocks()
  h.lineup.mockResolvedValue({ ok: true, text: 'CARD READY', card: CARD })
  h.trade.mockResolvedValue({ ok: true, text: 'CARD READY', card: { ...CARD, kind: 'trade' } })
})

describe('new tool dispatch', () => {
  it.each(NEW)('%s refuses with no league in scope and runs nothing', async (name) => {
    expect(await executeChimmyTool(name, {}, { leagueId: null, userId: 'u1', actionCards: [] })).toMatch(/NO LEAGUE IS SELECTED/)
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled()
  })

  it.each(NEW)('%s takes the league from the session, never the arguments', async (name) => {
    await executeChimmyTool(
      name,
      { leagueId: 'SOMEONE-ELSES', league_id: 'SOMEONE-ELSES', start: ['A B'], bench: ['C D'], give: ['A B'], get: ['C D'] },
      { leagueId: 'L1', userId: 'u1', actionCards: [] },
    )
    const called = Object.values(h).find((fn) => fn.mock.calls.length > 0)!
    expect(called.mock.calls[0]![0]).toMatchObject({ leagueId: 'L1', userId: 'u1' })
    expect(JSON.stringify(called.mock.calls[0]![0])).not.toContain('SOMEONE-ELSES')
  })

  it('hands the chat tool its limit and search', async () => {
    await executeChimmyTool('get_league_chat', { limit: 20, search: 'Bijan' }, { leagueId: 'L1', userId: 'u1' })
    expect(h.chat).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1', limit: 20, search: 'Bijan' })
  })

  it('collects a built card into the context and returns the prose', async () => {
    const actionCards: ChimmyActionCard[] = []
    const out = await executeChimmyTool('propose_lineup_change', { start: ['A B'], bench: ['C D'] }, { leagueId: 'L1', userId: 'u1', actionCards })
    expect(out).toBe('CARD READY')
    expect(actionCards).toEqual([CARD])
    expect(h.lineup).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1', start: ['A B'], bench: ['C D'] })
  })

  it('adds no card when the proposal is refused', async () => {
    h.trade.mockResolvedValue({ ok: false, text: 'NO CARD WAS MADE: imported league' })
    const actionCards: ChimmyActionCard[] = []
    expect(await executeChimmyTool('propose_trade', { give: ['A B'], get: ['C D'] }, { leagueId: 'L1', userId: 'u1', actionCards })).toMatch(/NO CARD/)
    expect(actionCards).toEqual([])
  })

  it('prepares nothing on a surface that cannot show a card', async () => {
    const out = await executeChimmyTool('propose_trade', { give: ['A B'], get: ['C D'] }, { leagueId: 'L1', userId: 'u1' })
    expect(out).toMatch(/cannot show a confirm card/)
    expect(h.trade).not.toHaveBeenCalled()
  })

  it('caps the cards one answer can build', async () => {
    const actionCards = Array.from({ length: MAX_ACTION_CARDS_PER_ANSWER }, (_, i) => ({ ...CARD, actionId: `a${i}` }))
    expect(await executeChimmyTool('propose_lineup_change', { start: ['A B'] }, { leagueId: 'L1', userId: 'u1', actionCards })).toMatch(/already/)
    expect(h.lineup).not.toHaveBeenCalled()
  })

  it('declares no league or user parameter on any new tool', () => {
    const specs = CHIMMY_TOOL_SPECS.filter((s) => (NEW as readonly string[]).includes(s.function.name))
    expect(specs).toHaveLength(4)
    for (const spec of specs) {
      const json = JSON.stringify(spec)
      expect(json).not.toMatch(/leagueId|userId|rosterId|token/)
    }
  })
})
