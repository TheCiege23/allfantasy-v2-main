// @vitest-environment node
/**
 * Routes for Exile Island and the side games: the castaway's /api/survivor/side-games (signed in,
 * bad input 400, the service's refusal passed through) and the Commissioner Hub actions on
 * /api/survivor/commissioner (commissioner allowed, everyone else 403, bad input 400).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: { id: 'u1' } } as { user: { id: string } } | null,
  commissioner: true,
  db: {
    league: { findUnique: vi.fn(), update: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorPlayer: { findUnique: vi.fn(), findMany: vi.fn() },
    survivorCommissionerAction: { create: vi.fn() },
  },
  svc: {
    loadSurvivorSideGameView: vi.fn(),
    loadSurvivorSideGameAdminView: vi.fn(),
    submitTokenPoolPick: vi.fn(),
    submitSurvivorPoolPick: vi.fn(),
    cashOutTokenPool: vi.fn(),
    reviveSurvivorPoolEntry: vi.fn(),
    placeSurvivorAuctionBid: vi.fn(),
    buySurvivorShopItem: vi.fn(),
    placeExileTeamBid: vi.fn(),
    saveSurvivorSideGameSettings: vi.fn(),
    settleSideGamePicksForGame: vi.fn(),
    paySurvivorPoolPrize: vi.fn(),
    createSurvivorAuction: vi.fn(),
    setSurvivorAuctionStatus: vi.fn(),
    grantSurvivorAuctionCash: vi.fn(),
  },
  loadSideGameLeague: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: async () => h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/league/permissions', () => ({
  requireCommissionerRole: async () => { if (!h.commissioner) throw new Response('Forbidden', { status: 403 }) },
}))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: async () => null }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ advancePhase: vi.fn() }))
vi.mock('@/lib/survivor/exileEngine', () => ({ processReturnFromExile: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorTribeShuffleEngine', () => ({ runShuffle: vi.fn() }))
vi.mock('@/lib/survivor/survivorTribalOverride', () => ({ overrideTribalResult: vi.fn(), readTribalOverrideTarget: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn() }))
vi.mock('@/lib/survivor/notificationEngine', () => ({ enqueueNotification: vi.fn() }))
vi.mock('@/lib/survivor/survivorCouncilPause', () => ({ setCouncilPaused: vi.fn() }))
vi.mock('@/lib/survivor/survivorRemovePlayer', () => ({ removeSurvivorPlayer: vi.fn() }))
vi.mock('@/lib/survivor/survivorConductService', () => ({ issueSurvivorConductStrike: vi.fn(), revokeSurvivorConductStrike: vi.fn(), listSurvivorConductStrikes: vi.fn() }))
vi.mock('@/lib/survivor/survivorScheduledSwaps', () => ({ sealCommissionerTribeSwap: vi.fn() }))
vi.mock('@/lib/survivor/survivorGovernanceService', () => ({ loadSurvivorGovernanceView: vi.fn(), saveSurvivorGovernanceSettings: vi.fn(), setSurvivorCastawayExperience: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ applySurvivorReward: vi.fn(), chooseSurvivorRewardTarget: vi.fn(), listSurvivorRewards: vi.fn(), reverseSurvivorReward: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({ maybeTriggerSurvivorTribeShuffleRecommendation: vi.fn() }))
vi.mock('@/lib/survivor/survivorSideGameService', () => h.svc)
vi.mock('@/lib/survivor/survivorSideGameStore', () => ({ loadSideGameLeague: h.loadSideGameLeague }))

import { GET as sideGET, POST as sidePOST } from '@/app/api/survivor/side-games/route'
import { GET as commishGET, POST as commishPOST } from '@/app/api/survivor/commissioner/route'

const post = (handler: (req: never) => Promise<Response>, body: object) =>
  handler(new Request('https://example.test/api', { method: 'POST', body: JSON.stringify({ leagueId: 'L1', ...body }) }) as never)
const get = (handler: (req: never) => Promise<Response>, query: string) =>
  handler({ nextUrl: new URL(`https://example.test/api?${query}`) } as never)

beforeEach(() => {
  vi.clearAllMocks()
  h.session = { user: { id: 'u1' } }
  h.commissioner = true
  h.loadSideGameLeague.mockResolvedValue({ id: 'L1', sport: 'NFL', season: 2026, sideGames: {} })
  h.svc.settleSideGamePicksForGame.mockResolvedValue({ tokenPool: 2, pool: 1, prizes: [{ userId: 'u2', week: 4 }] })
})

describe('/api/survivor/side-games (castaway)', () => {
  it('401 without a session, 400 without a league, 404 for a non-castaway', async () => {
    h.session = null
    expect((await get(sideGET, 'leagueId=L1')).status).toBe(401)
    h.session = { user: { id: 'u1' } }
    expect((await get(sideGET, '')).status).toBe(400)
    h.svc.loadSurvivorSideGameView.mockResolvedValueOnce(null)
    expect((await get(sideGET, 'leagueId=L1')).status).toBe(404)
  })

  it('returns only the caller’s own view', async () => {
    h.svc.loadSurvivorSideGameView.mockResolvedValueOnce({ week: 4, games: [] })
    const res = await get(sideGET, 'leagueId=L1')
    expect(res.status).toBe(200)
    expect(h.svc.loadSurvivorSideGameView).toHaveBeenCalledWith('L1', 'u1')
  })

  it('dispatches each action with the SESSION user, never a body-supplied one', async () => {
    h.svc.submitTokenPoolPick.mockResolvedValueOnce({ ok: true, pickId: 'p', duplicate: false })
    const res = await post(sidePOST, { action: 'token_pool_pick', gameKey: 'BUF@KC', teamKey: 'KC', userId: 'someone-else' })
    expect(res.status).toBe(200)
    expect(h.svc.submitTokenPoolPick).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1', gameKey: 'BUF@KC', teamKey: 'KC' })
  })

  it('400 for missing input or an unknown action; a service refusal keeps its status and message', async () => {
    expect((await post(sidePOST, { action: 'pool_pick', gameKey: 'BUF@KC' })).status).toBe(400)
    expect((await post(sidePOST, { action: 'auction_bid', auctionId: 'a', itemId: 'i' })).status).toBe(400)
    expect((await post(sidePOST, { action: 'shop_buy', itemId: 'x' })).status).toBe(400)
    expect((await post(sidePOST, { action: 'teleport' })).status).toBe(400)
    h.svc.placeSurvivorAuctionBid.mockResolvedValueOnce({ ok: false, status: 409, error: 'Sealed bids lock: you already bid on this item.' })
    const res = await post(sidePOST, { action: 'auction_bid', auctionId: 'a', itemId: 'item1', amount: 5 })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('Sealed bids lock')
  })
})

describe('/api/survivor/commissioner side-game actions', () => {
  it('reads the Hub view for the commissioner and 403s anyone else', async () => {
    h.svc.loadSurvivorSideGameAdminView.mockResolvedValueOnce({ settings: {}, games: [] })
    expect((await get(commishGET, 'leagueId=L1&type=side_games')).status).toBe(200)
    h.commissioner = false
    expect((await get(commishGET, 'leagueId=L1&type=side_games')).status).toBe(403)
    expect(h.svc.loadSurvivorSideGameAdminView).toHaveBeenCalledTimes(1)
  })

  it('saves settings, passes locks through as 409, and logs the change', async () => {
    h.svc.saveSurvivorSideGameSettings.mockResolvedValueOnce({ ok: true, settings: { exileTokenFaabRate: 50 }, patch: { exileTokenFaabRate: 50 }, locked: [] })
    const ok = await post(commishPOST, { action: 'side_games_settings', settings: { exileTokenFaabRate: 50 } })
    expect(ok.status).toBe(200)
    expect(h.db.survivorCommissionerAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionType: 'side_games_settings' }) })
    h.svc.saveSurvivorSideGameSettings.mockResolvedValueOnce({ ok: false, status: 409, error: 'exileTokenFaabRate locks once the season starts.', code: 'locked' })
    expect((await post(commishPOST, { action: 'side_games_settings', settings: { exileTokenFaabRate: 60 } })).status).toBe(409)
  })

  it('non-commissioner: 403 for every side-game action, nothing runs', async () => {
    h.commissioner = false
    for (const action of ['side_games_settings', 'token_pool_toggle', 'side_game_settle', 'auction_create', 'auction_status', 'pool_grant_revive', 'auction_cash_grant']) {
      expect((await post(commishPOST, { action })).status).toBe(403)
    }
    expect(h.svc.saveSurvivorSideGameSettings).not.toHaveBeenCalled()
    expect(h.svc.settleSideGamePicksForGame).not.toHaveBeenCalled()
  })

  it('the settle override names a team in the game or a tie, and pays the pool winners', async () => {
    expect((await post(commishPOST, { action: 'side_game_settle', week: 4, gameKey: 'BUF@KC' })).status).toBe(400)
    expect((await post(commishPOST, { action: 'side_game_settle', week: 4, gameKey: 'BUF@KC', winnerKey: 'DAL' })).status).toBe(400)
    const res = await post(commishPOST, { action: 'side_game_settle', week: 4, gameKey: 'BUF@KC', winnerKey: 'KC' })
    expect(res.status).toBe(200)
    expect(h.svc.settleSideGamePicksForGame).toHaveBeenCalledWith(expect.objectContaining({ week: 4, gameKey: 'BUF@KC', winnerKey: 'KC', by: 'commissioner', actorUserId: 'u1' }))
    expect(h.svc.paySurvivorPoolPrize).toHaveBeenCalledWith(expect.objectContaining({ id: 'L1' }), 'u2', 4)
    expect((await post(commishPOST, { action: 'side_game_settle', week: 4, gameKey: 'BUF@KC', winnerKey: 'tie' })).status).toBe(200)
  })

  it('start/stop, auctions, revives and auction cash validate their input', async () => {
    expect((await post(commishPOST, { action: 'token_pool_toggle' })).status).toBe(400)
    h.svc.saveSurvivorSideGameSettings.mockResolvedValueOnce({ ok: true, settings: { tokenPoolOpen: false }, patch: {}, locked: [] })
    expect((await post(commishPOST, { action: 'token_pool_toggle', open: false })).status).toBe(200)
    expect(h.svc.saveSurvivorSideGameSettings).toHaveBeenLastCalledWith('L1', { tokenPoolOpen: false })
    expect((await post(commishPOST, { action: 'auction_status', auctionId: 'a1', status: 'settled' })).status).toBe(400)
    h.svc.setSurvivorAuctionStatus.mockResolvedValueOnce({ ok: true, status: 'closed' })
    expect((await post(commishPOST, { action: 'auction_status', auctionId: 'a1', status: 'closed' })).status).toBe(200)
    h.svc.createSurvivorAuction.mockResolvedValueOnce({ ok: false, status: 400, error: 'List between 1 and 12 items.' })
    expect((await post(commishPOST, { action: 'auction_create', auction: { label: 'x' } })).status).toBe(400)
    expect((await post(commishPOST, { action: 'pool_grant_revive', targetUserId: 'u2', count: 9 })).status).toBe(400)
    h.svc.reviveSurvivorPoolEntry.mockResolvedValueOnce({ ok: true, entry: {}, revivesLeft: 3 })
    expect((await post(commishPOST, { action: 'pool_grant_revive', targetUserId: 'u2', count: 1 })).status).toBe(200)
    expect(h.svc.reviveSurvivorPoolEntry).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u2', actorUserId: 'u1', grant: 1 })
    expect((await post(commishPOST, { action: 'auction_cash_grant', rosterId: 'r1', amount: 2.5 })).status).toBe(400)
    h.svc.grantSurvivorAuctionCash.mockResolvedValueOnce({ ok: true, balance: 20 })
    expect((await post(commishPOST, { action: 'auction_cash_grant', rosterId: 'r1', amount: 20 })).status).toBe(200)
  })
})
