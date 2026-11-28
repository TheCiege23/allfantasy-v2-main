import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `readManagerActivity` must see moves the daily activity cron has not caught up with yet.
 *
 * 🛑 WHAT WAS BROKEN (reported 2026-11-23). The inactive-manager ladder said "REPLACE Husby5227 —
 * quiet 29 days" for a manager who had made a trade and waiver claims within the last two days.
 * `decision_os_imported_activity` is refreshed by a cron that reaches each of ~800 Sleeper leagues
 * only every couple of weeks; that league's newest imported move was 14 days old, while
 * `dw_transaction_facts` had been re-synced that morning with 52 newer moves.
 */

const mocks = vi.hoisted(() => ({
  leagueFindFirst: vi.fn(),
  snapshotFindFirst: vi.fn(),
  snapshotFindMany: vi.fn(),
  teamFindMany: vi.fn(),
  activityFindMany: vi.fn(),
  factFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: mocks.leagueFindFirst },
    rosterSnapshot: { findFirst: mocks.snapshotFindFirst, findMany: mocks.snapshotFindMany },
    leagueTeam: { findMany: mocks.teamFindMany },
    decisionOsImportedActivity: { findMany: mocks.activityFindMany },
    transactionFact: { findMany: mocks.factFindMany },
  },
}))

import { readManagerActivity, sleeperTransactionIdToDate } from '@/lib/league-history/leagueWarehouseReads'

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)
/** Encode a time the way Sleeper does, so a dateless trade row can be built for any age. */
const sleeperId = (at: Date) => ((BigInt(at.getTime() - 1_454_362_509_000) << BigInt(22)) + BigInt(12345)).toString()

const teams = [
  { externalId: '1', teamName: 'Ada', ownerName: 'ada', claimedByUserId: null },
  { externalId: '2', teamName: 'Bea', ownerName: 'bea', claimedByUserId: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.leagueFindFirst.mockResolvedValue({ platform: 'sleeper', platformLeagueId: 'sl-1' })
  mocks.snapshotFindFirst.mockResolvedValue({ season: 2026 })
  mocks.snapshotFindMany.mockResolvedValue([
    { teamId: '1', rosterPlayers: [{ ownerId: 'o-ada' }] },
    { teamId: '2', rosterPlayers: [{ ownerId: 'o-bea' }] },
  ])
  mocks.teamFindMany.mockImplementation(async (args: { where: { claimedByUserId?: unknown } }) =>
    args.where.claimedByUserId ? [] : teams,
  )
  // The imported table is stale: Ada's newest move there is 29 days old.
  mocks.activityFindMany.mockResolvedValue([{ occurredAt: ago(29), normalized: { managerKeys: ['sleeper:o-ada'] } }])
  mocks.factFindMany.mockResolvedValue([])
})

describe('the fresher warehouse facts', () => {
  it('a waiver claim yesterday makes the manager active, with yesterday as the last move', async () => {
    mocks.factFindMany.mockResolvedValue([
      { rosterId: '1', payload: { createdAt: ago(1).toISOString(), rosterIds: ['1'], sleeperTransactionId: '1' } },
    ])
    const [ada] = await readManagerActivity('lg-1', 14)
    expect(ada.managerName).toBe('Ada')
    expect(ada.currentCount).toBe(1)
    expect(Math.round((Date.now() - (ada.lastActionAt as Date).getTime()) / DAY)).toBe(1)
  })

  it('dates a trade with no timestamp from its Sleeper id, and credits BOTH sides once', async () => {
    const id = sleeperId(ago(2))
    // The backfill writes one row per side (and sometimes per player) with no createdAt.
    mocks.factFindMany.mockResolvedValue([
      { rosterId: '1', payload: { sleeperTransactionId: id } },
      { rosterId: '1', payload: { sleeperTransactionId: id } },
      { rosterId: '2', payload: { sleeperTransactionId: id } },
    ])
    const out = await readManagerActivity('lg-1', 14)
    expect(out).toMatchObject([
      { managerName: 'Ada', currentCount: 1 },
      { managerName: 'Bea', currentCount: 1 },
    ])
  })

  it('does not double-count a move present in both tables', async () => {
    mocks.activityFindMany.mockResolvedValue([{ occurredAt: ago(3), normalized: { managerKeys: ['sleeper:o-ada'] } }])
    mocks.factFindMany.mockResolvedValue([
      { rosterId: '1', payload: { createdAt: ago(3).toISOString(), rosterIds: ['1'], sleeperTransactionId: '9' } },
    ])
    const [ada] = await readManagerActivity('lg-1', 14)
    expect(ada.currentCount).toBe(1)
  })

  it('skips a row it cannot date rather than guessing, and survives a failed read', async () => {
    mocks.factFindMany.mockResolvedValue([{ rosterId: '1', payload: { sleeperTransactionId: 'not-an-id' } }])
    expect((await readManagerActivity('lg-1', 14))[0]).toMatchObject({ managerName: 'Ada', currentCount: 0 })

    mocks.factFindMany.mockRejectedValue(new Error('db down'))
    expect((await readManagerActivity('lg-1', 14))[0]).toMatchObject({ managerName: 'Ada', currentCount: 0 })
  })
})

describe('sleeperTransactionIdToDate', () => {
  it('decodes a real production id to its recorded createdAt (2026-11-20T00:11:42.203Z) within a second', () => {
    const at = sleeperTransactionIdToDate('1429297138608672768') as Date
    expect(Math.abs(at.getTime() - Date.parse('2026-11-20T00:11:42.203Z'))).toBeLessThan(1000)
  })
  it('refuses things that are not Sleeper ids', () => {
    expect(sleeperTransactionIdToDate('123')).toBeNull()
    expect(sleeperTransactionIdToDate(42)).toBeNull()
    expect(sleeperTransactionIdToDate(null)).toBeNull()
  })
})
