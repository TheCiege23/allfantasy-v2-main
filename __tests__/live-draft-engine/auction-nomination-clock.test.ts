/**
 * When a manager's nomination clock runs out in an auction draft, the system nominates for them by
 * default: the first available player in their own draft queue, then the player pool. A commissioner
 * can still turn it off.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  timerEndAt: new Date(Date.now() - 1_000) as Date | null,
  queue: [] as Array<Record<string, unknown>>,
  nominated: [] as Array<{ rosterId: string; player: string }>,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: vi.fn(async () => null) },
    draftSession: {
      findFirst: vi.fn(async () => ({
        id: 'ds', draftType: 'auction', status: 'in_progress', rounds: 15, timerEndAt: h.timerEndAt,
        picks: [{ rosterId: 'r2', playerName: 'Taken Guard', position: 'SG' }],
        slotOrder: [{ slot: 1, rosterId: 'r1', displayName: 'A' }, { slot: 2, rosterId: 'r2', displayName: 'B' }],
        league: { sport: 'NBA' }, sportType: 'NBA', playerPool: null, draftModeLabel: null,
      })),
    },
    league: { findUnique: vi.fn(async () => ({ settings: h.settings, userId: 'commish' })) },
    roster: { findFirst: vi.fn(async () => ({ platformUserId: 'u1' })) },
    draftQueue: { findUnique: vi.fn(async (args: { where: { sessionId_userId: { sessionId: string; userId: string } } }) => (args.where.sessionId_userId.userId === 'u1' ? { order: h.queue } : null)) },
  },
}))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({ getOrphanRosterIdsForLeague: vi.fn(async () => []) }))
vi.mock('@/lib/tournament/seasonDraftRuntime', () => ({ loadSeasonDraftContext: vi.fn(async () => null), loadSeasonDraftPlayers: vi.fn() }))
vi.mock('@/lib/tournament/seasonDraftRefresh', () => ({ prepareSeasonDraftPool: vi.fn(async () => false) }))
vi.mock('@/lib/adp-data', () => ({ getLiveADP: vi.fn(async () => []) }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: vi.fn(async () => [{ full_name: 'Top Center', position: 'C', team_abbreviation: 'BOS', player_id: 'p1' }]) }))
vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({ appendPickToRosterDraftSnapshot: vi.fn() }))
vi.mock('@/lib/live-draft-engine/serverRookieStatus', () => ({ isEligibleForPlayerPool: () => true, isRookieRestrictedPlayerPool: () => false, loadServerRookieStatusResolver: vi.fn() }))
vi.mock('@/lib/live-draft-engine/auction/AuctionEngine', () => ({
  getAuctionConfigForLeague: vi.fn(async () => ({ minBid: 1 })),
  getAuctionStateFromSession: vi.fn(() => ({ currentNomination: null, currentBid: 0, nominationOrderIndex: 0 })),
  getAuctionNominationOrder: vi.fn((slots: unknown[]) => slots),
  getBudgetsFromSession: vi.fn(() => ({ r1: 200, r2: 200 })),
  nominatePlayer: vi.fn(async (_league: string, player: { playerName: string }, rosterId: string) => { h.nominated.push({ rosterId, player: player.playerName }); return { success: true } }),
  resolveAuctionWin: vi.fn(),
}))

import { runAuctionAutomationTick } from '@/lib/live-draft-engine/auction/AuctionAutomationService'

beforeEach(() => {
  h.settings = {}
  h.timerEndAt = new Date(Date.now() - 1_000)
  h.queue = [
    { playerName: 'Taken Guard', position: 'SG' },
    { playerName: 'Queued Forward', position: 'SF', team: 'LAL', playerId: 'q2' },
    { playerName: 'Second Choice', position: 'PG' },
  ]
  h.nominated = []
})

describe('auction nomination clock runs out', () => {
  it('nominates the first available player in the manager\'s queue, with no setting changed', async () => {
    const tick = await runAuctionAutomationTick('L')
    expect(h.nominated).toEqual([{ rosterId: 'r1', player: 'Queued Forward' }])
    expect(tick.actions[0]).toMatchObject({ type: 'auto_nominate', rosterId: 'r1', playerName: 'Queued Forward' })
  })

  it('nominates from the player pool when the manager has no queue', async () => {
    h.queue = []
    await runAuctionAutomationTick('L')
    expect(h.nominated).toEqual([{ rosterId: 'r1', player: 'Top Center' }])
  })

  it('nominates from the player pool when everyone in the queue is gone', async () => {
    h.queue = [{ playerName: 'Taken Guard', position: 'SG' }]
    await runAuctionAutomationTick('L')
    expect(h.nominated).toEqual([{ rosterId: 'r1', player: 'Top Center' }])
  })

  it('CONTROL: waits while the clock is still running', async () => {
    h.timerEndAt = new Date(Date.now() + 60_000)
    await runAuctionAutomationTick('L')
    expect(h.nominated).toEqual([])
  })

  it('CONTROL: does nothing when the commissioner turned auto nomination off', async () => {
    h.settings = { draft_auction_auto_nomination_enabled: false }
    await runAuctionAutomationTick('L')
    expect(h.nominated).toEqual([])
  })
})
