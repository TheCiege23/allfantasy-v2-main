import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The redraft waiver run tells each manager how their claim went (2026-11-15), and an alert that fails
 * never touches the run. Same harness as waiver-eliminated-roster.test.ts: a claim from a chopped team is
 * denied, so the run is real without needing a roster write.
 */

const db = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn() },
  redraftWaiverClaim: { findMany: vi.fn(), update: vi.fn() },
  redraftRoster: { findFirst: vi.fn(), findMany: vi.fn() },
  redraftRosterPlayer: { findFirst: vi.fn() },
  survivorGameState: { findUnique: vi.fn() },
}))
const dispatch = vi.hoisted(() => vi.fn(async () => ({ delivered: 1, failed: 0 })))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: dispatch }))

import { processWaiverWindow } from '@/lib/redraft/waiverEngine'

beforeEach(() => {
  vi.clearAllMocks()
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', leagueId: 'L1', sport: 'NFL' })
  db.redraftWaiverClaim.findMany.mockResolvedValue([
    { id: 'c1', rosterId: 'rr-chopped', addPlayerId: 'p1', addPlayerName: 'Released Star', bidAmount: 40, priority: 1 },
  ])
  db.redraftRoster.findFirst.mockResolvedValue({ id: 'rr-chopped', isEliminated: true, faabBalance: 100 })
  db.redraftRoster.findMany.mockResolvedValue([{ id: 'rr-chopped', ownerId: 'u-ann' }])
  db.redraftWaiverClaim.update.mockResolvedValue({})
  db.survivorGameState.findUnique.mockResolvedValue(null)
})

describe('redraft waiver results reach the manager', () => {
  it('a settled claim is told to the person who made it', async () => {
    await processWaiverWindow('L1', 's1')
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['u-ann'],
        category: 'waiver_processing',
        type: 'waiver_claim_lost',
        title: 'Waiver claim not awarded: Released Star',
        body: 'Your claim did not go through. This team has been eliminated.',
        dedupePrefix: 'redraft-waiver-result:c1',
      }),
    )
  })

  it('addresses a second franchise’s result to the manager account', async () => {
    db.redraftRoster.findMany.mockResolvedValue([{ id: 'rr-chopped', ownerId: 'mgr:u-ann:team-2', managerUserId: 'u-ann' }])
    await processWaiverWindow('L1', 's1')
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['u-ann'] })))
  })

  it('🛑 a failed owner read costs the alert, never the run', async () => {
    db.redraftRoster.findMany.mockRejectedValue(new Error('db down'))
    const results = await processWaiverWindow('L1', 's1')
    expect(results).toEqual([{ claimId: 'c1', status: 'denied', reason: 'This team has been eliminated.' }])
    await new Promise((r) => setTimeout(r, 20))
    expect(dispatch).not.toHaveBeenCalled()
  })
})
