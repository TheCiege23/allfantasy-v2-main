// @vitest-environment node
/**
 * G3 gaps, the DB half with the store mocked: an auction prize that cannot be paid is refunded once
 * and the winner told privately in the league's language; a transient failure is retried, never
 * refunded; Chimmy's seat places ONE sealed Exile team bid; missed Survivor Pool picks are judged
 * once the week has kicked off; "removed if exposed" previews, then applies, audits and DMs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: {
    leagueChatMessage: { create: vi.fn() },
    league: { findUnique: vi.fn() },
    survivorPlayer: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
  },
  store: {
    loadSideGameState: vi.fn(),
    loadCastaways: vi.fn(),
    inSideGameLock: vi.fn(),
    appendSideGameRow: vi.fn(),
    bidBalance: vi.fn(),
    chargeSideGameFaab: vi.fn(),
    refundSideGameFaab: vi.fn(),
    paySideGamePrize: vi.fn(),
    loadSideGameWeekGames: vi.fn(),
    loadSideGameSeasonGames: vi.fn(),
    loadSideGameTeamGroups: vi.fn(),
    loadSideGameLeague: vi.fn(),
  },
  svc: {
    placeExileTeamBid: vi.fn(),
    cashOutTokenPool: vi.fn(),
    deliverShopPurchase: vi.fn(),
    paySurvivorPoolPrize: vi.fn(),
    placeSurvivorAuctionBid: vi.fn(),
    settleSideGamePicksForGame: vi.fn(),
    submitSurvivorPoolPick: vi.fn(),
    submitTokenPoolPick: vi.fn(),
  },
  exileBidWindow: vi.fn(),
  removeSurvivorPlayer: vi.fn(),
  issueSurvivorConductStrike: vi.fn(),
  managed: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/survivor/survivorSideGameStore', () => h.store)
vi.mock('@/lib/survivor/survivorSideGameService', () => h.svc)
vi.mock('@/lib/survivor/survivorExileBids', () => ({ exileBidWindow: h.exileBidWindow, settleDueExileTeamBids: vi.fn() }))
vi.mock('@/lib/survivor/survivorRemovePlayer', () => ({ removeSurvivorPlayer: h.removeSurvivorPlayer }))
vi.mock('@/lib/survivor/survivorConductService', () => ({ issueSurvivorConductStrike: h.issueSurvivorConductStrike }))
vi.mock('@/lib/inactive-manager/chimmyPlayable', () => ({ readPlayableChimmyLineups: h.managed }))
vi.mock('@/lib/inactive-manager/inactiveManagerMode', () => ({ isChimmyRunning: () => true }))

import { emptySideGameState } from '@/lib/survivor/survivorSideGameLedger'
import { readSurvivorSideGameSettings } from '@/lib/survivor/survivorSideGameSettings'
import { judgeMissedPoolPicks, runChimmySideGameTurn, settleAuction } from '@/lib/survivor/survivorSideGameRunner'
import { applyExileExposurePenalty } from '@/lib/survivor/survivorExileExposure'

const league = (sideGames: Record<string, unknown> = {}, language: string | null = 'es') => ({
  id: 'L1', sport: 'NFL', season: 2026, language, settings: {}, platform: null, userId: 'host', survivorTokenCap: null,
  sideGames: readSurvivorSideGameSettings({ survivorSideGames: sideGames }),
})

function auctionState() {
  const s = emptySideGameState()
  s.auctions.set('a1', {
    auctionId: 'a1', label: 'Week 6', mode: 'sealed', currency: 'faab', opensAt: '', closesAt: '', week: 6, status: 'settled', bids: [], cashGranted: false,
    items: [{ itemId: 'item1', label: 'Extra vote', blind: false, prize: { kind: 'advantage', amount: 0, powerType: 'extra_vote', samePositionOnly: false } }],
    awards: [{ itemId: 'item1', rosterId: 'r1', amount: 30, rewardId: null, paid: false }],
  })
  return s
}

beforeEach(() => {
  vi.clearAllMocks()
  h.store.inSideGameLock.mockImplementation(async (_l: string, work: (db: unknown) => unknown) => work({}))
  h.store.loadCastaways.mockResolvedValue([{ userId: 'u1', displayName: 'Ana', playerState: 'eliminated', rosterId: 'r1', tokenBalance: 0 }])
  h.store.chargeSideGameFaab.mockResolvedValue(30)
  h.store.refundSideGameFaab.mockResolvedValue(30)
  h.db.leagueChatMessage.create.mockResolvedValue({})
})

describe('auction refunds', () => {
  it('a refused prize (winner left the island) is refunded once, and the winner is told in Spanish', async () => {
    h.store.loadSideGameState.mockResolvedValue(auctionState())
    h.store.paySideGamePrize.mockResolvedValue({ ok: false, error: 'That manager is not an active castaway in this league.', permanent: true })
    await settleAuction(league() as never, 'a1', 6)
    expect(h.store.refundSideGameFaab).toHaveBeenCalledTimes(1)
    expect(h.store.refundSideGameFaab.mock.calls[0][0]).toMatchObject({ rosterId: 'r1', chargeKey: 'auctioncharge:a1:item1', key: 'auctionrefund:a1:item1', refundOf: 'a1:item1' })
    const dm = h.db.leagueChatMessage.create.mock.calls[0][0].data
    expect(dm).toMatchObject({ isPrivate: true, visibleToUserId: 'u1', messageSubtype: 'chimmy_private' })
    expect(dm.message).toContain('se te devolvieron los $30 FAAB')
  })

  it('a transient failure is retried by the runner, never refunded', async () => {
    h.store.loadSideGameState.mockResolvedValue(auctionState())
    h.store.paySideGamePrize.mockResolvedValue({ ok: false, error: 'connection reset' })
    await settleAuction(league() as never, 'a1', 6)
    expect(h.store.refundSideGameFaab).not.toHaveBeenCalled()
    expect(h.db.leagueChatMessage.create).not.toHaveBeenCalled()
  })

  it('an award already refunded is neither charged nor paid again', async () => {
    const s = auctionState()
    s.auctions.get('a1')!.awards[0].refunded = true
    h.store.loadSideGameState.mockResolvedValue(s)
    await settleAuction(league() as never, 'a1', 6)
    expect(h.store.chargeSideGameFaab).not.toHaveBeenCalled()
    expect(h.store.paySideGamePrize).not.toHaveBeenCalled()
  })

  it('a refund that finds nothing new to give back sends no message (idempotent re-run)', async () => {
    h.store.loadSideGameState.mockResolvedValue(auctionState())
    h.store.paySideGamePrize.mockResolvedValue({ ok: false, error: 'refused', permanent: true })
    h.store.refundSideGameFaab.mockResolvedValue(0)
    await settleAuction(league() as never, 'a1', 6)
    expect(h.db.leagueChatMessage.create).not.toHaveBeenCalled()
  })
})

describe("Chimmy's sealed Exile team bid", () => {
  const now = new Date('2026-11-04T15:00:00Z')
  beforeEach(() => {
    h.store.loadCastaways.mockResolvedValue([{ userId: 'orphan-r9', displayName: 'Chimmy seat', playerState: 'exile', rosterId: 'r9', tokenBalance: 0 }])
    h.store.loadSideGameWeekGames.mockResolvedValue([])
    h.store.loadSideGameSeasonGames.mockResolvedValue([
      { key: 'NYJ@KC', homeTeam: 'KC', awayTeam: 'NYJ', homeKey: 'KC', awayKey: 'NYJ', startTime: null, final: true, homeScore: 30, awayScore: 3 },
    ])
    h.managed.mockResolvedValue({})
    h.exileBidWindow.mockResolvedValue({ week: 9, opensAt: new Date('2026-11-03T00:00:00Z'), closesAt: new Date('2026-11-05T02:00:00Z'), openTeams: new Set(['KC', 'NYJ']) })
    h.svc.placeExileTeamBid.mockResolvedValue({ ok: true, week: 9, closesAt: '' })
  })

  it('bids once on the strongest open team, within the budget, without reading others’ bids', async () => {
    const s = emptySideGameState()
    s.exileBids.set(9, { bids: [{ userId: 'someone', team: 'KC', amount: 99, at: '' }], resolved: null })
    h.store.loadSideGameState.mockResolvedValue(s)
    const turn = await runChimmySideGameTurn(league({ exileClaimMode: 'faab_bid', exileBidBudget: 60, tokenPoolEnabled: false }) as never, 9, now)
    expect(h.svc.placeExileTeamBid).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'orphan-r9', team: 'KC', amount: 40, now })
    expect(turn['orphan-r9']).toBe('exile_team_bid')
  })

  it('does not bid again once its own bid stands', async () => {
    const s = emptySideGameState()
    s.exileBids.set(9, { bids: [{ userId: 'orphan-r9', team: 'NYJ', amount: 5, at: '' }], resolved: null })
    h.store.loadSideGameState.mockResolvedValue(s)
    await runChimmySideGameTurn(league({ exileClaimMode: 'faab_bid', tokenPoolEnabled: false }) as never, 9, now)
    expect(h.svc.placeExileTeamBid).not.toHaveBeenCalled()
  })

  it('first-come leagues: no bid at all', async () => {
    h.store.loadSideGameState.mockResolvedValue(emptySideGameState())
    await runChimmySideGameTurn(league({ exileClaimMode: 'first_come', tokenPoolEnabled: false }) as never, 9, now)
    expect(h.svc.placeExileTeamBid).not.toHaveBeenCalled()
  })
})

describe('missed Survivor Pool picks', () => {
  const games = [{ key: 'BUF@KC', homeKey: 'KC', awayKey: 'BUF', startTime: new Date('2026-11-01T18:00:00Z'), final: false }]
  beforeEach(() => {
    h.store.loadSideGameWeekGames.mockResolvedValue(games)
    h.store.loadCastaways.mockResolvedValue([
      { userId: 'u1', displayName: 'A', playerState: 'active', rosterId: 'r1', tokenBalance: 0 },
      { userId: 'u2', displayName: 'B', playerState: 'active', rosterId: 'r2', tokenBalance: 0 },
    ])
    h.store.appendSideGameRow.mockResolvedValue(true)
  })

  it('once the week has kicked off, a manager with no pick takes the rule (u2 picked)', async () => {
    const s = emptySideGameState()
    s.pool.set('u2', { entry: { alive: true, revivesUsed: 0, revivesGranted: 0, eliminatedWeek: null, wins: 0 }, picks: [{ week: 5, gameKey: 'BUF@KC', teamKey: 'KC', at: '', outcome: null, settledBy: null }] })
    h.store.loadSideGameState.mockResolvedValue(s)
    const n = await judgeMissedPoolPicks(league({ survivorPoolEnabled: true, survivorPoolMissedPick: 'loss' }) as never, 5, new Date('2026-11-01T20:00:00Z'))
    expect(n).toBe(1)
    expect(h.store.appendSideGameRow).toHaveBeenCalledTimes(1)
    expect(h.store.appendSideGameRow.mock.calls[0][2]).toMatchObject({ action: 'pool_missed', key: 'poolmiss:u1:5', data: { entry: { alive: false, eliminatedWeek: 5 } } })
  })

  it('nothing before the week has kicked off, and nothing when the rule is off', async () => {
    h.store.loadSideGameState.mockResolvedValue(emptySideGameState())
    expect(await judgeMissedPoolPicks(league({ survivorPoolEnabled: true, survivorPoolMissedPick: 'loss' }) as never, 5, new Date('2026-11-01T12:00:00Z'))).toBe(0)
    expect(await judgeMissedPoolPicks(league({ survivorPoolEnabled: true }) as never, 5, new Date('2026-11-01T20:00:00Z'))).toBe(0)
    expect(h.store.appendSideGameRow).not.toHaveBeenCalled()
  })
})

describe('"removed if exposed"', () => {
  const settings = (rule: string, hidden = true) => ({ survivorSideGames: { hideExileMembership: hidden, exileExposureRule: rule } })
  beforeEach(() => {
    h.db.survivorPlayer.findUnique.mockResolvedValue({ playerState: 'active', displayName: 'Ben' })
    h.db.survivorGameState.findUnique.mockResolvedValue({ currentWeek: 7 })
    h.db.survivorAuditEntry.create.mockResolvedValue({ id: 'aud1' })
  })

  it('without confirm it only previews: nothing is written', async () => {
    h.db.league.findUnique.mockResolvedValue({ userId: 'host', settings: settings('remove'), language: 'en' })
    const r = await applyExileExposurePenalty('L1', { targetUserId: 'u2', actorUserId: 'host', confirm: false })
    expect(r).toMatchObject({ ok: true, preview: true, penalty: 'remove' })
    expect(h.db.survivorAuditEntry.create).not.toHaveBeenCalled()
    expect(h.removeSurvivorPlayer).not.toHaveBeenCalled()
  })

  it('confirmed removal: audited, removed through the Hub removal, Chimmy DMs them', async () => {
    h.db.league.findUnique.mockResolvedValue({ userId: 'host', settings: settings('remove'), language: 'en' })
    const r = await applyExileExposurePenalty('L1', { targetUserId: 'u2', actorUserId: 'host', confirm: true })
    expect(r).toMatchObject({ ok: true, preview: false, removed: true })
    expect(h.db.survivorAuditEntry.create.mock.calls[0][0].data).toMatchObject({ action: 'exile_exposure_penalty', isVisibleToPublic: false, targetUserId: 'u2' })
    expect(h.removeSurvivorPlayer).toHaveBeenCalledWith('L1', expect.objectContaining({ targetUserId: 'u2', actionType: 'remove_player_exposed_exile' }))
    expect(h.db.leagueChatMessage.create.mock.calls[0][0].data).toMatchObject({ visibleToUserId: 'u2', isPrivate: true })
  })

  it('confirmed strike goes through the conduct strikes service (Spanish DM)', async () => {
    h.db.league.findUnique.mockResolvedValue({ userId: 'host', settings: settings('strike'), language: 'es' })
    h.issueSurvivorConductStrike.mockResolvedValue({ ok: true, strikeId: 's1', activeStrikes: 1, limit: 3, limitReached: false, removed: false })
    const r = await applyExileExposurePenalty('L1', { targetUserId: 'u2', actorUserId: 'host', confirm: true })
    expect(r).toMatchObject({ ok: true, preview: false, removed: false, strikes: 1 })
    expect(h.issueSurvivorConductStrike).toHaveBeenCalledWith('L1', expect.objectContaining({ targetUserId: 'u2', reason: expect.stringContaining('Exilio') }))
    expect(h.db.leagueChatMessage.create.mock.calls[0][0].data.message).toContain('strike de conducta')
  })

  it('refused while the rule is off or Exile is not secret', async () => {
    h.db.league.findUnique.mockResolvedValue({ userId: 'host', settings: settings('off'), language: 'en' })
    expect(await applyExileExposurePenalty('L1', { targetUserId: 'u2', actorUserId: 'host', confirm: true })).toMatchObject({ ok: false, status: 409 })
    h.db.league.findUnique.mockResolvedValue({ userId: 'host', settings: settings('remove', false), language: 'en' })
    expect(await applyExileExposurePenalty('L1', { targetUserId: 'u2', actorUserId: 'host', confirm: true })).toMatchObject({ ok: false, status: 409 })
    expect(h.removeSurvivorPlayer).not.toHaveBeenCalled()
  })
})
