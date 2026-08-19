/**
 * Decision OS — Phase 2E redraft port loader tests.
 *
 * `loadRedraftTradeRows` / `loadRedraftRosterPlayerRows` (lib/decision-os/behavioral/port.ts)
 * are the only new loaders in this phase whose query-construction logic is
 * genuinely bespoke (they join RedraftRoster to resolve a real managerId,
 * unlike the flatter existing loaders) — so unlike the pure mappers (covered
 * in behavioral-event-ports.test.ts with in-memory fixtures), these are worth
 * testing directly against a mocked Prisma client to prove the row shape
 * transformation and query filters are correct. No real database connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { findManyTradeMock, findManyRosterPlayerMock, findManyRosterMoveHistoryMock } = vi.hoisted(() => ({
  findManyTradeMock: vi.fn(),
  findManyRosterPlayerMock: vi.fn(),
  findManyRosterMoveHistoryMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftTradeProposal: { findMany: findManyTradeMock },
    redraftRosterPlayer: { findMany: findManyRosterPlayerMock },
    redraftRosterMoveHistory: { findMany: findManyRosterMoveHistoryMock },
  },
}))

import {
  loadRedraftTradeRows,
  loadRedraftRosterPlayerRows,
  loadRedraftRosterMoveRows,
} from '@/lib/decision-os/behavioral/port'

describe('loadRedraftTradeRows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves proposerOwnerId/receiverOwnerId from the joined roster rows', async () => {
    findManyTradeMock.mockResolvedValue([
      {
        id: 'rt-1',
        leagueId: 'lg-A',
        proposerRosterId: 'ros-1',
        receiverRosterId: 'ros-2',
        status: 'pending',
        vetoMode: 'commissioner',
        acceptedAt: null,
        rejectedAt: null,
        expiresAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        proposerRoster: { ownerId: 'user-1' },
        receiverRoster: { ownerId: 'user-2' },
        _count: { assets: 4 },
      },
    ])

    const rows = await loadRedraftTradeRows('lg-A')

    expect(rows).toEqual([
      {
        id: 'rt-1',
        leagueId: 'lg-A',
        proposerRosterId: 'ros-1',
        receiverRosterId: 'ros-2',
        proposerOwnerId: 'user-1',
        receiverOwnerId: 'user-2',
        status: 'pending',
        vetoMode: 'commissioner',
        acceptedAt: null,
        rejectedAt: null,
        expiresAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        itemCount: 4,
      },
    ])
  })

  it('scopes the query to the given leagueId and applies the since filter when provided', async () => {
    findManyTradeMock.mockResolvedValue([])
    const since = new Date('2026-01-01T00:00:00Z')

    await loadRedraftTradeRows('lg-B', since)

    expect(findManyTradeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId: 'lg-B', createdAt: { gte: since } },
        take: 500,
      }),
    )
  })

  it('omits the createdAt filter when since is not provided', async () => {
    findManyTradeMock.mockResolvedValue([])

    await loadRedraftTradeRows('lg-B')

    expect(findManyTradeMock).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'lg-B' } }))
  })

  it('returns an empty array (fails safely) when the league has no redraft trade proposals', async () => {
    findManyTradeMock.mockResolvedValue([])
    expect(await loadRedraftTradeRows('lg-empty')).toEqual([])
  })
})

describe('loadRedraftRosterPlayerRows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves leagueId/ownerUserId from the joined roster row', async () => {
    findManyRosterPlayerMock.mockResolvedValue([
      {
        id: 'rp-1',
        rosterId: 'ros-1',
        playerId: 'player-z',
        playerName: 'Player Z',
        acquisitionType: 'free_agent',
        addedAt: new Date('2026-01-05T00:00:00Z'),
        droppedAt: null,
        roster: { leagueId: 'lg-A', ownerId: 'user-1' },
      },
    ])

    const rows = await loadRedraftRosterPlayerRows('lg-A')

    expect(rows).toEqual([
      {
        id: 'rp-1',
        leagueId: 'lg-A',
        rosterId: 'ros-1',
        ownerUserId: 'user-1',
        playerId: 'player-z',
        playerName: 'Player Z',
        acquisitionType: 'free_agent',
        addedAt: new Date('2026-01-05T00:00:00Z'),
        droppedAt: null,
      },
    ])
  })

  it('scopes the query via the roster relation and applies an OR(addedAt, droppedAt) since filter', async () => {
    findManyRosterPlayerMock.mockResolvedValue([])
    const since = new Date('2026-01-01T00:00:00Z')

    await loadRedraftRosterPlayerRows('lg-B', since)

    expect(findManyRosterPlayerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roster: { leagueId: 'lg-B' },
          OR: [{ addedAt: { gte: since } }, { droppedAt: { gte: since } }],
        },
        take: 500,
      }),
    )
  })

  it('returns an empty array (fails safely) when the league has no redraft roster player rows', async () => {
    findManyRosterPlayerMock.mockResolvedValue([])
    expect(await loadRedraftRosterPlayerRows('lg-empty')).toEqual([])
  })
})

describe('loadRedraftRosterMoveRows (Phase 2H)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rows with a real week/season, unlike loadRedraftRosterPlayerRows', async () => {
    findManyRosterMoveHistoryMock.mockResolvedValue([
      {
        id: 'rmh-1',
        leagueId: 'lg-A',
        rosterId: 'ros-1',
        seasonId: 'season-1',
        season: 2026,
        week: 7,
        actorUserId: 'user-1',
        source: 'user',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      },
    ])

    const rows = await loadRedraftRosterMoveRows('lg-A')

    expect(rows).toEqual([
      {
        id: 'rmh-1',
        leagueId: 'lg-A',
        rosterId: 'ros-1',
        seasonId: 'season-1',
        season: 2026,
        week: 7,
        actorUserId: 'user-1',
        source: 'user',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      },
    ])
  })

  it('scopes the query to the given leagueId and applies the since filter when provided', async () => {
    findManyRosterMoveHistoryMock.mockResolvedValue([])
    const since = new Date('2026-01-01T00:00:00Z')

    await loadRedraftRosterMoveRows('lg-B', since)

    expect(findManyRosterMoveHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId: 'lg-B', createdAt: { gte: since } },
        take: 500,
      }),
    )
  })

  it('returns an empty array (fails safely) when the league has no lineup-history rows yet', async () => {
    findManyRosterMoveHistoryMock.mockResolvedValue([])
    expect(await loadRedraftRosterMoveRows('lg-empty')).toEqual([])
  })
})
