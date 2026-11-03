// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: {
    league: { findMany: vi.fn() },
    survivorPlayer: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorTribeSwap: { findFirst: vi.fn() },
  },
  strikes: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/survivor/survivorConductService', () => ({ listSurvivorConductStrikes: h.strikes }))

import { loadSurvivorAttentionSignals } from '@/lib/survivor/survivorDecisionSignalInput'

describe('loadSurvivorAttentionSignals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.db.league.findMany.mockResolvedValue([{ id: 'L1', language: 'en', settings: { tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00', survivorGovernance: { tradeRulesEnabled: true, swapSchedule: [{ week: 6, mode: 'resize', tribeCount: 3 }] } } }])
    h.db.survivorPlayer.findUnique.mockResolvedValue({ playerState: 'active' })
    h.db.survivorGameState.findUnique.mockResolvedValue({ currentWeek: 6, mergeTriggeredAt: null })
    h.db.survivorTribeSwap.findFirst.mockResolvedValue(null)
    h.strikes.mockResolvedValue([{ id: 's1' }])
  })

  it('reads only Survivor leagues and the viewer’s own facts, and produces the three signals', async () => {
    const signals = await loadSurvivorAttentionSignals('u1', ['L1', 'L2'], new Date('2026-11-05T15:00:00Z'))
    expect(h.db.league.findMany).toHaveBeenCalledWith({ where: { id: { in: ['L1', 'L2'] }, survivorMode: true }, select: { id: true, settings: true, language: true } })
    expect(h.strikes).toHaveBeenCalledWith('L1', 'u1')
    expect(signals.map((s) => s.type).sort()).toEqual(['survivor_conduct_strike', 'survivor_trade_window', 'survivor_tribe_swap'])
  })

  it('a league that cannot be read contributes nothing and does not throw', async () => {
    h.db.survivorPlayer.findUnique.mockRejectedValue(new Error('down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await loadSurvivorAttentionSignals('u1', ['L1'])).toEqual([])
    warn.mockRestore()
  })

  it('no leagues, no reads', async () => {
    expect(await loadSurvivorAttentionSignals('u1', [])).toEqual([])
    expect(h.db.league.findMany).not.toHaveBeenCalled()
  })
})
