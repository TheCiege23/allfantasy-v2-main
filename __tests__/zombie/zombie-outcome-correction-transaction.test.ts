// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const f = () => vi.fn()
  const db = {
    redraftMatchup: { findMany: f() },
    zombieWeeklyResolution: { findFirst: f(), findUnique: f(), count: f(), update: f() },
    zombieBashingEvent: { count: f() },
    zombieMaulingEvent: { count: f() },
    zombieChimmyAction: { count: f() },
    zombieExternalWeeklyPayout: { count: f() },
    roster: { findMany: f() },
    zombieTeamItem: { findMany: f(), deleteMany: f(), update: f(), create: f() },
    zombieLeagueTeam: { findMany: f(), update: f(), updateMany: f() },
    zombieInfectionLog: { findMany: f(), deleteMany: f(), create: f() },
    zombieInfectionEvent: { findMany: f(), deleteMany: f(), create: f() },
    zombieWeeklyWinnings: { upsert: f(), findMany: f() },
    zombieAnnouncement: { updateMany: f(), upsert: f() },
    leagueChatMessage: { upsert: f() },
    whispererRecord: { update: f() },
    $transaction: f(),
  }
  return { db, weekResults: f(), winnings: f() }
})
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/zombie/ZombieInfectionEngine', () => ({
  loadNativeWeekResults: h.weekResults,
}))
vi.mock('@/lib/zombie/weeklyWinningsEngine', () => ({
  computeWeeklyWinnings: h.winnings,
}))

import { reconcileOutcomeChangingCorrection } from '@/lib/zombie/outcomeCorrectionReconciler'

