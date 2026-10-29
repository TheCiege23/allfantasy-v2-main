// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Native Zombie leagues printed raw ids: team rows were never named, and the Whisperer record stored the
 * manager's user id as their name. One resolver now names teams and managers, never with an id.
 */

const db = vi.hoisted(() => ({
  roster: { findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  userProfile: { findMany: vi.fn(), findUnique: vi.fn() },
  appUser: { findMany: vi.fn(), findUnique: vi.fn() },
  zombieLeagueTeam: { findMany: vi.fn(), update: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  isUnmannedSeat,
  resolveZombieNames,
  syncZombieTeamNames,
  withWhispererDisplayName,
} from '@/lib/zombie/zombieTeamNames'

const U = 'a2d4b0c3-b8c4-467e-a4cd-450e4a36f4bd'

describe('isUnmannedSeat', () => {
  it('treats open, orphaned and native open seats as nobody', () => {
    expect(isUnmannedSeat('open-slot-L1-2')).toBe(true)
    expect(isUnmannedSeat('orphan-R9')).toBe(true)
    expect(isUnmannedSeat('roster:R9')).toBe(true)
    expect(isUnmannedSeat(null)).toBe(true)
    expect(isUnmannedSeat(U)).toBe(false)
  })
})

describe('resolveZombieNames', () => {
  const teams = [
    { id: 't1', externalId: 'R1', platformUserId: U, teamName: 'Brain Drain', ownerName: 'owner-from-team' },
    { id: 't2', externalId: 'R2', platformUserId: 'open-slot-L1-2', teamName: 'Open Team 2', ownerName: '' },
  ]
  it('names the team by identity and the manager by their profile', () => {
    const names = resolveZombieNames(
      [
        { id: 'R2', platformUserId: 'open-slot-L1-2', playerData: null },
        { id: 'R1', platformUserId: U, playerData: null },
      ],
      teams,
      new Map([[U, { displayName: null, username: 'guap' }]]),
    )
    expect(names.get('R1')).toEqual({ teamName: 'Brain Drain', managerName: 'guap' })
    // An open seat has a team name and no manager — never its placeholder id.
    expect(names.get('R2')).toEqual({ teamName: 'Open Team 2', managerName: null })
  })
  it('never falls back to an id', () => {
    const names = resolveZombieNames([{ id: 'R9', platformUserId: 'u-9', playerData: null }], [], new Map())
    expect(names.get('R9')).toEqual({ teamName: null, managerName: null })
  })
})

describe('syncZombieTeamNames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.roster.findMany.mockResolvedValue([
      { id: 'R1', platformUserId: U, playerData: null, redraftRoster: null },
      { id: 'R2', platformUserId: 'u-2', playerData: null, redraftRoster: null },
    ])
    db.leagueTeam.findMany.mockResolvedValue([
      { id: 't1', externalId: 'x1', platformUserId: U, claimedByUserId: U, teamName: 'Brain Drain', ownerName: '' },
    ])
    db.userProfile.findMany.mockResolvedValue([{ userId: U, displayName: 'Guap' }])
    db.appUser.findMany.mockResolvedValue([{ id: U, displayName: null, username: 'guap' }])
  })

  it('names bare rows, keeps an existing name it cannot improve, and skips unchanged rows', async () => {
    db.zombieLeagueTeam.findMany.mockResolvedValue([
      { rosterId: 'R1', displayName: null, fantasyTeamName: null },
      { rosterId: 'R2', displayName: 'Imported Name', fantasyTeamName: 'Imported Team' },
    ])
    expect(await syncZombieTeamNames('L1')).toBe(1)
    expect(db.zombieLeagueTeam.update).toHaveBeenCalledTimes(1)
    expect(db.zombieLeagueTeam.update).toHaveBeenCalledWith({
      where: { leagueId_rosterId: { leagueId: 'L1', rosterId: 'R1' } },
      data: { fantasyTeamName: 'Brain Drain', displayName: 'Guap' },
    })
  })
})

describe('withWhispererDisplayName', () => {
  beforeEach(() => vi.clearAllMocks())

  it('repairs a record that stored the user id as the name', async () => {
    db.userProfile.findUnique.mockResolvedValue({ displayName: null })
    db.appUser.findUnique.mockResolvedValue({ displayName: null, username: 'guap' })
    const rec = await withWhispererDisplayName({ userId: U, displayName: U, ambushesRemaining: 3 })
    expect(rec).toEqual({ userId: U, displayName: 'guap', ambushesRemaining: 3 })
  })

  it('leaves a real name alone without a lookup', async () => {
    const rec = await withWhispererDisplayName({ userId: U, displayName: 'Guap' })
    expect(rec?.displayName).toBe('Guap')
    expect(db.appUser.findUnique).not.toHaveBeenCalled()
  })

  it('falls back to the role, never the id, when nothing resolves', async () => {
    db.userProfile.findUnique.mockRejectedValue(new Error('db down'))
    const rec = await withWhispererDisplayName({ userId: U, displayName: null })
    expect(rec?.displayName).toBe('The Whisperer')
  })
})

describe('ensureLeagueTeamRows names the rows it seeds', () => {
  it('runs the name sync after creating the rows', async () => {
    vi.clearAllMocks()
    const created: string[] = []
    ;(db.zombieLeagueTeam as Record<string, unknown>).create = vi.fn(async ({ data }: { data: { rosterId: string } }) => {
      created.push(data.rosterId)
    })
    db.roster.findMany.mockResolvedValue([{ id: 'R1', platformUserId: U, playerData: null, redraftRoster: null }])
    db.leagueTeam.findMany.mockResolvedValue([
      { id: 't1', externalId: 'x1', platformUserId: U, claimedByUserId: U, teamName: 'Brain Drain', ownerName: '' },
    ])
    db.userProfile.findMany.mockResolvedValue([{ userId: U, displayName: 'Guap' }])
    db.appUser.findMany.mockResolvedValue([])
    db.zombieLeagueTeam.findMany
      .mockResolvedValueOnce([]) // ensure: none exist yet
      .mockResolvedValueOnce([{ rosterId: 'R1', displayName: null, fantasyTeamName: null }]) // sync
    const { ensureLeagueTeamRows } = await import('@/lib/zombie/ZombieOwnerStatusService')
    await ensureLeagueTeamRows('L1', 'z1')
    expect(created).toEqual(['R1'])
    expect(db.zombieLeagueTeam.update).toHaveBeenCalledWith({
      where: { leagueId_rosterId: { leagueId: 'L1', rosterId: 'R1' } },
      data: { fantasyTeamName: 'Brain Drain', displayName: 'Guap' },
    })
  })
})
