/**
 * In an auction draft, a team Chimmy runs nominates as soon as it is its turn (not when the clock runs
 * out) and opens the bidding, whatever the orphan-AI setting says. Nobody else will act for it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  owner: 'orphan-r2',
  timerEndAt: new Date(Date.now() + 60_000) as Date | null,
  nominated: [] as Array<{ rosterId: string; player: string }>,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findFirst: vi.fn(async () => ({ id: 'ds', draftType: 'auction', status: 'in_progress', picks: [], rounds: 15, slotOrder: [{ slot: 1, rosterId: 'r1', displayName: 'A' }, { slot: 2, rosterId: 'r2', displayName: 'Chimmy team' }], timerEndAt: h.timerEndAt, league: { sport: 'NBA' }, sportType: 'NBA', playerPool: null, draftModeLabel: null })) },
    league: { findUnique: vi.fn(async () => ({ settings: h.settings })) },
    roster: { findFirst: vi.fn(async () => ({ platformUserId: h.owner })) },
  },
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: vi.fn(async () => ({ autoPickEnabled: false, auctionAutoNominationEnabled: false, orphanTeamAiManagerEnabled: false })) }))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({ getOrphanRosterIdsForLeague: vi.fn(async () => []) }))
vi.mock('@/lib/tournament/seasonDraftRuntime', () => ({ loadSeasonDraftContext: vi.fn(async () => null), loadSeasonDraftPlayers: vi.fn() }))
vi.mock('@/lib/tournament/seasonDraftRefresh', () => ({ prepareSeasonDraftPool: vi.fn(async () => false) }))
vi.mock('@/lib/adp-data', () => ({ getLiveADP: vi.fn(async () => []) }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: vi.fn(async () => [{ full_name: 'Top Guard', position: 'PG', team_abbreviation: 'BOS', player_id: 'p1' }]) }))
vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({ appendPickToRosterDraftSnapshot: vi.fn() }))
vi.mock('@/lib/live-draft-engine/serverRookieStatus', () => ({ isEligibleForPlayerPool: () => true, isRookieRestrictedPlayerPool: () => false, loadServerRookieStatusResolver: vi.fn() }))
vi.mock('@/lib/live-draft-engine/auction/AuctionEngine', () => ({
  getAuctionConfigForLeague: vi.fn(async () => ({ minBid: 1 })),
  getAuctionStateFromSession: vi.fn(() => ({ currentNomination: null, currentBid: 0, nominationOrderIndex: 1 })),
  getAuctionNominationOrder: vi.fn((slots: unknown[]) => slots),
  getBudgetsFromSession: vi.fn(() => ({ r1: 200, r2: 200 })),
  nominatePlayer: vi.fn(async (_league: string, player: { playerName: string }, rosterId: string) => { h.nominated.push({ rosterId, player: player.playerName }); return { success: true } }),
  placeBid: vi.fn(),
  resolveAuctionWin: vi.fn(),
}))

import { runAuctionAutomationTick } from '@/lib/live-draft-engine/auction/AuctionAutomationService'

const chimmyOn = { af_managed_lineups: { r2: { since: 's', byUserId: 'c', ownerUserId: 'orphan-r2', autopilot: { style: 'dynasty_owner', since: 's', byUserId: 'c' } } } }

beforeEach(() => {
  h.settings = chimmyOn
  h.owner = 'orphan-r2'
  h.timerEndAt = new Date(Date.now() + 60_000)
  h.nominated = []
})

describe('Chimmy in an auction draft', () => {
  it('nominates on its turn without waiting for the clock, with the orphan-AI setting off', async () => {
    const tick = await runAuctionAutomationTick('L')
    expect(h.nominated).toEqual([{ rosterId: 'r2', player: 'Top Guard' }])
    expect(tick.actions[0]).toMatchObject({ type: 'auto_nominate', rosterId: 'r2' })
  })

  it('CONTROL: a team Chimmy does not run waits for its own nomination', async () => {
    h.settings = {}
    await runAuctionAutomationTick('L')
    expect(h.nominated).toEqual([])
  })

  it('once a real manager has the team, Chimmy no longer nominates for it', async () => {
    h.owner = 'real-user'
    await runAuctionAutomationTick('L')
    expect(h.nominated).toEqual([])
  })
})
