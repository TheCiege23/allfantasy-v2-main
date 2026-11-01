import 'server-only'

/**
 * The side games' step in the Survivor season runner (survivorPlannedSeasonRunner.ts, every 5 min).
 * Each part is idempotent and best-effort: a failure is logged and the island carries on.
 *
 *  1. Exile team bids whose close has passed are settled (teams reserved for their winners).
 *  2. Token Pool and Survivor Pool picks settle from OUR stored `SportsGame` finals (never posted by
 *     hand; the commissioner can still override a game in the Hub). Survivor Pool winners are paid.
 *  3. Auctions open at their time (handing out the auction cash the commissioner set) and settle at
 *     their close: highest bid, earliest on a tie, charged in FAAB or auction cash, prize paid through
 *     the reward API.
 *  4. Shop items bought on Exile are delivered once their buyer is back on the island.
 *  5. The FAAB an Exile return converted is paid (retry of the return's own payment).
 *  6. Seats Chimmy runs play: Token Pool and Survivor Pool picks (the stored-data favourite), a streak
 *     banked at 2, and one sane auction bid.
 */

import { prisma } from '@/lib/prisma'
import { isChimmyRunning } from '@/lib/inactive-manager/inactiveManagerMode'
import { readPlayableChimmyLineups } from '@/lib/inactive-manager/chimmyPlayable'
import {
  chimmyAuctionBid,
  chimmySideGamePick,
  CHIMMY_TOKEN_POOL_CASH_OUT_AT,
  poolPickRefusal,
  resolveAuction,
  seasonRecords,
  sideGameWinnerKey,
} from './survivorSideGameRules'
import { survivorPoolRuleForWeek } from './survivorSideGameSettings'
import { SIDE_GAME_ACTIONS, sideGameEntity, type AuctionRecord } from './survivorSideGameLedger'
import {
  appendSideGameRow,
  bidBalance,
  chargeSideGameFaab,
  inSideGameLock,
  loadCastaways,
  loadSideGameLeague,
  loadSideGameSeasonGames,
  loadSideGameState,
  loadSideGameWeekGames,
  paySideGamePrize,
  type SideGameLeague,
} from './survivorSideGameStore'
import {
  cashOutTokenPool,
  deliverShopPurchase,
  paySurvivorPoolPrize,
  placeSurvivorAuctionBid,
  settleSideGamePicksForGame,
  submitSurvivorPoolPick,
  submitTokenPoolPick,
} from './survivorSideGameService'

const SEAT_PREFIX = 'orphan-'

export interface SideGameStepResult {
  exileBidsSettled: number
  tokenPoolSettled: number
  poolSettled: number
  auctionsOpened: number
  auctionsSettled: number
  shopDelivered: number
  chimmy: Record<string, string>
}

const warn = (part: string, leagueId: string) => (error: unknown) => {
  console.warn(`[survivor-side-games] ${part} failed`, { leagueId, error: error instanceof Error ? error.message : String(error) })
  return null
}

export async function runSurvivorSideGameStep(leagueId: string, week: number, now = new Date()): Promise<SideGameStepResult | null> {
  const league = await loadSideGameLeague(prisma, leagueId)
  if (!league) return null
  const out: SideGameStepResult = { exileBidsSettled: 0, tokenPoolSettled: 0, poolSettled: 0, auctionsOpened: 0, auctionsSettled: 0, shopDelivered: 0, chimmy: {} }

  if (league.sideGames.exileClaimMode === 'faab_bid') {
    const { settleDueExileTeamBids } = await import('./survivorExileBids')
    out.exileBidsSettled = (await settleDueExileTeamBids(league, now).catch(warn('exile bids', leagueId))) ?? 0
  }

  const settled = await settleFromStoredFinals(league, week).catch(warn('settlement', leagueId))
  if (settled) {
    out.tokenPoolSettled = settled.tokenPool
    out.poolSettled = settled.pool
  }

  const auctions = await runAuctions(league, week, now).catch(warn('auctions', leagueId))
  if (auctions) {
    out.auctionsOpened = auctions.opened
    out.auctionsSettled = auctions.settled
  }

  out.shopDelivered = (await deliverPendingPurchases(league).catch(warn('shop delivery', leagueId))) ?? 0

  {
    const { settleExileReturnFaab } = await import('./survivorExileLifecycle')
    await settleExileReturnFaab(leagueId).catch(warn('exile return FAAB', leagueId))
  }

  out.chimmy = (await runChimmySideGameTurn(league, week, now).catch(warn('Chimmy turn', leagueId))) ?? {}
  return out
}

