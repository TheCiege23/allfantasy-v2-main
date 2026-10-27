// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  zombieLeagueFindUnique: vi.fn(),
  rosterFindFirst: vi.fn(),
  zombieLeagueTeamFindUnique: vi.fn(),
  zombieTeamItemCount: vi.fn(),
  zombieAnnouncementFindUnique: vi.fn(),
  redraftSeasonFindFirst: vi.fn(),
  redraftMatchupFindMany: vi.fn(),
  weeklyResolutionFindUnique: vi.fn(),
  transaction: vi.fn(),
  getConfig: vi.fn(),
  getSerumBalance: vi.fn(),
  useSerumToRevive: vi.fn(),
  notifyCommissioner: vi.fn(),
  appendAudit: vi.fn(),
  queueAnimation: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieLeague: { findUnique: h.zombieLeagueFindUnique },
    roster: { findFirst: h.rosterFindFirst },
    zombieLeagueTeam: { findUnique: h.zombieLeagueTeamFindUnique },
    zombieTeamItem: { count: h.zombieTeamItemCount },
    zombieAnnouncement: { findUnique: h.zombieAnnouncementFindUnique },
    redraftSeason: { findFirst: h.redraftSeasonFindFirst },
    redraftMatchup: { findMany: h.redraftMatchupFindMany },
    zombieWeeklyResolution: { findUnique: h.weeklyResolutionFindUnique },
    $transaction: h.transaction,
  },
}))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({ getZombieLeagueConfig: h.getConfig }))
vi.mock('@/lib/zombie/ZombieSerumEngine', () => ({
  getSerumBalance: h.getSerumBalance, useSerumToRevive: h.useSerumToRevive,
}))
vi.mock('@/lib/zombie/ZombieOwnerStatusService', () => ({ setRevived: vi.fn() }))
vi.mock('@/lib/zombie/commissionerNotificationService', () => ({ notifyCommissioner: h.notifyCommissioner }))
vi.mock('@/lib/zombie/ZombieAuditLog', () => ({ appendZombieAudit: h.appendAudit }))
vi.mock('@/lib/zombie/animationEngine', () => ({ queueAnimation: h.queueAnimation }))
vi.mock('@/lib/zombie/zombieRules', () => ({ getZombieRulesForSport: vi.fn() }))

import { processRevive } from '@/lib/zombie/serumEngine'
import { validatePreScoringWindow } from '@/lib/zombie/ambushEngine'
import { postWeeklyUpdate } from '@/lib/zombie/weeklyUpdateEngine'

beforeEach(() => {
  vi.clearAllMocks()
  h.zombieLeagueFindUnique.mockResolvedValue({ id: 'z', leagueId: 'L', season: 2026, status: 'active', currentWeek: 3 })
  h.rosterFindFirst.mockResolvedValue({ id: 'r', platformUserId: 'u' })
  h.zombieLeagueTeamFindUnique.mockResolvedValue({ id: 'team', status: 'Zombie' })
  h.getConfig.mockResolvedValue({ serumReviveCount: 2 })
  h.zombieTeamItemCount.mockResolvedValue(3)
  h.getSerumBalance.mockResolvedValue(0)
  h.queueAnimation.mockResolvedValue(undefined)
  h.notifyCommissioner.mockResolvedValue(undefined)
  h.appendAudit.mockResolvedValue(undefined)
})

describe('Zombie weekly actions', () => {
  it('revives with exactly the configured number of native serums', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }])
    const spend = vi.fn().mockResolvedValue({ count: 2 })
    const revive = vi.fn().mockResolvedValue({ count: 1 })
    h.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        zombieTeamItem: { findMany, updateMany: spend },
        zombieLeagueTeam: { updateMany: revive },
      }),
    )
    await processRevive('L', 'u', 3)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }))
    expect(spend).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['s1', 's2'] }, isUsed: false },
    }))
    expect(revive).toHaveBeenCalledOnce()
    expect(h.useSerumToRevive).not.toHaveBeenCalled()
  })

  it('rejects an ambush after scoring begins', async () => {
    h.redraftSeasonFindFirst.mockResolvedValue({ id: 'season' })
    h.redraftMatchupFindMany.mockResolvedValue([
      { status: 'final', homeScore: 80, awayScore: 71 },
    ])
    await expect(validatePreScoringWindow('L', 3, 2026)).resolves.toMatchObject({ valid: false })
    expect(h.weeklyResolutionFindUnique).not.toHaveBeenCalled()
  })

  it('does not repost an already published weekly report', async () => {
    h.zombieAnnouncementFindUnique.mockResolvedValue({ id: 'announcement', isPosted: true })
    await postWeeklyUpdate('L', 3, {
      header: 'report', sectionWhisperer: '', sectionZombies: '', sectionSurvivors: '',
      sectionBashingsMaulings: '', sectionNewInfections: '', footer: '',
      meta: { hordeSize: 1, prevHordeSize: 0, week: 3, leagueName: 'League' },
    })
    expect(h.transaction).not.toHaveBeenCalled()
  })
})
