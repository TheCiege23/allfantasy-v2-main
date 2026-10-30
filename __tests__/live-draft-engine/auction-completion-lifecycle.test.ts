// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ session: vi.fn(), pick: vi.fn(), update: vi.fn(), archive: vi.fn(), lifecycle: vi.fn(), finalize: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: m.session }, $transaction: m.transaction } }))
vi.mock('@/lib/draft/draftLock', () => ({ withAuctionLock: async (_id: string, run: () => Promise<unknown>) => ({ acquired: true, value: await run() }) }))
vi.mock('@/lib/tournament/seasonDraftRuntime', () => ({ loadSeasonDraftContext: async () => null, validateSeasonDraftPlayer: async () => null }))
vi.mock('@/lib/tournament/seasonDraftRefresh', () => ({ prepareSeasonDraftPool: async () => null }))
vi.mock('@/lib/tournament/seasonDraftCompletion', () => ({ completeSeasonDraft: vi.fn() }))
vi.mock('@/lib/league/league-roster-draft-gate', () => ({ isLeagueRosterDraftReady: async () => true }))
vi.mock('@/lib/draft-archive/events', () => ({ recordArchiveEvent: m.archive, updateSessionWithArchive: vi.fn(), json: (value: unknown) => value }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ applyPostDraftLifecycleInTransaction: m.lifecycle }))
vi.mock('@/lib/live-draft-engine/postDraftFinalizeArtifacts', () => ({ runPostDraftFinalizationArtifacts: m.finalize }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: async () => null }))
import { resolveAuctionWin, buildInitialAuctionSessionUpdate, getAuctionStateFromSession, getAuctionNominationOrder, advanceAuctionNominationIndex } from '@/lib/live-draft-engine/auction/AuctionEngine'

describe('rookie auction initialization', () => {
  const slotOrder = [{ slot: 1, rosterId: 'a', displayName: 'A' }, { slot: 2, rosterId: 'b', displayName: 'B' }]
  const trade = { round: 1, originalRosterId: 'a', newRosterId: 'b' }
  it('applies transferred auction budget once when the draft starts', async () => {
    const initial = await buildInitialAuctionSessionUpdate('league', { slotOrder, rounds: 2, auctionBudgetPerTeam: 20, auctionState: { rookieAuction: { policy: 'budget', budgetPerTeam: 20, valuesByRound: { '1': 6 }, trades: [trade] } } })
    expect(initial.auctionBudgets).toEqual({ a: 14, b: 26 })
    expect(initial.auctionState.rookieAuction.trades).toEqual([trade])
  })
  it('uses traded nomination turns once, then repeats the normal rotation', async () => {
    const initial = await buildInitialAuctionSessionUpdate('league', { slotOrder, rounds: 2, auctionBudgetPerTeam: 20, auctionState: { rookieAuction: { policy: 'nominations', budgetPerTeam: 20, valuesByRound: {}, trades: [trade] } } })
    const state = getAuctionStateFromSession(initial)!
    const order = getAuctionNominationOrder(slotOrder, state)
    expect(order.map(entry => entry.rosterId)).toEqual(['b', 'b', 'a', 'b', 'a', 'b'])
    expect(advanceAuctionNominationIndex({ ...state, nominationOrderIndex: 3 }, order.length)).toBe(4)
    expect(advanceAuctionNominationIndex({ ...state, nominationOrderIndex: 5 }, order.length)).toBe(4)
  })
})

describe('auction completion', () => {
  it('transitions lifecycle in the final sale transaction and syncs season rosters', async () => {
    const tx = { draftPick: { create: m.pick }, draftSession: { update: m.update, updateMany: vi.fn(async () => ({ count: 1 })) } }
    m.transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run(tx))
    m.archive.mockResolvedValue({ eventId: 'event', context: {}, selected: {} })
    m.session.mockResolvedValue({ id: 'draft', leagueId: 'league', draftType: 'auction', status: 'in_progress', teamCount: 1, rounds: 1, timerSeconds: 30, timerEndAt: new Date('2026-01-01'), playerPool: 'all', slotOrder: [{ slot: 1, rosterId: 'a', displayName: 'A' }], auctionBudgetPerTeam: 200, auctionBudgets: { a: 200 }, auctionState: { nominationOrderIndex: 0, currentNomination: { playerName: 'Player', position: 'QB', playerId: 'p', team: null }, currentBid: 5, currentBidderRosterId: 'a' }, picks: [] })
    const result = await resolveAuctionWin('league', { force: true })
    expect(result).toMatchObject({ success: true, sold: true, winnerRosterId: 'a' })
    expect(m.lifecycle).toHaveBeenCalledWith(tx, 'league')
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }))
    expect(m.finalize).toHaveBeenCalledWith('league')
  })
  it('refuses a stale concurrent resolution without recording another sale', async () => {
    vi.clearAllMocks()
    const tx = { draftPick: { create: m.pick }, draftSession: { update: m.update, updateMany: vi.fn(async () => ({ count: 0 })) } }
    m.transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run(tx))
    m.session.mockResolvedValue({ id: 'draft', leagueId: 'league', version: 2, draftType: 'auction', status: 'in_progress', teamCount: 1, rounds: 1, timerSeconds: 30, timerEndAt: new Date('2026-01-01'), playerPool: 'all', slotOrder: [{ slot: 1, rosterId: 'a', displayName: 'A' }], auctionBudgetPerTeam: 200, auctionBudgets: { a: 200 }, auctionState: { nominationOrderIndex: 0, currentNomination: { playerName: 'Player', position: 'QB', playerId: 'p', team: null }, currentBid: 5, currentBidderRosterId: 'a' }, picks: [] })
    expect(await resolveAuctionWin('league', { force: true })).toMatchObject({ success: false, error: 'Auction changed. Reload and retry.' })
    expect(m.pick).not.toHaveBeenCalled()
    expect(m.lifecycle).not.toHaveBeenCalled()
  })

})