/** Settle every open pick, this week and earlier, whose game has a stored final. */
async function settleFromStoredFinals(league: SideGameLeague, week: number): Promise<{ tokenPool: number; pool: number }> {
  const state = await loadSideGameState(prisma, league.id)
  const open = new Map<number, Set<string>>()
  const add = (w: number, key: string) => open.set(w, (open.get(w) ?? new Set()).add(key))
  if (league.sideGames.tokenPoolAutoSettle) for (const tp of state.tokenPool.values()) for (const p of tp.picks) if (p.outcome == null && p.week <= week) add(p.week, `tp|${p.gameKey}`)
  for (const st of state.pool.values()) for (const p of st.picks) if (p.outcome == null && p.week <= week) add(p.week, `pool|${p.gameKey}`)
  let tokenPool = 0
  let pool = 0
  for (const [w, keys] of open) {
    const games = await loadSideGameWeekGames(prisma, league.sport, league.season, w)
    const gameKeys = new Set([...keys].map((k) => k.split('|')[1]))
    for (const gameKey of gameKeys) {
      const game = games.find((g) => g.key === gameKey)
      if (!game || !sideGameWinnerKey(game)) continue
      const which = keys.has(`tp|${gameKey}`) && keys.has(`pool|${gameKey}`) ? 'both' : keys.has(`tp|${gameKey}`) ? 'token_pool' : 'pool'
      const r = await settleSideGamePicksForGame({ league, week: w, gameKey, by: 'auto', games, which })
      tokenPool += r.tokenPool
      pool += r.pool
      for (const prize of r.prizes) await paySurvivorPoolPrize(league, prize.userId, prize.week)
    }
  }
  return { tokenPool, pool }
}

async function runAuctions(league: SideGameLeague, week: number, now: Date): Promise<{ opened: number; settled: number }> {
  const state = await loadSideGameState(prisma, league.id)
  let opened = 0
  let settled = 0
  for (const a of state.auctions.values()) {
    if (a.status === 'scheduled' && new Date(a.opensAt).getTime() <= now.getTime() && now.getTime() < new Date(a.closesAt).getTime()) {
      await openAuction(league, a, week)
      opened++
    }
    const closed = new Date(a.closesAt).getTime() <= now.getTime()
    if ((a.status === 'scheduled' || a.status === 'open' || a.status === 'closed') && closed) {
      await settleAuction(league, a.auctionId, week)
      settled++
    } else if (a.status === 'settled' && now.getTime() - new Date(a.closesAt).getTime() < 2 * 86_400_000) {
      // A settlement interrupted between charging and paying finishes here: every step is keyed.
      await settleAuction(league, a.auctionId, week)
    }
  }
  return { opened, settled }
}

/** Open an auction, and hand every active castaway the auction cash the commissioner set — once. */
async function openAuction(league: SideGameLeague, a: AuctionRecord, week: number): Promise<void> {
  const castaways = a.currency === 'auction_cash' && league.sideGames.auctionCashPerAuction > 0 ? (await loadCastaways(prisma, league.id)).filter((c) => c.playerState === 'active' && c.rosterId) : []
  await inSideGameLock(league.id, async (db) => {
    const state = await loadSideGameState(db, league.id)
    for (const c of castaways) {
      await appendSideGameRow(db, state, {
        leagueId: league.id, entity: sideGameEntity.cash(c.rosterId!), action: SIDE_GAME_ACTIONS.cashCredit, week,
        key: `auctioncash:${a.auctionId}:${c.rosterId}`, data: { amount: league.sideGames.auctionCashPerAuction, reason: `auction:${a.auctionId}` },
      })
    }
    await appendSideGameRow(db, state, {
      leagueId: league.id, entity: sideGameEntity.auction(a.auctionId), action: SIDE_GAME_ACTIONS.auctionStatus, week,
      key: `auctionopen:${a.auctionId}`, data: { status: 'open', cashGranted: castaways.length > 0 },
    })
  })
}

