// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  zombieLeagueFindUnique: vi.fn(),
  rosterFindFirst: vi.fn(),
  zombieLeagueTeamFindUnique: vi.fn(),
  zombieLeagueTeamFindMany: vi.fn(),
  whispererRecordFindUnique: vi.fn(),
  zombieAmbushActionCount: vi.fn(),
  chimmyActionCreate: vi.fn(),
  chimmyActionUpdate: vi.fn(),
  chimmyActionFindUniqueOrThrow: vi.fn(),
  zombieTeamItemCount: vi.fn(),
  zombieAnnouncementFindUnique: vi.fn(),
  redraftSeasonFindFirst: vi.fn(),
  redraftRosterFindFirst: vi.fn(),
  redraftRosterFindUnique: vi.fn(),
  redraftMatchupFindFirst: vi.fn(),
  zombieTeamItemUpdate: vi.fn(),
  gameScheduleFindMany: vi.fn(),
  sportsGameFindMany: vi.fn(),
  redraftMatchupFindMany: vi.fn(),
  redraftRosterFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  zombieTeamItemFindMany: vi.fn(),
  getAllStatuses: vi.fn(),
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
    roster: { findFirst: h.rosterFindFirst, findMany: h.rosterFindMany },
    redraftRoster: { findMany: h.redraftRosterFindMany, findFirst: h.redraftRosterFindFirst, findUnique: h.redraftRosterFindUnique },
    zombieLeagueTeam: { findUnique: h.zombieLeagueTeamFindUnique, findMany: h.zombieLeagueTeamFindMany },
    whispererRecord: { findUnique: h.whispererRecordFindUnique },
    zombieAmbushAction: { count: h.zombieAmbushActionCount },
    zombieChimmyAction: { create: h.chimmyActionCreate, update: h.chimmyActionUpdate, findUniqueOrThrow: h.chimmyActionFindUniqueOrThrow },
    zombieTeamItem: { count: h.zombieTeamItemCount, findMany: h.zombieTeamItemFindMany, update: h.zombieTeamItemUpdate },
    zombieAnnouncement: { findUnique: h.zombieAnnouncementFindUnique },
    redraftSeason: { findFirst: h.redraftSeasonFindFirst },
    gameSchedule: { findMany: h.gameScheduleFindMany },
    sportsGame: { findMany: h.sportsGameFindMany },
    redraftMatchup: { findMany: h.redraftMatchupFindMany, findFirst: h.redraftMatchupFindFirst },
    zombieWeeklyResolution: { findUnique: h.weeklyResolutionFindUnique },
    $transaction: h.transaction,
  },
}))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({ getZombieLeagueConfig: h.getConfig }))
vi.mock('@/lib/zombie/ZombieSerumEngine', () => ({
  getSerumBalance: h.getSerumBalance, useSerumToRevive: h.useSerumToRevive,
}))
vi.mock('@/lib/zombie/ZombieOwnerStatusService', () => ({ setRevived: vi.fn(), getAllStatuses: h.getAllStatuses }))
vi.mock('@/lib/zombie/commissionerNotificationService', () => ({ notifyCommissioner: h.notifyCommissioner }))
vi.mock('@/lib/zombie/ZombieAuditLog', () => ({ appendZombieAudit: h.appendAudit }))
vi.mock('@/lib/zombie/animationEngine', () => ({ queueAnimation: h.queueAnimation }))
vi.mock('@/lib/zombie/zombieRules', () => ({ getZombieRulesForSport: vi.fn() }))

import { finalizePendingSerumsForWeek, processRevive } from '@/lib/zombie/serumEngine'
import { processAmbushFromChimmy, validatePreScoringWindow } from '@/lib/zombie/ambushEngine'
import { postWeeklyUpdate } from '@/lib/zombie/weeklyUpdateEngine'
import { computeInfections } from '@/lib/zombie/ZombieInfectionEngine'

