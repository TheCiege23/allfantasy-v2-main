// @vitest-environment node
/**
 * Saved lineups are re-checked after the roster layout changes (lib/roster-legality/recheckLeagueLineups.ts, 2026-11-15).
 * The commissioner learns how many need moves; those managers (people, not empty seats) are alerted; nothing is moved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rosters: vi.fn(),
  evaluate: vi.fn(),
  dispatch: vi.fn(async () => ({ requested: 1, suppressed: 0, delivered: 1, failed: 0 })),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { roster: { findMany: h.rosters } } }))
vi.mock('@/lib/roster-legality/loadLegalityEvaluationContext', () => ({ evaluateLegalityForPersistedRoster: h.evaluate }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))

import { alertManagersToFixLineups, findLineupsNeedingFixes } from '@/lib/roster-legality/recheckLeagueLineups'

const legal = { result: { isLegal: true, requiredMovesCount: 0 } }
const illegal = (n: number) => ({ result: { isLegal: false, requiredMovesCount: n } })

beforeEach(() => vi.clearAllMocks())

describe('after a slot change', () => {
  it('finds every saved lineup that no longer fits, with the moves it needs', async () => {
    h.rosters.mockResolvedValue([
      { id: 'r1', leagueId: 'L1', playerData: {}, platformUserId: 'u1' },
      { id: 'r2', leagueId: 'L1', playerData: {}, platformUserId: 'u2' },
      { id: 'r3', leagueId: 'L1', playerData: {}, platformUserId: 'orphan-3' },
    ])
    h.evaluate.mockImplementation(async (r: { id: string }) => (r.id === 'r2' ? legal : illegal(r.id === 'r1' ? 2 : 1)))
    expect(await findLineupsNeedingFixes('L1')).toEqual([
      { rosterId: 'r1', userId: 'u1', requiredMoves: 2 },
      { rosterId: 'r3', userId: null, requiredMoves: 1 },
    ])
  })

  it('alerts the managers, never an empty seat, with a link to their lineup', async () => {
    await alertManagersToFixLineups('L1', [
      { rosterId: 'r1', userId: 'u1', requiredMoves: 2 },
      { rosterId: 'r3', userId: null, requiredMoves: 1 },
    ])
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['u1'], category: 'lineup_alerts', leagueId: 'L1', actionHref: '/league/L1?tab=team' }))
  })

  it('with nobody to alert it sends nothing, and a failed check reports nothing rather than throwing', async () => {
    await alertManagersToFixLineups('L1', [{ rosterId: 'r3', userId: null, requiredMoves: 1 }])
    expect(h.dispatch).not.toHaveBeenCalled()
    h.rosters.mockRejectedValue(new Error('db down'))
    expect(await findLineupsNeedingFixes('L1')).toEqual([])
  })
})
