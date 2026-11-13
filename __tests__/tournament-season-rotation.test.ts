import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimNextSeasonTournament, rotateSeasonRooms } from '@/lib/tournament/seasonTournamentRotation'

const { prisma, tx, cursors } = vi.hoisted(() => {
  const cursors = new Map<string, string>()
  const platformConfig = {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
      const value = cursors.get(where.key)
      return value === undefined ? null : { value }
    }),
    upsert: vi.fn(async ({ where, update }: { where: { key: string }; update: { value: string } }) => {
      cursors.set(where.key, update.value)
    }),
  }
  const tx = { platformConfig, tournamentShell: { findFirst: vi.fn() }, $queryRaw: vi.fn() }
  const prisma = { platformConfig, $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)) }
  return { prisma, tx, cursors }
})
vi.mock('@/lib/prisma', () => ({ prisma }))

let eligibleIds: string[]
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-10T15:00:00Z'))
  cursors.clear()
  eligibleIds = ['a', 'b', 'c', 'd', 'e']
  tx.tournamentShell.findFirst.mockImplementation(async ({ where }) => {
    const id = eligibleIds.find(id => where.id === undefined || id > where.id.gt)
    return id ? { id } : null
  })
})
afterEach(() => vi.useRealTimers())

describe('native tournament worker rotation', () => {
  it('gives all five tournaments a turn on a five-minute cadence and wraps', async () => {
    const picked: (string | undefined)[] = []
    for (let tick = 0; tick < 6; tick++) {
      picked.push((await claimNextSeasonTournament())?.id)
      vi.setSystemTime(Date.now() + 5 * 60_000)
    }
    expect(picked).toEqual(['a', 'b', 'c', 'd', 'e', 'a'])
    expect(prisma.$transaction).toHaveBeenCalledTimes(6)
    expect(tx.$queryRaw).toHaveBeenCalledTimes(6)
    expect(tx.tournamentShell.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'rules_published', sport: { in: ['NFL', 'NBA'] },
        auditLogs: { some: { action: 'season_opening_field_frozen' } },
      }),
    }))
  })

  it('continues after the prior tournament completes and across same-tick retries', async () => {
    expect(await claimNextSeasonTournament()).toEqual({ id: 'a' })
    eligibleIds = ['b', 'c', 'd', 'e']
    expect(await claimNextSeasonTournament()).toEqual({ id: 'b' })
    expect(await claimNextSeasonTournament()).toEqual({ id: 'c' })
    eligibleIds = []
    expect(await claimNextSeasonTournament()).toBeNull()
    eligibleIds = ['a', 'b', 'd', 'e']
    expect(await claimNextSeasonTournament()).toEqual({ id: 'd' })
  })

  it('gives every room the first slot even if each sweep exhausts its budget immediately', async () => {
    const firstRooms: string[] = []
    for (let tick = 0; tick < 6; tick++) {
      firstRooms.push((await rotateSeasonRooms('native', eligibleIds))[0]!)
      vi.setSystemTime(Date.now() + 5 * 60_000)
    }
    expect(firstRooms).toEqual(['a', 'b', 'c', 'd', 'e', 'a'])
    expect(await rotateSeasonRooms('native', ['final-a', 'final-b'])).toEqual(['final-a', 'final-b'])
    expect(await rotateSeasonRooms('native', ['final-a', 'final-b'])).toEqual(['final-b', 'final-a'])
    expect(await rotateSeasonRooms('other', ['final-a', 'final-b'])).toEqual(['final-a', 'final-b'])
  })
})