beforeEach(() => {
  vi.clearAllMocks()
  h.zombieLeagueFindUnique.mockResolvedValue({ id: 'z', leagueId: 'L', sport: 'NFL', season: 2026, status: 'active', currentWeek: 3, experienceMode: 'enhanced' })
  h.gameScheduleFindMany.mockResolvedValue([{ startTime: new Date(Date.now() + 60_000) }])
  h.sportsGameFindMany.mockResolvedValue([{ startTime: new Date(Date.now() + 60_000) }])
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

  it('rejects an ambush when the provider schedule is missing or already locked', async () => {
    h.redraftSeasonFindFirst.mockResolvedValue({ id: 'season' })
    h.redraftMatchupFindMany.mockResolvedValue([{ status: 'scheduled', homeScore: 0, awayScore: 0 }])
    h.sportsGameFindMany.mockResolvedValueOnce([])
    expect(await validatePreScoringWindow('L', 3, 2026)).toMatchObject({ valid: false })
    h.sportsGameFindMany.mockResolvedValueOnce([{ startTime: new Date(Date.now() - 1000) }])
    expect(await validatePreScoringWindow('L', 3, 2026)).toMatchObject({ valid: false })
    expect(h.weeklyResolutionFindUnique).not.toHaveBeenCalled()
  })

  it('an armed weapon blocks a finalized Horde infection', async () => {
    h.getConfig.mockResolvedValue({ infectionLossToZombie: true, infectionLossToWhisperer: true })
    h.getAllStatuses.mockResolvedValue([
      { rosterId: 'human', status: 'Survivor' },
      { rosterId: 'horde', status: 'Zombie' },
    ])
    h.redraftSeasonFindFirst.mockResolvedValue({ id: 'season' })
    h.redraftMatchupFindMany.mockResolvedValue([
      { id: 'matchup', homeRosterId: 'rr-horde', awayRosterId: 'rr-human', homeScore: 100, awayScore: 90, status: 'final' },
    ])
    h.redraftRosterFindMany.mockResolvedValue([
      { id: 'rr-horde', ownerId: 'zombie-user' },
      { id: 'rr-human', ownerId: 'human-user' },
    ])
    h.rosterFindMany.mockResolvedValue([
      { id: 'horde', platformUserId: 'zombie-user', redraftRosterId: 'rr-horde' },
      { id: 'human', platformUserId: 'human-user', redraftRosterId: 'rr-human' },
    ])
    h.zombieTeamItemFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ team: { rosterId: 'human' } }])
    const outcome = await computeInfections({ leagueId: 'L', week: 3, season: 2026 })
    expect(outcome.infected).toEqual([])
  })

  it('a Whisperer swap changes both scheduled matchups and spends one ambush', async () => {
    h.getConfig.mockResolvedValue({ ambushRemapMatchup: true, ambushCountPerWeek: 1 })
    h.whispererRecordFindUnique.mockResolvedValue({ id: 'rec', userId: 'whisperer', ambushesRemaining: 2 })
    h.chimmyActionCreate.mockResolvedValue({ id: 'command' })
    h.chimmyActionFindUniqueOrThrow.mockResolvedValue({ id: 'command', isValid: true })
    h.redraftSeasonFindFirst.mockResolvedValue({ id: 'season' })
    const matchups = [
      { id: 'm1', homeRosterId: 'rr-whisperer', awayRosterId: 'rr-a', status: 'scheduled', homeScore: 0, awayScore: 0 },
      { id: 'm2', homeRosterId: 'rr-target', awayRosterId: 'rr-b', status: 'scheduled', homeScore: 0, awayScore: 0 },
    ]
    h.redraftMatchupFindMany.mockResolvedValue(matchups)
    h.weeklyResolutionFindUnique.mockResolvedValue(null)
    h.zombieLeagueTeamFindMany.mockResolvedValue([
      { rosterId: 'target', status: 'Survivor', fantasyTeamName: 'Survivor Team' },
    ])
    h.rosterFindMany.mockResolvedValue([
      { id: 'whisperer-roster', platformUserId: 'whisperer' },
      { id: 'target', platformUserId: 'target-user' },
    ])
    h.redraftRosterFindMany.mockResolvedValue([
      { id: 'rr-whisperer', ownerId: 'whisperer' },
      { id: 'rr-target', ownerId: 'target-user' },
    ])
    h.zombieAmbushActionCount.mockResolvedValue(0)
    const debit = vi.fn().mockResolvedValue({ count: 1 })
    const remap = vi.fn().mockResolvedValue({ count: 1 })
    const create = vi.fn().mockResolvedValue({ id: 'ambush' })
    h.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        whispererRecord: { updateMany: debit },
        sportsGame: { findMany: vi.fn().mockResolvedValue([{ startTime: new Date(Date.now() + 60_000) }]) },
        redraftMatchup: { updateMany: remap },
        zombieAmbushAction: { count: vi.fn().mockResolvedValue(0), create },
        zombieChimmyAction: { update: h.chimmyActionUpdate },
      }),
    )
    const result = await processAmbushFromChimmy('L', 'whisperer', '@Chimmy ambush swap Survivor Team', 3)
    expect(result.isValid).toBe(true)
    expect(remap).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: 'm1' }),
      data: { awayRosterId: 'rr-target' },
    }))
    expect(remap).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: 'm2' }),
      data: { homeRosterId: 'rr-a' },
    }))
    expect(debit).toHaveBeenCalledOnce()
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