/**
 * Settle a closed auction: award, charge, pay. The award list is written FIRST (idempotent key), then
 * each winner is charged and paid under their own keys, so a retry finishes a half-paid auction
 * without charging anyone twice.
 */
export async function settleAuction(league: SideGameLeague, auctionId: string, week: number): Promise<void> {
  let awards: AuctionRecord['awards'] = []
  let auction: AuctionRecord | null = null
  await inSideGameLock(league.id, async (db) => {
    const state = await loadSideGameState(db, league.id)
    const a = state.auctions.get(auctionId)
    if (!a || a.status === 'cancelled') return
    auction = a
    if (a.status === 'settled') {
      awards = a.awards
      return
    }
    const bidders = [...new Set(a.bids.map((b) => b.rosterId))]
    const balances = new Map<string, number>()
    for (const rosterId of bidders) balances.set(rosterId, await bidBalance(db, state, league.id, a.currency, rosterId))
    awards = resolveAuction(a.items.map((i) => i.itemId), a.bids, balances).map((w) => ({ ...w, rewardId: null, paid: false }))
    await appendSideGameRow(db, state, {
      leagueId: league.id, entity: sideGameEntity.auction(a.auctionId), action: SIDE_GAME_ACTIONS.auctionSettled, week,
      key: `auctionsettled:${a.auctionId}`, data: { awards },
    })
  })
  const a = auction as AuctionRecord | null
  if (!a) return
  const castaways = await loadCastaways(prisma, league.id)
  for (const award of awards) {
    const item = a.items.find((i) => i.itemId === award.itemId)
    const winner = castaways.find((c) => c.rosterId === award.rosterId)
    if (!item || !winner) continue
    if (a.currency === 'faab') {
      await chargeSideGameFaab({ leagueId: league.id, rosterId: award.rosterId, amount: award.amount, key: `auctioncharge:${a.auctionId}:${award.itemId}`, week, reason: `auction:${a.auctionId}:${award.itemId}` })
    } else {
      await inSideGameLock(league.id, async (db) => {
        const state = await loadSideGameState(db, league.id)
        await appendSideGameRow(db, state, {
          leagueId: league.id, entity: sideGameEntity.cash(award.rosterId), action: SIDE_GAME_ACTIONS.cashDebit, week,
          key: `auctioncharge:${a.auctionId}:${award.itemId}`, data: { amount: award.amount, reason: `auction:${a.auctionId}:${award.itemId}` },
        })
      })
    }
    const paid = await paySideGamePrize({
      leagueId: league.id, prize: item.prize, rosterId: award.rosterId, userId: winner.userId, key: `auction:${a.auctionId}:${award.itemId}`, week, targetWeek: week,
      source: { kind: 'auction', id: a.auctionId, label: `${a.label}: ${item.label}` }, tokenCap: league.survivorTokenCap,
    })
    if (!paid.ok) console.warn('[survivor-side-games] auction prize not paid', { leagueId: league.id, auctionId, itemId: award.itemId, error: paid.error })
  }
}

async function deliverPendingPurchases(league: SideGameLeague): Promise<number> {
  const state = await loadSideGameState(prisma, league.id)
  const pending = state.purchases.filter((p) => p.status === 'pending')
  if (!pending.length) return 0
  const castaways = await loadCastaways(prisma, league.id)
  let delivered = 0
  for (const p of pending) {
    if (castaways.find((c) => c.userId === p.userId)?.playerState !== 'active') continue
    if (await deliverShopPurchase(league, p.purchaseId)) delivered++
  }
  return delivered
}

/**
 * Chimmy's side-game turn for the seats it runs (`isChimmyRunning`, the same test as its council and
 * Exile turns). Deterministic: the stored-data favourite (best season record from our finals, home
 * field as the tie-break), a streak banked at CHIMMY_TOKEN_POOL_CASH_OUT_AT, and at most one auction
 * bid of at most a quarter of its balance. It plays through the same actions a person uses, so every
 * rule (locks, limits, balances) still applies.
 */
