// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { allStarsSGConfig } from '@/lib/survivor-guillotine/config'
const db = vi.hoisted(() => ({
  survivorGuillotineLeague: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  survivorGuillotinePower: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  player: { findUnique: vi.fn() }, sportsPlayer: { findMany: vi.fn() }, roster: { findMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  league: { findUniqueOrThrow: vi.fn() }, leagueTeam: { findFirst: vi.fn() },
  gameSchedule: { findFirst: vi.fn() }, leagueChatMessage: { create: vi.fn() },
  redraftRosterPlayer: { updateMany: vi.fn() }, afRosterLineupAssignment: { deleteMany: vi.fn() }, $transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
import { activateSGRetiredIdol, prepareSGRetiredIdol } from '@/lib/survivor-guillotine/gauntletIdolService'
import type { Prisma } from '@prisma/client'

beforeEach(() => {
  vi.clearAllMocks()
  db.survivorGuillotineLeague.findUniqueOrThrow.mockResolvedValue({ config: allStarsSGConfig(), status: 'active',
    currentPeriod: 11, revision: 4, periodState: { period: 11, ceremonyStarted: false } })
  db.survivorGuillotineLeague.updateMany.mockResolvedValue({ count: 1 })
  db.survivorGuillotinePower.findFirst.mockResolvedValue({ id: 'idol', playerId: 'retired', expiresAfterPeriod: 13, status: 'held' })
  db.survivorGuillotinePower.count.mockResolvedValue(0)
  db.survivorGuillotinePower.updateMany.mockResolvedValue({ count: 1 })
  db.league.findUniqueOrThrow.mockResolvedValue({ season: 2050, sport: 'NFL', userId: 'commissioner' })
  db.gameSchedule.findFirst.mockResolvedValue({ startTime: new Date('2050-11-10T00:20:00Z') })
  db.leagueTeam.findFirst.mockResolvedValue({ externalId: 'roster', teamName: 'My Team' })
  db.roster.findUniqueOrThrow.mockResolvedValue({ playerData: { players: ['retired', 'active'], lineup_sections: { bench: ['retired'], starters: ['active'] } }, redraftRosterId: 'redraft' })
  db.roster.findMany.mockResolvedValue([])
  db.sportsPlayer.findMany.mockResolvedValue([{ name: 'Retired Player', status: 'Inactive', team: null, fetchedAt: new Date() }])
  db.redraftRosterPlayer.updateMany.mockResolvedValue({ count: 1 })
  db.$transaction.mockImplementation(fn => fn(db))
})

describe('announced retired-player Gauntlet idol', () => {
  it('drops the owned retired player, seals manager protection, and announces it in one transaction', async () => {
    await activateSGRetiredIdol('L', 'manager', 'idol')
    expect(db.roster.update.mock.calls[0][0].data.playerData.players).toEqual(['active'])
    expect(db.roster.update.mock.calls[0][0].data.playerData.lineup_sections.bench).toEqual([])
    expect(db.survivorGuillotinePower.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'sealed', binding: 'manager', ownerUserId: 'manager', targetRosterId: 'roster' })
    expect(db.leagueChatMessage.create.mock.calls[0][0].data.metadata.event).toBe('gauntlet_idol_played')
  })
  it('blocks a late play before any roster or power writes', async () => {
    db.gameSchedule.findFirst.mockResolvedValue({ startTime: new Date('2020-01-01T00:00:00Z') })
    await expect(activateSGRetiredIdol('L', 'manager', 'idol')).rejects.toThrow('before the first')
    expect(db.roster.update).not.toHaveBeenCalled()
    expect(db.survivorGuillotinePower.updateMany).not.toHaveBeenCalled()
  })
  it('requires actual roster ownership and keeps the sealed-auction mode separate', async () => {
    db.roster.findUniqueOrThrow.mockResolvedValueOnce({ playerData: ['active'], redraftRosterId: 'redraft' })
    await expect(activateSGRetiredIdol('L', 'manager', 'idol')).rejects.toThrow('Win and roster')
    db.survivorGuillotineLeague.findUniqueOrThrow.mockResolvedValueOnce({ config: { ...allStarsSGConfig(), gauntletIdolMode: 'sealed_auction' }, status: 'active', currentPeriod: 11, periodState: { period: 11 } })
    await expect(activateSGRetiredIdol('L', 'manager', 'idol')).rejects.toThrow('only playable')
  })
  it('announces a known retired player in the waiver pool and refuses active-player substitutes', async () => {
    db.survivorGuillotinePower.findFirst.mockResolvedValue(null)
    await prepareSGRetiredIdol(db as unknown as Prisma.TransactionClient, 'L', allStarsSGConfig(), 11, 'retired')
    expect(db.survivorGuillotinePower.create.mock.calls[0][0].data).toMatchObject({ playerId: 'retired', binding: 'player', source: 'gauntlet_retired', expiresAfterPeriod: 13 })
    db.sportsPlayer.findMany.mockResolvedValue([{ name: 'Active Player', status: 'Active', team: 'KC', fetchedAt: new Date() }])
    await expect(prepareSGRetiredIdol(db as unknown as Prisma.TransactionClient, 'L', allStarsSGConfig(), 12, 'active')).rejects.toThrow('inactive/retired')
  })
  it('retains an unused idol and recirculates only in a later Gauntlet period', async () => {
    await prepareSGRetiredIdol(db as unknown as Prisma.TransactionClient, 'L', allStarsSGConfig(), 12, 'retired')
    expect(db.survivorGuillotinePower.create).not.toHaveBeenCalled()
    await prepareSGRetiredIdol(db as unknown as Prisma.TransactionClient, 'L', allStarsSGConfig(), 12, 'another')
    expect(db.survivorGuillotinePower.create).not.toHaveBeenCalled()
    db.survivorGuillotinePower.findFirst.mockResolvedValue(null)
    db.survivorGuillotinePower.count.mockResolvedValueOnce(1)
    await prepareSGRetiredIdol(db as unknown as Prisma.TransactionClient, 'L', allStarsSGConfig(), 11, 'retired')
    expect(db.survivorGuillotinePower.create).not.toHaveBeenCalled()
    await prepareSGRetiredIdol(db as unknown as Prisma.TransactionClient, 'L', allStarsSGConfig(), 12, 'retired')
    expect(db.survivorGuillotinePower.create).toHaveBeenCalledTimes(1)
  })
})
