import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `readManagerActivity` — a manager who claimed their team on AllFantasy must still be credited
 * with their moves.
 *
 * 🛑 WHAT WAS BROKEN. The ingest keys a move by the AllFantasy user id when the mover's team is
 * claimed, and by `sleeper:<ownerId>` otherwise. The read only knew the second form, so every move
 * by a manager who linked their account vanished: the Commissioner Hub, the Workspace
 * inactive-managers task and the recipe sender all called those managers inactive. Measured on
 * production 2026-09-17: 23 accounts across 118 leagues, including an owner in their own league.
 */

const mocks = vi.hoisted(() => ({
  leagueFindFirst: vi.fn(),
  snapshotFindFirst: vi.fn(),
  snapshotFindMany: vi.fn(),
  teamFindMany: vi.fn(),
  activityFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: mocks.leagueFindFirst },
    rosterSnapshot: { findFirst: mocks.snapshotFindFirst, findMany: mocks.snapshotFindMany },
    leagueTeam: { findMany: mocks.teamFindMany },
    decisionOsImportedActivity: { findMany: mocks.activityFindMany },
  },
}))

import { readManagerActivity } from '@/lib/league-history/leagueWarehouseReads'

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)

type Team = { externalId: string; teamName: string | null; ownerName: string | null; claimedByUserId: string | null }
let teams: Team[] = []

const move = (daysAgo: number, ...managerKeys: string[]) => ({
  occurredAt: ago(daysAgo),
  normalized: { managerKeys, activityType: 'waiver' },
})

beforeEach(() => {
  vi.clearAllMocks()
  teams = [
    { externalId: '1', teamName: 'Ada', ownerName: 'ada-owner', claimedByUserId: null },
    { externalId: '2', teamName: 'Bea', ownerName: 'bea-owner', claimedByUserId: 'af-user-bea' },
    { externalId: '3', teamName: null, ownerName: 'cy-owner', claimedByUserId: null },
  ]
  mocks.leagueFindFirst.mockResolvedValue({ platform: 'sleeper', platformLeagueId: 'sl-1' })
  mocks.snapshotFindFirst.mockResolvedValue({ season: 2026 })
  mocks.snapshotFindMany.mockResolvedValue([
    { teamId: '1', rosterPlayers: [{ ownerId: 'o-ada' }] },
    { teamId: '2', rosterPlayers: [{ ownerId: 'o-bea' }] },
    { teamId: '3', rosterPlayers: [{ ownerId: 'o-cy' }] },
  ])
  // The read asks for all teams (names) and for claimed teams; answer each as Prisma would.
  mocks.teamFindMany.mockImplementation(async (args: { where: { claimedByUserId?: unknown } }) =>
    args.where.claimedByUserId ? teams.filter((t) => t.claimedByUserId) : teams,
  )
  mocks.activityFindMany.mockResolvedValue([])
})

describe('a claimed manager keeps their moves', () => {
  it('credits a move keyed by the AllFantasy user to the team that user claimed', async () => {
    mocks.activityFindMany.mockResolvedValue([move(2, 'af-user-bea'), move(3, 'sleeper:o-ada')])

    const out = await readManagerActivity('lg-1', 14)

    expect(out).toEqual([
      { managerName: 'Ada', currentCount: 1, priorCount: 0 },
      { managerName: 'Bea', currentCount: 1, priorCount: 0 },
    ])
  })

  it('merges a team’s provider-keyed and AllFantasy-keyed moves into one row', async () => {
    // Moved before claiming (provider key), then after (AllFantasy key).
    mocks.activityFindMany.mockResolvedValue([move(20, 'sleeper:o-bea'), move(1, 'af-user-bea'), move(5, 'af-user-bea')])

    const out = await readManagerActivity('lg-1', 14)

    expect(out).toEqual([{ managerName: 'Bea', currentCount: 2, priorCount: 1 }])
  })

  it('counts a move once for a team even when it carries two of that team’s keys', async () => {
    teams[0].claimedByUserId = null
    mocks.snapshotFindMany.mockResolvedValue([{ teamId: '1', rosterPlayers: [{ ownerId: 'o-ada' }, { ownerId: 'o-ada-co' }] }])
    mocks.activityFindMany.mockResolvedValue([move(1, 'sleeper:o-ada', 'sleeper:o-ada-co')])

    const out = await readManagerActivity('lg-1', 14)

    expect(out).toEqual([{ managerName: 'Ada', currentCount: 1, priorCount: 0 }])
  })

  it('credits both sides of a trade', async () => {
    mocks.activityFindMany.mockResolvedValue([move(1, 'af-user-bea', 'sleeper:o-cy')])

    const out = await readManagerActivity('lg-1', 14)

    // Team 3 has no team name, so the owner handle is its label — as everywhere else.
    expect(out).toEqual([
      { managerName: 'Bea', currentCount: 1, priorCount: 0 },
      { managerName: 'cy-owner', currentCount: 1, priorCount: 0 },
    ])
  })
})

describe('what it still refuses to guess', () => {
  it('leaves out an AllFantasy key whose user claimed two teams in the league', async () => {
    teams[0].claimedByUserId = 'af-user-bea'
    mocks.activityFindMany.mockResolvedValue([move(1, 'af-user-bea'), move(1, 'sleeper:o-cy')])

    const out = await readManagerActivity('lg-1', 14)

    expect(out).toEqual([{ managerName: 'cy-owner', currentCount: 1, priorCount: 0 }])
  })

  it('leaves out keys that match no current owner or claimer', async () => {
    mocks.activityFindMany.mockResolvedValue([move(1, 'sleeper:o-gone'), move(1, 'af-user-stranger')])

    expect(await readManagerActivity('lg-1', 14)).toEqual([])
  })

  it('still answers nothing when no snapshot names an owner', async () => {
    mocks.snapshotFindMany.mockResolvedValue([{ teamId: '1', rosterPlayers: [] }])
    mocks.activityFindMany.mockResolvedValue([move(1, 'af-user-bea')])

    expect(await readManagerActivity('lg-1', 14)).toEqual([])
    expect(mocks.activityFindMany).not.toHaveBeenCalled()
  })
})