describe('weekly serum shields', () => {
  beforeEach(() => {
    h.zombieTeamItemFindMany.mockResolvedValue([{
      id: 'serum-1', itemType: 'serum', userId: 'human-user',
      team: { rosterId: 'human-roster' },
    }])
    h.redraftSeasonFindFirst.mockResolvedValue({ id: 'season' })
    h.redraftRosterFindFirst.mockResolvedValue({ id: 'redraft-human' })
    h.redraftMatchupFindFirst.mockResolvedValue({
      homeRosterId: 'redraft-zombie', awayRosterId: 'redraft-human',
      homeScore: 101, awayScore: 90,
    })
    h.redraftRosterFindUnique.mockResolvedValue({ ownerId: 'zombie-user' })
    h.rosterFindFirst.mockResolvedValue({ id: 'zombie-roster' })
    h.zombieLeagueTeamFindUnique.mockResolvedValue({ id: 'zombie-team', status: 'Zombie' })
  })

  it('selects only unspent, unexpired serums so an armed weapon stays with its owner', async () => {
    h.zombieTeamItemFindMany.mockResolvedValue([])
    await finalizePendingSerumsForWeek('L', 3, 2026)
    expect(h.zombieTeamItemFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        itemType: { contains: 'serum' }, isUsed: false, isExpired: false,
        activationState: 'pending_activation', activatesAtWeek: 3,
      }),
    }))
    expect(h.zombieTeamItemUpdate).not.toHaveBeenCalled()
  })

  it('returns a serum when a league disables infection on loss to a Zombie', async () => {
    h.getConfig.mockResolvedValue({ infectionLossToZombie: false, infectionLossToWhisperer: true })
    await finalizePendingSerumsForWeek('L', 3, 2026)
    expect(h.zombieTeamItemUpdate).toHaveBeenCalledWith({
      where: { id: 'serum-1' },
      data: { activationState: 'ready', activatesAtWeek: null },
    })
  })

  it('spends a serum when it blocks an enabled infection', async () => {
    h.getConfig.mockResolvedValue({ infectionLossToZombie: true, infectionLossToWhisperer: true })
    h.zombieLeagueTeamFindUnique
      .mockResolvedValueOnce({ id: 'zombie-team', status: 'Zombie' })
      .mockResolvedValueOnce({ id: 'human-team', status: 'Survivor' })
    await finalizePendingSerumsForWeek('L', 3, 2026)
    expect(h.zombieTeamItemUpdate).toHaveBeenCalledWith({
      where: { id: 'serum-1' },
      data: { isUsed: true, usedAtWeek: 3, activationState: 'ready' },
    })
  })
})