export async function runChimmySideGameTurn(league: SideGameLeague, week: number, now: Date): Promise<Record<string, string>> {
  const s = league.sideGames
  const anything = s.tokenPoolEnabled || s.survivorPoolEnabled
  const state = await loadSideGameState(prisma, league.id)
  const liveAuctions = [...state.auctions.values()].filter((a) => a.status !== 'cancelled' && a.status !== 'settled' && new Date(a.opensAt).getTime() <= now.getTime() && now.getTime() < new Date(a.closesAt).getTime())
  if (!anything && !liveAuctions.length) return {}
  const castaways = (await loadCastaways(prisma, league.id)).filter((c) => c.userId.startsWith(SEAT_PREFIX))
  if (!castaways.length) return {}
  const managed = await readPlayableChimmyLineups({ id: league.id, userId: league.userId, settings: league.settings })
  const seats = castaways.filter((c) => isChimmyRunning(managed, c.rosterId ?? c.userId.slice(SEAT_PREFIX.length), c.userId))
  if (!seats.length) return {}
  const games = week > 0 ? await loadSideGameWeekGames(prisma, league.sport, league.season, week) : []
  const records = seasonRecords(await loadSideGameSeasonGames(prisma, league.sport, league.season, week))
  const turn: Record<string, string> = {}
  for (const seat of seats) {
    try {
      if (seat.playerState === 'exile' && s.tokenPoolEnabled && s.tokenPoolOpen) {
        const tp = state.tokenPool.get(seat.userId)
        if (s.tokenPoolMode === 'streak' && (tp?.pot ?? 0) >= CHIMMY_TOKEN_POOL_CASH_OUT_AT) {
          await cashOutTokenPool({ leagueId: league.id, userId: seat.userId, actorUserId: seat.userId })
          turn[seat.userId] = 'token_pool_cashed_out'
        }
        const made = (tp?.picks ?? []).filter((p) => p.week === week)
        if (made.length < s.tokenPoolPicksPerWeek) {
          const taken = new Set(made.map((p) => p.gameKey))
          const pick = chimmySideGamePick(games.filter((g) => !taken.has(g.key)), records, now)
          if (pick) {
            const r = await submitTokenPoolPick({ leagueId: league.id, userId: seat.userId, gameKey: pick.gameKey, teamKey: pick.teamKey, now })
            turn[seat.userId] = r.ok ? 'token_pool_picked' : `token_pool_${r.status}`
          }
        }
      }
      if (seat.playerState === 'active' && s.survivorPoolEnabled && week >= s.survivorPoolStartWeek) {
        const pool = state.pool.get(seat.userId)
        const entry = pool?.entry
        const picked = pool?.picks.some((p) => p.week === week)
        if ((!entry || entry.alive) && !picked) {
          const rule = survivorPoolRuleForWeek(s, week)
          const pick = chimmySideGamePick(games, records, now, (game, teamKey) => poolPickRefusal(league.sport, rule, game, teamKey) == null)
          if (pick) {
            const r = await submitSurvivorPoolPick({ leagueId: league.id, userId: seat.userId, gameKey: pick.gameKey, teamKey: pick.teamKey, now })
            turn[seat.userId] = r.ok ? 'pool_picked' : `pool_${r.status}`
          }
        }
      }
      if (seat.playerState === 'active' && seat.rosterId) {
        for (const a of liveAuctions) {
          const balance = await bidBalance(prisma, state, league.id, a.currency, seat.rosterId)
          const bid = chimmyAuctionBid({ mode: a.mode, balance, items: a.items.map((i) => ({ itemId: i.itemId, blind: i.blind, prizeKind: i.prize.kind })), bids: a.bids, rosterId: seat.rosterId })
          if (!bid) continue
          const r = await placeSurvivorAuctionBid({ leagueId: league.id, userId: seat.userId, auctionId: a.auctionId, itemId: bid.itemId, amount: bid.amount, now })
          turn[seat.userId] = r.ok ? 'auction_bid' : `auction_${r.status}`
        }
      }
    } catch (error) {
      turn[seat.userId] = error instanceof Error ? error.message : 'error'
    }
  }
  return turn
}