const resolvedAt = new Date('2026-10-27T12:00:00.000Z')
const matchup = {
  id: 'm', homeRosterId: 'rr-z', awayRosterId: 'rr-h', homeScore: 101, awayScore: 90,
}
const snapshot = {
  version: 1, capturedAt: '2026-10-27T11:00:00.000Z',
  owners: [{ rosterId: 'z', userId: 'z-user' }, { rosterId: 'h', userId: 'h-user' }],
  teams: [
    {
      id: 'tz', rosterId: 'z', status: 'Zombie', weekBecameZombie: 1,
      killedByRosterId: null, revivedAt: null, ambushesRemaining: 0, ambushesUsed: 0,
      infectionCount: 0, isWhisperer: false, killedAtWeek: null, killedByUserId: null,
      survivorWinStreak: 0, zombieAttacksSurvived: 0,
    },
    {
      id: 'th', rosterId: 'h', status: 'Survivor', weekBecameZombie: null,
      killedByRosterId: null, revivedAt: null, ambushesRemaining: 0, ambushesUsed: 0,
      infectionCount: 0, isWhisperer: false, killedAtWeek: null, killedByUserId: null,
      survivorWinStreak: 0, zombieAttacksSurvived: 0,
    },
  ],
  items: [], whisperer: null, coWhisperers: [],
  config: {
    infectionLossToWhisperer: true, infectionLossToZombie: true,
    serumAwardHighScore: true, serumAwardOnBashMaul: true,
    autoSerumRevive: false, serumReviveCount: 2,
  },
  rules: {
    bashingThreshold: 30, maulingThreshold: 50, weaponAxeMargin: 20,
    weaponShieldThreshold: 100, weaponAmbushThreshold: 120,
  },
}
const previous = {
  id: 'resolution', zombieLeagueId: 'zl', week: 3, status: 'complete', resolvedAt,
  settlementSnapshot: snapshot,
  matchupResults: [{
    homeUserId: 'rr-z', awayUserId: 'rr-h', homeScore: 90, awayScore: 101,
  }],
}
const input = {
  zombieLeagueId: 'zl', leagueId: 'L', seasonId: 'season', season: 2026,
  week: 3, ownerUserId: 'commish', experienceMode: 'simple',
  previous: previous as never,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.db.redraftMatchup.findMany.mockResolvedValue([matchup])
  h.db.zombieWeeklyResolution.findFirst.mockResolvedValue(null)
  h.db.zombieWeeklyResolution.findUnique.mockResolvedValue(previous)
  h.db.zombieWeeklyResolution.count.mockResolvedValue(0)
  h.db.zombieWeeklyResolution.update.mockResolvedValue({ ...previous, requiresStatCorrection: false })
  h.db.zombieBashingEvent.count.mockResolvedValue(0)
  h.db.zombieMaulingEvent.count.mockResolvedValue(0)
  h.db.zombieChimmyAction.count.mockResolvedValue(0)
  h.db.zombieExternalWeeklyPayout.count.mockResolvedValue(0)
  h.db.roster.findMany.mockResolvedValue([
    { id: 'z', platformUserId: 'z-user' }, { id: 'h', platformUserId: 'h-user' },
  ])
  h.db.zombieTeamItem.findMany.mockResolvedValue([{
    id: 'old-serum', teamStatusId: 'th', itemType: 'serum',
    awardKey: 'serum:zl:3:weekly_high_score:h', acquiredAtWeek: 3,
    acquiredAt: new Date('2026-10-27T11:30:00.000Z'),
    usedAtWeek: null, activatesAtWeek: null,
  }])
  h.db.zombieLeagueTeam.findMany.mockResolvedValue([
    { id: 'tz', rosterId: 'z', fantasyTeamName: 'Zombies', displayName: null },
    { id: 'th', rosterId: 'h', fantasyTeamName: 'Humans', displayName: null },
  ])
  h.db.zombieInfectionLog.findMany.mockResolvedValue([])
  h.db.zombieInfectionEvent.findMany.mockResolvedValue([])
  h.db.zombieWeeklyWinnings.findMany.mockResolvedValue([
    { rosterId: 'z', amount: 191 }, { rosterId: 'h', amount: 0 },
  ])
  h.db.zombieAnnouncement.upsert.mockResolvedValue({ id: 'ann' })
  h.db.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(h.db))
  h.weekResults.mockResolvedValue([{
    matchupId: 'm', homeRosterId: 'z', awayRosterId: 'h',
    homeScore: 101, awayScore: 90, final: true,
  }])
  h.winnings.mockReturnValue({
    netByRoster: new Map([['z', 191], ['h', 0]]),
    transfers: [{
      kind: 'infection', fromRosterId: 'h', toRosterId: 'z', amount: 90,
    }],
  })
})

describe('outcome-changing correction transaction', () => {
  it('reverses old awards and commits one corrected infection, ledger, and chat update', async () => {
    const result = await reconcileOutcomeChangingCorrection(input)
    expect(result).not.toBeNull()
    expect(h.db.zombieTeamItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-serum'] } },
    })
    expect(h.db.zombieLeagueTeam.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'th' },
      data: expect.objectContaining({ status: 'Zombie', killedByRosterId: 'z' }),
    }))
    expect(h.db.zombieInfectionEvent.create).toHaveBeenCalledOnce()
    expect(h.db.zombieWeeklyWinnings.upsert).toHaveBeenCalledTimes(2)
    expect(h.db.leagueChatMessage.upsert).toHaveBeenCalledOnce()
  })

  it('holds a paid week when an external prize has been recorded', async () => {
    h.db.zombieExternalWeeklyPayout.count.mockResolvedValue(1)
    expect(await reconcileOutcomeChangingCorrection(input)).toBeNull()
    expect(h.db.zombieTeamItem.deleteMany).not.toHaveBeenCalled()
  })

  it('declines replay if an unexpected infection event was recorded', async () => {
    h.db.zombieInfectionEvent.findMany.mockResolvedValue([{
      victimUserId: 'someone-else', infectorUserId: 'z-user',
    }])
    expect(await reconcileOutcomeChangingCorrection(input)).toBeNull()
    expect(h.db.zombieInfectionLog.deleteMany).not.toHaveBeenCalled()
    expect(h.db.zombieTeamItem.deleteMany).not.toHaveBeenCalled()
  })
})
