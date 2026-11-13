// @vitest-environment node
/**
 * Guilly: free-agent adds freeze for EVERY team while a finished week's chop is pending (owner's call,
 * 2026-11-07). The chop only names the team it eliminates when it runs — after stat corrections and
 * tiebreaks — so before this the team about to be chopped could keep adding free agents, taking them
 * from the survivors until the chop released them. Waiver claims are unaffected: the waiver run is held
 * by the same verdict and settles them after the chop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const chop = vi.hoisted(() => vi.fn(async () => ({ hold: true as boolean, week: 5, message: 'held' })))
vi.mock('@/lib/guillotine/chopBeforeWaivers', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return { ...real, guillotineChopPendingForWaivers: chop }
})
vi.mock('@/lib/prisma', () => ({ prisma: { waiverClaim: { findFirst: async () => null } } }))
vi.mock('@/lib/waiver-wire', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ normalizedWaiverType: 'fcfs', instantFaAfterClear: false, freeAgencyMode: null }),
}))
vi.mock('@/lib/waiver-wire/season-phase-gate', () => ({ loadWaiverPhasePolicy: async () => ({ immediateAddsAllowed: true, firstComeAdds: false }) }))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: async () => ({ ok: true }) }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: async () => ({ ok: true }) }))
vi.mock('@/lib/waiver-wire/daily-schedule-gate', () => ({
  loadDailyTransactionPolicy: async () => null,
  dailyScheduleImmediateAddRefusal: async () => null,
  dailyUnlockImmediateAddRefusal: async () => null,
  PENDING_CLAIM_ON_PLAYER_MESSAGE: 'pending',
}))

import { checkImmediateAddGate } from '@/lib/waiver-wire/immediateAddGate'

const add = (rosterId: string) => checkImmediateAddGate({ leagueId: 'L', rosterId, userId: 'u', addPlayerId: '7001', dropPlayerId: null })

describe('a pending Guilly chop freezes free-agent adds', () => {
  beforeEach(() => {
    chop.mockClear()
    chop.mockResolvedValue({ hold: true, week: 5, message: 'held' })
  })

  it('refuses every team — the lowest scorer and the leader alike — with the week named', async () => {
    for (const rosterId of ['LOWEST', 'LEADER']) {
      const r = await add(rosterId)
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.code).toBe('ROSTER_LOCKED')
      expect(r.status).toBe(423)
      expect(r.error).toMatch(/week 5's chop/)
      expect(r.error).toMatch(/waiver claim/)
      expect(r.extra).toEqual({ chopPendingWeek: 5 })
    }
    expect(chop).toHaveBeenCalledWith('L')
  })

  it('adds go through again once the chop has landed (or in any league with no chop pending)', async () => {
    chop.mockResolvedValue({ hold: false } as never)
    expect(await add('LOWEST')).toEqual({ ok: true, firstComeAdds: false })
  })
})
