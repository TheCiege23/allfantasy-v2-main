// @vitest-environment node
/**
 * The side-game service over an in-memory ledger: the real fold (survivorSideGameLedger.ts) and the
 * real rules, with only the store's I/O replaced. Covers the Token Pool (pick limits, lose-all, the
 * streak cash-out), the Survivor Pool (rule, out, revive, prize), auctions (sealed lock), the shop
 * (balance check, idempotency, delivery on return) and every write being keyed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { foldSideGameLedger, type SideGameLedgerRow } from '@/lib/survivor/survivorSideGameLedger'
import { readSurvivorSideGameSettings } from '@/lib/survivor/survivorSideGameSettings'
import { foldSideGameRows } from '@/lib/survivor/survivorSideGameRules'

const h = vi.hoisted(() => ({
  rows: [] as Array<{ action: string; relatedEntityId: string; data: Record<string, unknown>; createdAt: string }>,
  players: new Map<string, { userId: string; displayName: string; playerState: string; rosterId: string | null; tokenBalance: number }>(),
  settings: {} as Record<string, unknown>,
  week: 5,
  games: [] as unknown[],
  pay: vi.fn(),
  tick: 0,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    survivorAuditEntry: {
      findFirst: async ({ where }: { where: { data: { equals: string } } }) => {
        const row = h.rows.find((r) => r.action === 'shop_purchase' && r.data.purchaseId === where.data.equals)
        return row ? { data: row.data } : null
      },
    },
  },
}))
vi.mock('@/lib/survivor/exileRosterService', () => ({ exileTeamKey: (_s: string, t: string) => t.toUpperCase() }))
vi.mock('@/lib/survivor/survivorRewardEngine', () => ({ readSurvivorFaabBalance: async () => 80 }))
vi.mock('@/lib/survivor/survivorSideGameStore', () => {
  const state = () => foldSideGameLedger(h.rows as unknown as SideGameLedgerRow[])
  return {
    loadSideGameLeague: async () => ({ id: 'L1', sport: 'NFL', season: 2026, language: null, settings: h.settings, platform: 'allfantasy', userId: 'owner', survivorTokenCap: null, sideGames: readSurvivorSideGameSettings(h.settings) }),
    currentSurvivorWeek: async () => ({ week: h.week, phase: 'pre_merge' }),
    inSideGameLock: async (_l: string, fn: (db: unknown) => unknown) => fn({
      survivorPlayer: { findUnique: async ({ where }: { where: { leagueId_userId: { userId: string } } }) => h.players.get(where.leagueId_userId.userId) ?? null },
    }),
    loadSideGameState: async () => state(),
    appendSideGameRow: async (_db: unknown, st: { keys: Set<string> } | null, args: { entity: string; action: string; key: string; data: Record<string, unknown> }) => {
      if (st?.keys.has(args.key) || h.rows.some((r) => r.data.key === args.key)) return false
      h.tick++
      h.rows.push({ action: args.action, relatedEntityId: args.entity, data: { ...args.data, key: args.key }, createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, h.tick)).toISOString() })
      st?.keys.add(args.key)
      return true
    },
    loadCastaway: async (_db: unknown, _l: string, userId: string) => h.players.get(userId) ?? null,
    loadCastaways: async () => [...h.players.values()],
    adjustSideGameTokens: async (_db: unknown, args: { userId: string; delta: number }) => {
      const p = h.players.get(args.userId)!
      const next = Math.max(0, p.tokenBalance + args.delta)
      const applied = next - p.tokenBalance
      p.tokenBalance = next
      return { applied, balance: next }
    },
    loadSideGameWeekGames: async () => h.games,
    paySideGamePrize: h.pay,
    bidBalance: async () => 80,
    auctionCashOf: () => 0,
  }
})

import {
  buySurvivorShopItem,
  cashOutTokenPool,
  deliverShopPurchase,
  placeSurvivorAuctionBid,
  reviveSurvivorPoolEntry,
  settleSideGamePicksForGame,
  submitSurvivorPoolPick,
  submitTokenPoolPick,
  createSurvivorAuction,
} from '@/lib/survivor/survivorSideGameService'
import { loadSideGameLeague } from '@/lib/survivor/survivorSideGameStore'

const NOW = new Date('2026-10-04T12:00:00Z')
const KICK = new Date('2026-10-04T17:00:00Z')

beforeEach(() => {
  h.rows.length = 0
  h.players.clear()
  h.players.set('exile1', { userId: 'exile1', displayName: 'Ex', playerState: 'exile', rosterId: 'rx', tokenBalance: 3 })
  h.players.set('active1', { userId: 'active1', displayName: 'Ac', playerState: 'active', rosterId: 'ra', tokenBalance: 5 })
  h.settings = {}
  h.week = 5
  h.games = foldSideGameRows('NFL', [
    { homeTeam: 'KC', awayTeam: 'BUF', startTime: KICK, final: false, homeScore: null, awayScore: null },
    { homeTeam: 'DAL', awayTeam: 'PHI', startTime: KICK, final: false, homeScore: null, awayScore: null },
  ])
  h.pay.mockReset()
  h.pay.mockResolvedValue({ ok: true, via: 'reward', rewardId: 'rw1' })
})

describe('Token Pool', () => {
  it('only exiles pick, one game per pick, within the weekly limit, idempotent', async () => {
    expect(await submitTokenPoolPick({ leagueId: 'L1', userId: 'active1', gameKey: 'BUF@KC', teamKey: 'KC', now: NOW })).toMatchObject({ ok: false, status: 403 })
    expect(await submitTokenPoolPick({ leagueId: 'L1', userId: 'exile1', gameKey: 'BUF@KC', teamKey: 'DAL', now: NOW })).toMatchObject({ ok: false, status: 400 })
    expect(await submitTokenPoolPick({ leagueId: 'L1', userId: 'exile1', gameKey: 'BUF@KC', teamKey: 'KC', now: NOW })).toMatchObject({ ok: true, duplicate: false })
    expect(await submitTokenPoolPick({ leagueId: 'L1', userId: 'exile1', gameKey: 'BUF@KC', teamKey: 'KC', now: NOW })).toMatchObject({ ok: true, duplicate: true })
    expect(await submitTokenPoolPick({ leagueId: 'L1', userId: 'exile1', gameKey: 'PHI@DAL', teamKey: 'DAL', now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(await submitTokenPoolPick({ leagueId: 'L1', userId: 'exile1', gameKey: 'PHI@DAL', teamKey: 'DAL', now: new Date('2026-10-04T18:00:00Z') })).toMatchObject({ ok: false })
  })

  it('a closed pool takes no picks', async () => {
    h.settings = { survivorSideGames: { tokenPoolOpen: false } }
    expect(await submitTokenPoolPick({ leagueId: 'L1', userId: 'exile1', gameKey: 'BUF@KC', teamKey: 'KC', now: NOW })).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('closed') })
  })

  it('lose-all: a wrong pick wipes every token, and settling twice changes nothing', async () => {
    h.settings = { survivorSideGames: { tokenPoolWrongPick: 'lose_all' } }
    await submitTokenPoolPick({ leagueId: 'L1', userId: 'exile1', gameKey: 'BUF@KC', teamKey: 'BUF', now: NOW })
    const league = (await loadSideGameLeague({} as never, 'L1'))!
    expect(await settleSideGamePicksForGame({ league, week: 5, gameKey: 'BUF@KC', winnerKey: 'KC', by: 'commissioner' })).toMatchObject({ tokenPool: 1 })
    expect(h.players.get('exile1')!.tokenBalance).toBe(0)
    expect(await settleSideGamePicksForGame({ league, week: 5, gameKey: 'BUF@KC', winnerKey: 'KC', by: 'commissioner' })).toMatchObject({ tokenPool: 0 })
  })

  it('streak: wins build an unbanked pot that the exile cashes out, once', async () => {
    h.settings = { survivorSideGames: { tokenPoolMode: 'streak', tokenPoolPicksPerWeek: 2 } }
    await submitTokenPoolPick({ leagueId: 'L1', userId: 'exile1', gameKey: 'BUF@KC', teamKey: 'KC', now: NOW })
    await submitTokenPoolPick({ leagueId: 'L1', userId: 'exile1', gameKey: 'PHI@DAL', teamKey: 'DAL', now: NOW })
    const league = (await loadSideGameLeague({} as never, 'L1'))!
    await settleSideGamePicksForGame({ league, week: 5, gameKey: 'BUF@KC', winnerKey: 'KC', by: 'auto' })
    await settleSideGamePicksForGame({ league, week: 5, gameKey: 'PHI@DAL', winnerKey: 'DAL', by: 'auto' })
    expect(h.players.get('exile1')!.tokenBalance).toBe(3)
    expect(await cashOutTokenPool({ leagueId: 'L1', userId: 'exile1' })).toMatchObject({ ok: true, banked: 2, balance: 5 })
    expect(await cashOutTokenPool({ leagueId: 'L1', userId: 'exile1' })).toMatchObject({ ok: false, status: 409 })
  })
})

describe('Survivor Pool', () => {
  beforeEach(() => { h.settings = { survivorSideGames: { survivorPoolEnabled: true, survivorPoolRule: 'away_only', survivorPoolRevives: 1, survivorPoolPrize: { kind: 'faab', amount: 50 } } } })

  it('the week’s rule is enforced; a correct pick pays the prize through the reward API', async () => {
    expect(await submitSurvivorPoolPick({ leagueId: 'L1', userId: 'active1', gameKey: 'BUF@KC', teamKey: 'KC', now: NOW })).toMatchObject({ ok: false, status: 400 })
    expect(await submitSurvivorPoolPick({ leagueId: 'L1', userId: 'exile1', gameKey: 'BUF@KC', teamKey: 'BUF', now: NOW })).toMatchObject({ ok: false, status: 403 })
    expect(await submitSurvivorPoolPick({ leagueId: 'L1', userId: 'active1', gameKey: 'BUF@KC', teamKey: 'BUF', now: NOW })).toMatchObject({ ok: true })
    const league = (await loadSideGameLeague({} as never, 'L1'))!
    const r = await settleSideGamePicksForGame({ league, week: 5, gameKey: 'BUF@KC', winnerKey: 'BUF', by: 'auto' })
    expect(r.prizes).toEqual([{ userId: 'active1', week: 5 }])
    const { paySurvivorPoolPrize } = await import('@/lib/survivor/survivorSideGameService')
    await paySurvivorPoolPrize(league, 'active1', 5)
    expect(h.pay).toHaveBeenCalledWith(expect.objectContaining({ prize: expect.objectContaining({ kind: 'faab', amount: 50 }), rosterId: 'ra', key: 'pool:L1:active1:5', targetWeek: 6 }))
  })

  it('a wrong pick knocks you out; one revive brings you back; then you are banned', async () => {
    const league = (await loadSideGameLeague({} as never, 'L1'))!
    await submitSurvivorPoolPick({ leagueId: 'L1', userId: 'active1', gameKey: 'BUF@KC', teamKey: 'BUF', now: NOW })
    await settleSideGamePicksForGame({ league, week: 5, gameKey: 'BUF@KC', winnerKey: 'KC', by: 'auto' })
    expect(await submitSurvivorPoolPick({ leagueId: 'L1', userId: 'active1', gameKey: 'PHI@DAL', teamKey: 'PHI', now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(await reviveSurvivorPoolEntry({ leagueId: 'L1', userId: 'active1', actorUserId: 'active1' })).toMatchObject({ ok: true, revivesLeft: 0 })
    h.week = 6
    await submitSurvivorPoolPick({ leagueId: 'L1', userId: 'active1', gameKey: 'PHI@DAL', teamKey: 'PHI', now: NOW })
    await settleSideGamePicksForGame({ league, week: 6, gameKey: 'PHI@DAL', winnerKey: 'DAL', by: 'auto' })
    expect(await reviveSurvivorPoolEntry({ leagueId: 'L1', userId: 'active1', actorUserId: 'active1' })).toMatchObject({ ok: false, status: 409 })
    expect(await submitSurvivorPoolPick({ leagueId: 'L1', userId: 'active1', gameKey: 'BUF@KC', teamKey: 'BUF', now: NOW })).toMatchObject({ ok: false, error: expect.stringContaining('banned') })
    // The commissioner can grant one more.
    expect(await reviveSurvivorPoolEntry({ leagueId: 'L1', userId: 'active1', actorUserId: 'commish', grant: 1 })).toMatchObject({ ok: true, revivesLeft: 1 })
  })
})

describe('auctions and the shop', () => {
  it('a sealed bid locks; a bid over the balance is refused', async () => {
    const created = await createSurvivorAuction({ leagueId: 'L1', actorUserId: 'c', input: { label: 'Week 5', mode: 'sealed', opensAt: '2026-10-01T00:00:00Z', closesAt: '2026-10-10T00:00:00Z', items: [{ label: 'Vote steal', prize: { kind: 'advantage', powerType: 'vote_steal' } }] } })
    if (!created.ok) throw new Error(created.error)
    const bid = (amount: number) => placeSurvivorAuctionBid({ leagueId: 'L1', userId: 'active1', auctionId: created.auctionId, itemId: 'item1', amount, now: NOW })
    expect(await bid(90)).toMatchObject({ ok: false, status: 400 })
    expect(await bid(20)).toMatchObject({ ok: true })
    expect(await bid(30)).toMatchObject({ ok: false, status: 409 })
    expect(await placeSurvivorAuctionBid({ leagueId: 'L1', userId: 'exile1', auctionId: created.auctionId, itemId: 'item1', amount: 5, now: NOW })).toMatchObject({ ok: false, status: 403 })
  })

  it('the shop: closed by default; priced items deliver at once on the island, on return from Exile', async () => {
    expect(await buySurvivorShopItem({ leagueId: 'L1', userId: 'active1', itemId: 'extra_vote', requestId: 'req-00000001' })).toMatchObject({ ok: false, status: 409 })
    h.settings = { survivorSideGames: { tokenShopEnabled: true, tokenShopItems: [{ id: 'extra_vote', kind: 'advantage', enabled: true, cost: 4, amount: 0, powerType: 'extra_vote' }] } }
    const bought = await buySurvivorShopItem({ leagueId: 'L1', userId: 'active1', itemId: 'extra_vote', requestId: 'req-00000002' })
    expect(bought).toMatchObject({ ok: true, delivery: 'delivered', balance: 1 })
    expect(h.pay).toHaveBeenCalledWith(expect.objectContaining({ prize: expect.objectContaining({ kind: 'advantage', powerType: 'extra_vote' }), rosterId: 'ra' }))
    // Same request again: no second charge.
    await buySurvivorShopItem({ leagueId: 'L1', userId: 'active1', itemId: 'extra_vote', requestId: 'req-00000002' })
    expect(h.players.get('active1')!.tokenBalance).toBe(1)
    expect(await buySurvivorShopItem({ leagueId: 'L1', userId: 'active1', itemId: 'extra_vote', requestId: 'req-00000003' })).toMatchObject({ ok: false, status: 409 })
    // An exile's purchase waits for the return.
    h.players.get('exile1')!.tokenBalance = 4
    h.pay.mockClear()
    const pending = await buySurvivorShopItem({ leagueId: 'L1', userId: 'exile1', itemId: 'extra_vote', requestId: 'req-00000004' })
    expect(pending).toMatchObject({ ok: true, delivery: 'pending', balance: 0 })
    expect(h.pay).not.toHaveBeenCalled()
    h.players.get('exile1')!.playerState = 'active'
    const league = (await loadSideGameLeague({} as never, 'L1'))!
    expect(await deliverShopPurchase(league, (pending as { purchaseId: string }).purchaseId)).toBe(true)
    expect(h.pay).toHaveBeenCalledTimes(1)
  })
})
