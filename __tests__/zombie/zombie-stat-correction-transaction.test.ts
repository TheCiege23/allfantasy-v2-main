// @vitest-environment node
import type { ZombieWeeklyResolution } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  matchupFindMany: vi.fn(),
  resolutionFindFirst: vi.fn(),
  native: vi.fn(),
  rules: vi.fn(),
  ledgerUpsert: vi.fn(),
  teamUpdateMany: vi.fn(),
  resolutionUpdate: vi.fn(),
  announcementUpsert: vi.fn(),
  chatUpsert: vi.fn(),
  payoutCount: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  redraftMatchup: { findMany: h.matchupFindMany },
  zombieWeeklyResolution: { findFirst: h.resolutionFindFirst },
  $transaction: h.transaction,
} }))
vi.mock('@/lib/zombie/ZombieInfectionEngine', () => ({ loadNativeWeekResults: h.native }))
vi.mock('@/lib/zombie/zombieRules', () => ({ getZombieRulesForSport: h.rules }))

import { reconcileScoreOnlyCorrection } from '@/lib/zombie/statCorrectionReconciler'

const previous = {
  status: 'complete',
  resolvedAt: new Date('2026-10-10T00:00:00Z'),
  matchupResults: [{ homeUserId: 'season-a', awayUserId: 'season-b', homeScore: 90, awayScore: 85, winnerScore: 90, loserScore: 85 }],
} as unknown as ZombieWeeklyResolution
const current = { id: 'matchup-1', homeRosterId: 'season-a', awayRosterId: 'season-b', homeScore: 91, awayScore: 85 }
const rules = {
  sport: 'NFL', bashingThreshold: 30, maulingThreshold: 50,
  weaponShieldThreshold: 100, weaponAmbushThreshold: 120, weaponAxeMargin: 20,
  reviveThreshold: 3, serumMaxHold: 5, lineupLockDesc: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.matchupFindMany.mockResolvedValue([current])
  h.resolutionFindFirst.mockResolvedValue(null)
  h.native.mockResolvedValue([{ matchupId: 'matchup-1', homeRosterId: 'a', awayRosterId: 'b', homeScore: 91, awayScore: 85, final: true }])
  h.rules.mockResolvedValue(rules)
  h.resolutionUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...previous, ...data }))
  h.announcementUpsert.mockResolvedValue({ id: 'announcement-1' })
  h.payoutCount.mockResolvedValue(0)
  h.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    zombieWeeklyResolution: { findUnique: vi.fn(async () => previous), update: h.resolutionUpdate },
    redraftMatchup: { findMany: vi.fn(async () => [current]) },
    roster: { findMany: vi.fn(async () => [
      { id: 'a', platformUserId: 'user-a' }, { id: 'b', platformUserId: 'user-b' },
    ]) },
    zombieInfectionEvent: { findMany: vi.fn(async () => []) },
    zombieExternalWeeklyPayout: { count: h.payoutCount },
    zombieWeeklyWinnings: {
      upsert: h.ledgerUpsert,
      findMany: vi.fn(async () => [{ rosterId: 'a', amount: 91 }, { rosterId: 'b', amount: 85 }]),
    },
    zombieLeagueTeam: { updateMany: h.teamUpdateMany },
    zombieBashingEvent: { findMany: vi.fn(async () => []) },
    zombieMaulingEvent: { findMany: vi.fn(async () => []) },
    zombieAnnouncement: { upsert: h.announcementUpsert },
    leagueChatMessage: { upsert: h.chatUpsert },
  }))
})

describe('transactional Zombie score correction', () => {
  it('rewrites weekly winnings and posts one correction chat record', async () => {
    const result = await reconcileScoreOnlyCorrection({
      zombieLeagueId: 'z1', leagueId: 'L1', seasonId: 's1', season: 2026,
      sport: 'NFL', week: 1, ownerUserId: 'owner', previous,
    })
    expect(result?.requiresStatCorrection).toBe(false)
    expect(h.ledgerUpsert).toHaveBeenCalledTimes(2)
    expect(h.ledgerUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ rosterId: 'a', amount: 91 }),
    }))
    expect(h.teamUpdateMany).toHaveBeenCalledTimes(2)
    expect(h.announcementUpsert).toHaveBeenCalledTimes(1)
    expect(h.chatUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ zombieWeeklyAnnouncementId: 'announcement-1' }),
    }))
  })

  it('holds score-only correction after an external prize is recorded', async () => {
    h.payoutCount.mockResolvedValue(1)
    const result = await reconcileScoreOnlyCorrection({
      zombieLeagueId: 'z1', leagueId: 'L1', seasonId: 's1', season: 2026,
      sport: 'NFL', week: 1, ownerUserId: 'owner', previous,
    })
    expect(result).toBeNull()
    expect(h.ledgerUpsert).not.toHaveBeenCalled()
    expect(h.teamUpdateMany).not.toHaveBeenCalled()
  })

  it('does not enter the transaction when an award threshold changes', async () => {
    h.matchupFindMany.mockResolvedValue([{ ...current, homeScore: 101 }])
    const result = await reconcileScoreOnlyCorrection({
      zombieLeagueId: 'z1', leagueId: 'L1', seasonId: 's1', season: 2026,
      sport: 'NFL', week: 1, ownerUserId: 'owner', previous,
    })
    expect(result).toBeNull()
    expect(h.transaction).not.toHaveBeenCalled()
  })
})
