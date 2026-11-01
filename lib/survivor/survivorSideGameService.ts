import 'server-only'

/**
 * Exile Island and the side games — every action a castaway or the commissioner takes, and the
 * views the screens read. Rules: survivorSideGameRules.ts. Ledger: survivorSideGameLedger.ts.
 * Automation: survivorSideGameRunner.ts.
 *
 * Each action returns `{ ok: false, status, error }` for anything a person could fix (never a throw
 * for bad input), in the league's language.
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { sideGameCopy } from './survivorSideGameCopy'
import {
  bidRefusal,
  applyPoolOutcome,
  EMPTY_POOL_ENTRY,
  highBid,
  pickOutcome,
  poolBanned,
  poolPickRefusal,
  poolRevivesLeft,
  revivePoolEntry,
  settleTokenPoolPick,
  shopPurchaseRefusal,
  sideGamePickOpen,
  sideGameWinnerKey,
  type PoolEntryState,
} from './survivorSideGameRules'
import {
  lockedSideGameKeys,
  mergeSurvivorSideGamesIntoSettings,
  readSideGamePrize,
  survivorPoolRuleForWeek,
  validateSurvivorSideGamePatch,
  type SideGamePrize,
  type SurvivorSideGameKey,
  type SurvivorSideGameSettings,
} from './survivorSideGameSettings'
import { SIDE_GAME_ACTIONS, sideGameEntity, visibleAuctionItems, type AuctionItem, type AuctionRecord, type SideGameState } from './survivorSideGameLedger'
import {
  adjustSideGameTokens,
  appendSideGameRow,
  auctionCashOf,
  bidBalance,
  currentSurvivorWeek,
  inSideGameLock,
  loadCastaway,
  loadCastaways,
  loadSideGameLeague,
  loadSideGameState,
  loadSideGameWeekGames,
  paySideGamePrize,
  type SideGameLeague,
} from './survivorSideGameStore'
import { readSurvivorFaabBalance } from './survivorRewardEngine'
import { exileTeamKey } from './exileRosterService'
import type { SideGameReportInput } from './survivorSideGameSummary'

export type SideGameResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; status: 400 | 403 | 404 | 409; error: string }

const no = (status: 400 | 403 | 404 | 409, error: string): { ok: false; status: 400 | 403 | 404 | 409; error: string } => ({ ok: false, status, error })

async function ctx(leagueId: string) {
  const league = await loadSideGameLeague(prisma, leagueId)
  if (!league) return null
  const { week } = await currentSurvivorWeek(prisma, leagueId)
  return { league, week, m: sideGameCopy(league.language) }
}

// ── Token Pool ─────────────────────────────────────────────────────────────────────────────────

export async function submitTokenPoolPick(args: { leagueId: string; userId: string; gameKey: string; teamKey: string; now?: Date }): Promise<SideGameResult<{ pickId: string; duplicate: boolean }>> {
  const now = args.now ?? new Date()
  const c = await ctx(args.leagueId)
  if (!c) return no(404, sideGameCopy(null).notSurvivor)
  const { league, week, m } = c
  const s = league.sideGames
  if (!s.tokenPoolEnabled) return no(409, m.tokenPoolOff)
  if (!s.tokenPoolOpen) return no(409, m.tokenPoolClosed)
  const me = await loadCastaway(prisma, args.leagueId, args.userId)
  if (!me) return no(403, m.notCastaway)
  if (me.playerState !== 'exile') return no(403, m.onlyExiles)
  const games = await loadSideGameWeekGames(prisma, league.sport, league.season, week)
  const game = games.find((g) => g.key === args.gameKey)
  if (!game) return no(404, m.gameNotFound)
  if (args.teamKey !== game.homeKey && args.teamKey !== game.awayKey) return no(400, m.teamNotInGame)
  if (!sideGamePickOpen(game, now)) return no(409, m.gameLocked)
  return inSideGameLock(args.leagueId, async (db) => {
    const state = await loadSideGameState(db, args.leagueId)
    const mine = state.tokenPool.get(args.userId)?.picks.filter((p) => p.week === week) ?? []
    const key = `tp:${args.userId}:${week}:${game.key}`
    if (state.keys.has(key)) return { ok: true as const, pickId: key, duplicate: true }
    if (mine.some((p) => p.gameKey === game.key)) return no(409, m.alreadyPicked)
    if (mine.length >= s.tokenPoolPicksPerWeek) return no(409, m.tokenPoolLimit(s.tokenPoolPicksPerWeek))
    await appendSideGameRow(db, state, {
      leagueId: args.leagueId, entity: sideGameEntity.tokenPool(args.userId), action: SIDE_GAME_ACTIONS.tokenPoolPick, week, key,
      actorUserId: args.userId, targetUserId: args.userId,
      data: { pickId: key, week, gameKey: game.key, teamKey: args.teamKey, at: now.toISOString() },
    })
    return { ok: true as const, pickId: key, duplicate: false }
  })
}

/** Streak mode: bank the pot into the token balance ("stop any time"). Idempotent per settled pick count. */
export async function cashOutTokenPool(args: { leagueId: string; userId: string; actorUserId?: string }): Promise<SideGameResult<{ banked: number; balance: number }>> {
  const c = await ctx(args.leagueId)
  if (!c) return no(404, sideGameCopy(null).notSurvivor)
  const { league, week, m } = c
  if (league.sideGames.tokenPoolMode !== 'streak') return no(409, m.notStreak)
  const me = await loadCastaway(prisma, args.leagueId, args.userId)
  if (!me) return no(403, m.notCastaway)
  return inSideGameLock(args.leagueId, async (db) => {
    const state = await loadSideGameState(db, args.leagueId)
    const tp = state.tokenPool.get(args.userId)
    const pot = tp?.pot ?? 0
    if (pot < 1) return no(409, m.nothingToCashOut)
    const settled = tp?.picks.filter((p) => p.outcome != null).length ?? 0
    const key = `tpco:${args.userId}:${settled}`
    const { balance } = await adjustSideGameTokens(db, { leagueId: args.leagueId, userId: args.userId, week, delta: pot, cap: league.survivorTokenCap, source: 'token_pool_cash_out' })
    await appendSideGameRow(db, state, {
      leagueId: args.leagueId, entity: sideGameEntity.tokenPool(args.userId), action: SIDE_GAME_ACTIONS.tokenPoolCashOut, week, key,
      actorUserId: args.actorUserId ?? args.userId, targetUserId: args.userId, data: { amount: pot },
    })
    return { ok: true as const, banked: pot, balance }
  })
}

// ── Survivor Pool ──────────────────────────────────────────────────────────────────────────────

export async function submitSurvivorPoolPick(args: { leagueId: string; userId: string; gameKey: string; teamKey: string; now?: Date }): Promise<SideGameResult<{ week: number }>> {
  const now = args.now ?? new Date()
  const c = await ctx(args.leagueId)
  if (!c) return no(404, sideGameCopy(null).notSurvivor)
  const { league, week, m } = c
  const s = league.sideGames
  if (!s.survivorPoolEnabled) return no(409, m.poolOff)
  if (week < s.survivorPoolStartWeek) return no(409, m.poolNotStarted(s.survivorPoolStartWeek))
  const me = await loadCastaway(prisma, args.leagueId, args.userId)
  if (!me) return no(403, m.notCastaway)
  if (me.playerState !== 'active') return no(403, m.onlyActive)
  const games = await loadSideGameWeekGames(prisma, league.sport, league.season, week)
  const game = games.find((g) => g.key === args.gameKey)
  if (!game) return no(404, m.gameNotFound)
  const refusal = poolPickRefusal(league.sport, survivorPoolRuleForWeek(s, week), game, args.teamKey)
  if (refusal) return no(400, poolRefusalText(refusal, survivorPoolRuleForWeek(s, week).conference, m))
  if (!sideGamePickOpen(game, now)) return no(409, m.gameLocked)
  return inSideGameLock(args.leagueId, async (db) => {
    const state = await loadSideGameState(db, args.leagueId)
    const pool = state.pool.get(args.userId)
    const entry = pool?.entry ?? EMPTY_POOL_ENTRY
    if (poolBanned(entry, s.survivorPoolRevives)) return no(409, m.poolBanned)
    if (!entry.alive) return no(409, m.poolOut)
    const current = pool?.picks.find((p) => p.week === week && p.outcome == null)
    if (current) {
      const currentGame = games.find((g) => g.key === current.gameKey)
      if (currentGame && !sideGamePickOpen(currentGame, now)) return no(409, m.poolPickLocked)
    }
    const key = `pool:${args.userId}:${week}:${game.key}:${args.teamKey}:${current ? current.at : 'first'}`
    await appendSideGameRow(db, state, {
      leagueId: args.leagueId, entity: sideGameEntity.pool(args.userId), action: SIDE_GAME_ACTIONS.poolPick, week, key,
      actorUserId: args.userId, targetUserId: args.userId, data: { week, gameKey: game.key, teamKey: args.teamKey, at: now.toISOString() },
    })
    return { ok: true as const, week }
  })
}

function poolRefusalText(r: NonNullable<ReturnType<typeof poolPickRefusal>>, conference: string, m: ReturnType<typeof sideGameCopy>): string {
  switch (r) {
    case 'not_in_conference': return m.poolNotInConference(conference)
    case 'not_away': return m.poolNotAway
    case 'not_allowed': return m.poolNotAllowed
    case 'conference_unknown': return m.poolConferenceUnknown
    case 'not_in_game': return m.teamNotInGame
  }
}

/** Use one revive (the manager) or grant extra ones (the commissioner, `grant`). */
export async function reviveSurvivorPoolEntry(args: { leagueId: string; userId: string; actorUserId: string; grant?: number }): Promise<SideGameResult<{ entry: PoolEntryState; revivesLeft: number }>> {
  const c = await ctx(args.leagueId)
  if (!c) return no(404, sideGameCopy(null).notSurvivor)
  const { league, week, m } = c
  const allowance = league.sideGames.survivorPoolRevives
  const me = await loadCastaway(prisma, args.leagueId, args.userId)
  if (!me) return no(404, m.notCastaway)
  return inSideGameLock(args.leagueId, async (db) => {
    const state = await loadSideGameState(db, args.leagueId)
    const entry = state.pool.get(args.userId)?.entry ?? EMPTY_POOL_ENTRY
    if (args.grant) {
      const next: PoolEntryState = { ...entry, revivesGranted: entry.revivesGranted + args.grant }
      await appendSideGameRow(db, state, {
        leagueId: args.leagueId, entity: sideGameEntity.pool(args.userId), action: SIDE_GAME_ACTIONS.poolReviveGranted, week,
        key: `poolgrant:${args.userId}:${entry.revivesGranted}:${randomUUID()}`, actorUserId: args.actorUserId, targetUserId: args.userId,
        data: { entry: next, grant: args.grant },
      })
      return { ok: true as const, entry: next, revivesLeft: poolRevivesLeft(next, allowance) }
    }
    if (entry.alive) return no(409, m.poolStillIn)
    const next = revivePoolEntry(entry, allowance)
    if (!next) return no(409, m.poolNoRevive)
    await appendSideGameRow(db, state, {
      leagueId: args.leagueId, entity: sideGameEntity.pool(args.userId), action: SIDE_GAME_ACTIONS.poolRevive, week,
      key: `poolrev:${args.userId}:${next.revivesUsed}`, actorUserId: args.actorUserId, targetUserId: args.userId, data: { entry: next },
    })
    return { ok: true as const, entry: next, revivesLeft: poolRevivesLeft(next, allowance) }
  })
}

// ── Settlement (runner and commissioner override) ──────────────────────────────────────────────

/**
 * Settle every open Token Pool and Survivor Pool pick on one game. `winnerKey` is the commissioner's
 * override; without it the stored final decides (and an unfinished or conflicting game settles nothing).
 */
export async function settleSideGamePicksForGame(args: {
  league: SideGameLeague
  week: number
  gameKey: string
  winnerKey?: string | 'tie' | null
  by: 'auto' | 'commissioner'
  actorUserId?: string | null
  games?: Awaited<ReturnType<typeof loadSideGameWeekGames>>
  which?: 'token_pool' | 'pool' | 'both'
}): Promise<{ tokenPool: number; pool: number; prizes: Array<{ userId: string; week: number }> }> {
  const { league, week } = args
  const s = league.sideGames
  let winner = args.winnerKey ?? null
  if (!winner) {
    const games = args.games ?? (await loadSideGameWeekGames(prisma, league.sport, league.season, week))
    const game = games.find((g) => g.key === args.gameKey)
    winner = game ? sideGameWinnerKey(game) : null
  }
  if (!winner) return { tokenPool: 0, pool: 0, prizes: [] }
  const which = args.which ?? 'both'
  return inSideGameLock(league.id, async (db) => {
    const state = await loadSideGameState(db, league.id)
    let tokenPool = 0
    let pool = 0
    const prizes: Array<{ userId: string; week: number }> = []
    if (which !== 'pool') {
      for (const [userId, tp] of state.tokenPool) {
        // Picks settle in the order they were made, so a streak pot grows and breaks in order.
        for (const pick of tp.picks.filter((p) => p.week === week && p.gameKey === args.gameKey && p.outcome == null)) {
          const outcome = pickOutcome(pick.teamKey, winner)
          const player = await db.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId: league.id, userId } }, select: { tokenBalance: true } })
          const result = settleTokenPoolPick({ mode: s.tokenPoolMode, wrongPick: s.tokenPoolWrongPick, outcome, balance: player?.tokenBalance ?? 0, pot: tp.pot })
          if (result.balanceDelta) await adjustSideGameTokens(db, { leagueId: league.id, userId, week, delta: result.balanceDelta, cap: league.survivorTokenCap, source: 'token_pool' })
          await appendSideGameRow(db, state, {
            leagueId: league.id, entity: sideGameEntity.tokenPool(userId), action: SIDE_GAME_ACTIONS.tokenPoolSettled, week,
            key: `tpset:${pick.pickId}`, actorUserId: args.actorUserId ?? null, targetUserId: userId,
            data: { pickId: pick.pickId, outcome, balanceDelta: result.balanceDelta, potAfter: result.potAfter, lostAll: result.lostAll, by: args.by, winner },
          })
          pick.outcome = outcome
          tp.pot = result.potAfter
          tokenPool++
        }
      }
    }
    if (which !== 'token_pool') {
      for (const [userId, st] of state.pool) {
        const pick = st.picks.find((p) => p.week === week && p.gameKey === args.gameKey && p.outcome == null)
        if (!pick) continue
        const outcome = pickOutcome(pick.teamKey, winner)
        const entry = applyPoolOutcome(st.entry, outcome, week)
        await appendSideGameRow(db, state, {
          leagueId: league.id, entity: sideGameEntity.pool(userId), action: SIDE_GAME_ACTIONS.poolSettled, week,
          key: `poolset:${userId}:${week}`, actorUserId: args.actorUserId ?? null, targetUserId: userId,
          data: { week, outcome, entry, by: args.by, winner },
        })
        st.entry = entry
        pick.outcome = outcome
        pool++
        if (outcome === 'correct') prizes.push({ userId, week })
      }
    }
    return { tokenPool, pool, prizes }
  })
}

/** Pay the Survivor Pool prize for one correct week. Idempotent on (league, manager, week). */
export async function paySurvivorPoolPrize(league: SideGameLeague, userId: string, week: number): Promise<void> {
  const prize = league.sideGames.survivorPoolPrize
  if (prize.kind === 'none') return
  const me = await loadCastaway(prisma, league.id, userId)
  if (!me) return
  const result = await paySideGamePrize({
    leagueId: league.id, prize, rosterId: me.rosterId, userId, key: `pool:${league.id}:${userId}:${week}`, week, targetWeek: week + 1,
    source: { kind: 'pool', id: `survivor-pool-week-${week}`, label: `Survivor Pool week ${week}` }, tokenCap: league.survivorTokenCap,
  })
  if (!result.ok) console.warn('[survivor-side-games] pool prize not paid', { leagueId: league.id, userId, week, error: result.error })
}

// ── Auctions ───────────────────────────────────────────────────────────────────────────────────

export interface CreateAuctionInput {
  label: string
  mode: 'sealed' | 'open'
  currency?: 'faab' | 'auction_cash'
  opensAt: string
  closesAt: string
  items: Array<{ label: string; blind?: boolean; prize: unknown }>
}

export function validateCreateAuction(input: unknown, defaults: SurvivorSideGameSettings): { ok: true; value: Omit<AuctionRecord, 'auctionId' | 'week' | 'status' | 'bids' | 'awards' | 'cashGranted'> } | { ok: false; error: string } {
  const r = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const label = typeof r.label === 'string' ? r.label.trim().slice(0, 80) : ''
  if (!label) return { ok: false, error: 'Give the auction a name.' }
  const opens = typeof r.opensAt === 'string' ? new Date(r.opensAt) : null
  const closes = typeof r.closesAt === 'string' ? new Date(r.closesAt) : null
  if (!opens || !closes || Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime())) return { ok: false, error: 'Set when the auction opens and closes.' }
  if (closes.getTime() <= opens.getTime()) return { ok: false, error: 'The auction must close after it opens.' }
  if (closes.getTime() - opens.getTime() > 21 * 86_400_000) return { ok: false, error: 'An auction can run for at most three weeks.' }
  const rawItems = Array.isArray(r.items) ? r.items : []
  if (!rawItems.length || rawItems.length > 12) return { ok: false, error: 'List between 1 and 12 items.' }
  const items: AuctionItem[] = []
  for (const [i, raw] of rawItems.entries()) {
    const it = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const itemLabel = typeof it.label === 'string' ? it.label.trim().slice(0, 80) : ''
    const prize = readSideGamePrize(it.prize)
    if (!itemLabel) return { ok: false, error: `Item ${i + 1} needs a name.` }
    if (prize.kind === 'none') return { ok: false, error: `Item ${i + 1} needs a prize.` }
    if (['faab', 'score_bonus', 'auction_cash', 'tokens'].includes(prize.kind) && prize.amount < 1) return { ok: false, error: `Item ${i + 1} needs an amount.` }
    items.push({ itemId: `item${i + 1}`, label: itemLabel, blind: it.blind === true, prize })
  }
  return {
    ok: true,
    value: {
      label,
      mode: r.mode === 'open' ? 'open' : 'sealed',
      currency: r.currency === 'auction_cash' || r.currency === 'faab' ? r.currency : defaults.auctionCurrency,
      opensAt: opens.toISOString(),
      closesAt: closes.toISOString(),
      items,
    },
  }
}

export async function createSurvivorAuction(args: { leagueId: string; actorUserId: string; input: unknown }): Promise<SideGameResult<{ auctionId: string }>> {
  const c = await ctx(args.leagueId)
  if (!c) return no(404, sideGameCopy(null).notSurvivor)
  const parsed = validateCreateAuction(args.input, c.league.sideGames)
  if (!parsed.ok) return no(400, parsed.error)
  const auctionId = randomUUID()
  await inSideGameLock(args.leagueId, async (db) => {
    const state = await loadSideGameState(db, args.leagueId)
    await appendSideGameRow(db, state, {
      leagueId: args.leagueId, entity: sideGameEntity.auction(auctionId), action: SIDE_GAME_ACTIONS.auctionCreated, week: c.week,
      key: `auction:${auctionId}`, actorUserId: args.actorUserId, data: { auction: { ...parsed.value, week: c.week } },
    })
  })
  return { ok: true, auctionId }
}

/** The commissioner's live controls: open now, close now (the runner settles it on its next tick), cancel. */
export async function setSurvivorAuctionStatus(args: { leagueId: string; actorUserId: string; auctionId: string; status: 'open' | 'closed' | 'cancelled'; now?: Date }): Promise<SideGameResult<{ status: string }>> {
  const now = args.now ?? new Date()
  const c = await ctx(args.leagueId)
  if (!c) return no(404, sideGameCopy(null).notSurvivor)
  return inSideGameLock(args.leagueId, async (db) => {
    const state = await loadSideGameState(db, args.leagueId)
    const a = state.auctions.get(args.auctionId)
    if (!a) return no(404, c.m.auctionNotFound)
    if (a.status === 'settled' || a.status === 'cancelled') return no(409, c.m.auctionNotOpen)
    await appendSideGameRow(db, state, {
      leagueId: args.leagueId, entity: sideGameEntity.auction(a.auctionId), action: SIDE_GAME_ACTIONS.auctionStatus, week: c.week,
      key: `auctionstatus:${a.auctionId}:${args.status}:${now.toISOString()}`, actorUserId: args.actorUserId,
      data: { status: args.status, ...(args.status === 'closed' ? { closesAt: now.toISOString() } : {}) },
    })
    return { ok: true as const, status: args.status }
  })
}

export function auctionTakingBids(a: AuctionRecord, now: Date): boolean {
  if (a.status === 'cancelled' || a.status === 'settled' || a.status === 'closed') return false
  return new Date(a.opensAt).getTime() <= now.getTime() && now.getTime() < new Date(a.closesAt).getTime()
}

export async function placeSurvivorAuctionBid(args: { leagueId: string; userId: string; auctionId: string; itemId: string; amount: number; now?: Date }): Promise<SideGameResult<{ amount: number }>> {
  const now = args.now ?? new Date()
  const c = await ctx(args.leagueId)
  if (!c) return no(404, sideGameCopy(null).notSurvivor)
  const { m } = c
  const me = await loadCastaway(prisma, args.leagueId, args.userId)
  if (!me) return no(403, m.notCastaway)
  if (me.playerState !== 'active' || !me.rosterId) return no(403, m.onlyActive)
  return inSideGameLock(args.leagueId, async (db) => {
    const state = await loadSideGameState(db, args.leagueId)
    const a = state.auctions.get(args.auctionId)
    if (!a) return no(404, m.auctionNotFound)
    if (!auctionTakingBids(a, now)) return no(409, m.auctionNotOpen)
    if (!a.items.some((i) => i.itemId === args.itemId)) return no(404, m.auctionItemNotFound)
    const balance = await bidBalance(db, state, args.leagueId, a.currency, me.rosterId)
    const itemBids = a.bids.filter((b) => b.itemId === args.itemId)
    const mine = itemBids.find((b) => b.rosterId === me.rosterId) ?? null
    const high = highBid(args.itemId, itemBids)
    const refusal = bidRefusal({ mode: a.mode, amount: args.amount, balance, mine, high })
    if (refusal === 'not_whole') return no(400, m.bidNotWhole)
    if (refusal === 'over_balance') return no(400, m.bidOverBalance(balance))
    if (refusal === 'locked') return no(409, m.bidLocked)
    if (refusal === 'too_low') return no(409, m.bidTooLow(high?.amount ?? 0))
    await appendSideGameRow(db, state, {
      leagueId: args.leagueId, entity: sideGameEntity.auction(a.auctionId), action: SIDE_GAME_ACTIONS.auctionBid, week: c.week,
      key: `bid:${a.auctionId}:${args.itemId}:${me.rosterId}:${args.amount}`, actorUserId: args.userId, targetUserId: args.userId,
      data: { itemId: args.itemId, rosterId: me.rosterId, amount: args.amount, at: now.toISOString() },
    })
    return { ok: true as const, amount: args.amount }
  })
}

export async function grantSurvivorAuctionCash(args: { leagueId: string; actorUserId: string; rosterId: string; amount: number; reason?: string }): Promise<SideGameResult<{ balance: number }>> {
  const c = await ctx(args.leagueId)
  if (!c) return no(404, sideGameCopy(null).notSurvivor)
  if (!Number.isInteger(args.amount) || args.amount === 0 || Math.abs(args.amount) > 1000) return no(400, c.m.invalid)
  return inSideGameLock(args.leagueId, async (db) => {
    const state = await loadSideGameState(db, args.leagueId)
    await appendSideGameRow(db, state, {
      leagueId: args.leagueId, entity: sideGameEntity.cash(args.rosterId), action: args.amount > 0 ? SIDE_GAME_ACTIONS.cashCredit : SIDE_GAME_ACTIONS.cashDebit, week: c.week,
      key: `cashgrant:${args.rosterId}:${randomUUID()}`, actorUserId: args.actorUserId, data: { amount: Math.abs(args.amount), reason: args.reason?.slice(0, 120) || 'commissioner' },
    })
    const after = await loadSideGameState(db, args.leagueId)
    return { ok: true as const, balance: auctionCashOf(after, args.rosterId) }
  })
}

// ── Token shop ─────────────────────────────────────────────────────────────────────────────────

/**
 * Spend tokens in the shop. The tokens leave and the purchase is recorded in ONE transaction; the
 * item is then delivered through the reward API. A buyer still on Exile (where tokens are earned)
 * holds the item until they are back on the island — the runner delivers it then — because every
 * reward needs an active castaway. Idempotent on the client's `requestId`.
 */
export async function buySurvivorShopItem(args: { leagueId: string; userId: string; itemId: string; requestId: string }): Promise<SideGameResult<{ purchaseId: string; delivery: 'delivered' | 'pending'; balance: number; message?: string }>> {
  const c = await ctx(args.leagueId)
  if (!c) return no(404, sideGameCopy(null).notSurvivor)
  const { league, week, m } = c
  if (!/^[A-Za-z0-9-]{8,64}$/.test(args.requestId)) return no(400, m.invalid)
  const item = league.sideGames.tokenShopItems.find((i) => i.id === args.itemId)
  const purchaseId = `shop:${args.userId}:${args.requestId}`
  const bought = await inSideGameLock(args.leagueId, async (db) => {
    const state = await loadSideGameState(db, args.leagueId)
    const prior = state.purchases.find((p) => p.purchaseId === purchaseId)
    const me = await loadCastaway(db, args.leagueId, args.userId)
    if (!me) return no(403, m.notCastaway)
    if (prior) return { ok: true as const, purchaseId, me, duplicate: true }
    const refusal = shopPurchaseRefusal({ shopEnabled: league.sideGames.tokenShopEnabled, item, balance: me.tokenBalance })
    if (refusal === 'shop_closed') return no(409, m.shopClosed)
    if (refusal === 'not_for_sale') return no(404, m.shopNotForSale)
    if (refusal === 'not_enough_tokens') return no(409, m.shopNotEnough(item!.cost, me.tokenBalance))
    const { balance } = await adjustSideGameTokens(db, { leagueId: args.leagueId, userId: args.userId, week, delta: -item!.cost, cap: null, source: `token_shop:${item!.id}` })
    await appendSideGameRow(db, state, {
      leagueId: args.leagueId, entity: sideGameEntity.shop(args.userId), action: SIDE_GAME_ACTIONS.shopPurchase, week, key: purchaseId,
      actorUserId: args.userId, targetUserId: args.userId,
      data: { purchaseId, rosterId: me.rosterId, itemId: item!.id, kind: item!.kind, cost: item!.cost, item: item!, status: 'pending' },
    })
    return { ok: true as const, purchaseId, me: { ...me, tokenBalance: balance }, duplicate: false }
  })
  if (!bought.ok) return bought
  const delivered = bought.me.playerState === 'active' ? await deliverShopPurchase(league, purchaseId) : false
  return {
    ok: true,
    purchaseId,
    delivery: delivered ? 'delivered' : 'pending',
    balance: bought.me.tokenBalance,
    ...(delivered ? {} : { message: m.shopPending }),
  }
}

/** Deliver one pending shop purchase through the reward API. True when it has been delivered. */
export async function deliverShopPurchase(league: SideGameLeague, purchaseId: string): Promise<boolean> {
  const state = await loadSideGameState(prisma, league.id)
  const p = state.purchases.find((x) => x.purchaseId === purchaseId)
  if (!p) return false
  if (p.status === 'delivered') return true
  const me = await loadCastaway(prisma, league.id, p.userId)
  if (!me || me.playerState !== 'active' || !me.rosterId) return false
  const row = await prisma.survivorAuditEntry.findFirst({ where: { leagueId: league.id, relatedEntityType: 'survivor_side_game', action: SIDE_GAME_ACTIONS.shopPurchase, data: { path: ['purchaseId'], equals: purchaseId } }, select: { data: true } })
  const item = (row?.data as Record<string, unknown> | undefined)?.item as SurvivorSideGameSettings['tokenShopItems'][number] | undefined
  if (!item) return false
  const prize: SideGamePrize = { kind: item.kind, amount: item.amount, powerType: item.powerType, samePositionOnly: item.samePositionOnly }
  const { week } = await currentSurvivorWeek(prisma, league.id)
  const result = await paySideGamePrize({
    leagueId: league.id, prize, rosterId: me.rosterId, userId: p.userId, key: `shopitem:${purchaseId}`, week, targetWeek: week,
    source: { kind: 'exile', id: purchaseId, label: `Token shop: ${item.id}` }, tokenCap: league.survivorTokenCap,
  })
  if (!result.ok) {
    console.warn('[survivor-side-games] shop delivery failed', { leagueId: league.id, purchaseId, error: result.error })
    return false
  }
  await inSideGameLock(league.id, async (db) => {
    const st = await loadSideGameState(db, league.id)
    await appendSideGameRow(db, st, {
      leagueId: league.id, entity: sideGameEntity.shop(p.userId), action: SIDE_GAME_ACTIONS.shopDelivered, week, key: `shopdone:${purchaseId}`,
      targetUserId: p.userId, data: { purchaseId, rewardId: result.rewardId },
    })
  })
  return true
}

// ── Exile team bids ────────────────────────────────────────────────────────────────────────────

export async function placeExileTeamBid(args: { leagueId: string; userId: string; team: string; amount: number; now?: Date }): Promise<SideGameResult<{ week: number; closesAt: string }>> {
  const now = args.now ?? new Date()
  const c = await ctx(args.leagueId)
  if (!c) return no(404, sideGameCopy(null).notSurvivor)
  const { league, m } = c
  const s = league.sideGames
  if (s.exileClaimMode !== 'faab_bid') return no(409, m.exileBidsOff)
  const me = await loadCastaway(prisma, args.leagueId, args.userId)
  if (!me) return no(403, m.notCastaway)
  if (me.playerState !== 'exile') return no(403, m.onlyExiles)
  if (!Number.isInteger(args.amount) || args.amount < 0) return no(400, m.bidNotWhole)
  if (args.amount > s.exileBidBudget) return no(400, m.exileBidOverBudget(s.exileBidBudget))
  const { exileBidWindow } = await import('./survivorExileBids')
  const window = await exileBidWindow(league, now)
  if (!window) return no(409, m.exileBidsClosed)
  if (now.getTime() >= window.closesAt.getTime()) return no(409, m.exileBidsClosed)
  const team = args.team.trim().toUpperCase()
  if (!team || !window.openTeams.has(exileTeamKey(league.sport, team))) return no(400, m.exileBidTeamUnknown)
  return inSideGameLock(args.leagueId, async (db) => {
    const state = await loadSideGameState(db, args.leagueId)
    if (state.exileBids.get(window.week)?.resolved) return no(409, m.exileBidsClosed)
    await appendSideGameRow(db, state, {
      leagueId: args.leagueId, entity: sideGameEntity.exileBids(window.week), action: SIDE_GAME_ACTIONS.exileBid, week: window.week,
      key: `xbid:${args.userId}:${window.week}:${team}:${args.amount}:${now.toISOString()}`, actorUserId: args.userId, targetUserId: args.userId,
      data: { userId: args.userId, team, amount: args.amount, at: now.toISOString() },
    })
    return { ok: true as const, week: window.week, closesAt: window.closesAt.toISOString() }
  })
}

// ── Settings ───────────────────────────────────────────────────────────────────────────────────

export async function sideGameLockContext(leagueId: string): Promise<{ draftStarted: boolean; seasonStarted: boolean }> {
  const [draft, game] = await Promise.all([
    prisma.draftSession.findFirst({ where: { leagueId, status: { in: ['in_progress', 'paused', 'completed'] } }, select: { id: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true, phase: true } }),
  ])
  return { draftStarted: Boolean(draft), seasonStarted: (game?.currentWeek ?? 0) >= 1 && !['pre_draft', 'drafting'].includes(String(game?.phase ?? '')) }
}

export async function saveSurvivorSideGameSettings(leagueId: string, patch: unknown): Promise<{ ok: true; settings: SurvivorSideGameSettings; patch: Partial<SurvivorSideGameSettings>; locked: SurvivorSideGameKey[] } | { ok: false; status: 400 | 404 | 409; error: string; code: string }> {
  const league = await loadSideGameLeague(prisma, leagueId)
  if (!league) return { ok: false, status: 404, error: 'Not a Survivor league.', code: 'not_found' }
  const locked = lockedSideGameKeys(await sideGameLockContext(leagueId))
  const result = validateSurvivorSideGamePatch(league.sideGames, patch, locked)
  if (!result.ok) return { ok: false, status: result.code === 'locked' ? 409 : 400, error: result.error, code: result.code }
  await prisma.league.update({ where: { id: leagueId }, data: { settings: mergeSurvivorSideGamesIntoSettings(league.settings, result.settings) as object } })
  return { ok: true, settings: result.settings, patch: result.patch, locked }
}

// ── Views ──────────────────────────────────────────────────────────────────────────────────────

export interface SideGameGameView {
  key: string
  homeTeam: string
  awayTeam: string
  homeKey: string
  awayKey: string
  startTime: string | null
  open: boolean
  final: boolean
  homeScore: number | null
  awayScore: number | null
}

export interface SurvivorSideGameManagerView {
  week: number
  sport: string
  role: 'active' | 'exile' | 'out'
  settings: Pick<SurvivorSideGameSettings, 'tokenPoolEnabled' | 'tokenPoolOpen' | 'tokenPoolMode' | 'tokenPoolWrongPick' | 'tokenPoolPicksPerWeek' | 'tokenShopEnabled' | 'survivorPoolEnabled' | 'survivorPoolStartWeek' | 'survivorPoolRevives' | 'survivorPoolPrize' | 'exileClaimMode' | 'exileBidBudget' | 'exileTokenFaabRate' | 'exileTokenFaabBasis' | 'auctionCurrency'>
  poolRule: ReturnType<typeof survivorPoolRuleForWeek>
  games: SideGameGameView[]
  tokens: number
  tokenPool: { pot: number; picks: Array<{ week: number; gameKey: string; teamKey: string; outcome: string | null }> }
  pool: { entry: PoolEntryState; revivesLeft: number; banned: boolean; pick: { gameKey: string; teamKey: string; outcome: string | null } | null }
  shop: Array<{ id: string; kind: string; cost: number; amount: number; powerType: string }>
  purchases: Array<{ purchaseId: string; itemId: string; status: string; at: string }>
  auctions: Array<{
    auctionId: string; label: string; mode: 'sealed' | 'open'; currency: string; opensAt: string; closesAt: string; status: string; takingBids: boolean
    items: Array<{ itemId: string; label: string; blind: boolean; prizeKind: string | null; myBid: number | null; highBid: number | null; won: boolean }>
  }>
  balances: { faab: number | null; auctionCash: number }
  exileBid: { week: number; closesAt: string; myBid: { team: string; amount: number } | null; openTeams: string[]; awarded: string | null } | null
}

/** Everything one castaway may see — their own picks, bids, balances; never anyone else's. */
export async function loadSurvivorSideGameView(leagueId: string, userId: string, now = new Date()): Promise<SurvivorSideGameManagerView | null> {
  const league = await loadSideGameLeague(prisma, leagueId)
  if (!league) return null
  const me = await loadCastaway(prisma, leagueId, userId)
  if (!me) return null
  const { week } = await currentSurvivorWeek(prisma, leagueId)
  const s = league.sideGames
  const [state, games] = await Promise.all([loadSideGameState(prisma, leagueId), week > 0 ? loadSideGameWeekGames(prisma, league.sport, league.season, week) : Promise.resolve([])])
  const tp = state.tokenPool.get(userId)
  const pool = state.pool.get(userId)
  const entry = pool?.entry ?? EMPTY_POOL_ENTRY
  const poolPick = pool?.picks.filter((p) => p.week === week).at(-1) ?? null
  const faab = me.rosterId ? await readSurvivorFaabBalance(prisma, leagueId, me.rosterId) : null
  let exileBid: SurvivorSideGameManagerView['exileBid'] = null
  if (s.exileClaimMode === 'faab_bid' && me.playerState === 'exile') {
    const { exileBidWindow } = await import('./survivorExileBids')
    const window = await exileBidWindow(league, now).catch(() => null)
    if (window) {
      const wk = state.exileBids.get(window.week)
      const mine = wk?.bids.find((b) => b.userId === userId) ?? null
      exileBid = {
        week: window.week, closesAt: window.closesAt.toISOString(), myBid: mine ? { team: mine.team, amount: mine.amount } : null,
        openTeams: [...window.openTeams].sort(), awarded: wk?.resolved?.find((a) => a.userId === userId)?.team ?? null,
      }
    }
  }
  return {
    week,
    sport: league.sport,
    role: me.playerState === 'active' ? 'active' : me.playerState === 'exile' ? 'exile' : 'out',
    settings: {
      tokenPoolEnabled: s.tokenPoolEnabled, tokenPoolOpen: s.tokenPoolOpen, tokenPoolMode: s.tokenPoolMode, tokenPoolWrongPick: s.tokenPoolWrongPick,
      tokenPoolPicksPerWeek: s.tokenPoolPicksPerWeek, tokenShopEnabled: s.tokenShopEnabled, survivorPoolEnabled: s.survivorPoolEnabled,
      survivorPoolStartWeek: s.survivorPoolStartWeek, survivorPoolRevives: s.survivorPoolRevives, survivorPoolPrize: s.survivorPoolPrize,
      exileClaimMode: s.exileClaimMode, exileBidBudget: s.exileBidBudget, exileTokenFaabRate: s.exileTokenFaabRate, exileTokenFaabBasis: s.exileTokenFaabBasis,
      auctionCurrency: s.auctionCurrency,
    },
    poolRule: survivorPoolRuleForWeek(s, week),
    games: games.map((g) => ({
      key: g.key, homeTeam: g.homeTeam, awayTeam: g.awayTeam, homeKey: g.homeKey, awayKey: g.awayKey, startTime: g.startTime?.toISOString() ?? null,
      open: sideGamePickOpen(g, now), final: g.final, homeScore: g.homeScore, awayScore: g.awayScore,
    })),
    tokens: me.tokenBalance,
    tokenPool: { pot: tp?.pot ?? 0, picks: (tp?.picks ?? []).filter((p) => p.week >= week - 1).map((p) => ({ week: p.week, gameKey: p.gameKey, teamKey: p.teamKey, outcome: p.outcome })) },
    pool: { entry, revivesLeft: poolRevivesLeft(entry, s.survivorPoolRevives), banned: poolBanned(entry, s.survivorPoolRevives), pick: poolPick ? { gameKey: poolPick.gameKey, teamKey: poolPick.teamKey, outcome: poolPick.outcome } : null },
    shop: s.tokenShopEnabled ? s.tokenShopItems.filter((i) => i.enabled).map((i) => ({ id: i.id, kind: i.kind, cost: i.cost, amount: i.amount, powerType: i.powerType })) : [],
    purchases: state.purchases.filter((p) => p.userId === userId).map((p) => ({ purchaseId: p.purchaseId, itemId: p.itemId, status: p.status, at: p.at })),
    auctions: [...state.auctions.values()]
      .filter((a) => a.status !== 'cancelled' && Date.now() - new Date(a.closesAt).getTime() < 8 * 86_400_000)
      .map((a) => {
        const visible = visibleAuctionItems(a, league.language)
        return {
          auctionId: a.auctionId, label: a.label, mode: a.mode, currency: a.currency, opensAt: a.opensAt, closesAt: a.closesAt, status: a.status,
          takingBids: auctionTakingBids(a, now),
          items: visible.map((i) => ({
            ...i,
            myBid: a.bids.find((b) => b.itemId === i.itemId && b.rosterId === me.rosterId)?.amount ?? null,
            // A sealed auction never shows the high bid, even after it closes: only who won.
            highBid: a.mode === 'open' ? highBid(i.itemId, a.bids)?.amount ?? null : null,
            won: a.awards.some((w) => w.itemId === i.itemId && w.rosterId === me.rosterId),
          })),
        }
      }),
    balances: { faab: faab == null ? null : Math.floor(faab), auctionCash: auctionCashOf(state, me.rosterId) },
    exileBid,
  }
}

export interface SurvivorSideGameAdminView {
  settings: SurvivorSideGameSettings
  locked: SurvivorSideGameKey[]
  week: number
  sport: string
  games: SideGameGameView[]
  openPicks: Array<{ game: 'token_pool' | 'pool'; gameKey: string; count: number }>
  pool: Array<{ userId: string; displayName: string; alive: boolean; revivesLeft: number; banned: boolean; wins: number; picked: boolean }>
  auctions: Array<AuctionRecord & { bidCount: number }>
  pendingPurchases: number
  castaways: Array<{ userId: string; displayName: string; rosterId: string | null; playerState: string; auctionCash: number }>
}

/** The Commissioner Hub view: every side game's state. Bids are shown to the commissioner only. */
export async function loadSurvivorSideGameAdminView(leagueId: string): Promise<SurvivorSideGameAdminView | null> {
  const league = await loadSideGameLeague(prisma, leagueId)
  if (!league) return null
  const { week } = await currentSurvivorWeek(prisma, leagueId)
  const [state, games, castaways, lockCtx] = await Promise.all([
    loadSideGameState(prisma, leagueId),
    week > 0 ? loadSideGameWeekGames(prisma, league.sport, league.season, week) : Promise.resolve([]),
    loadCastaways(prisma, leagueId),
    sideGameLockContext(leagueId),
  ])
  const s = league.sideGames
  const open = new Map<string, number>()
  for (const tp of state.tokenPool.values()) for (const p of tp.picks) if (p.week === week && p.outcome == null) open.set(`token_pool|${p.gameKey}`, (open.get(`token_pool|${p.gameKey}`) ?? 0) + 1)
  for (const st of state.pool.values()) for (const p of st.picks) if (p.week === week && p.outcome == null) open.set(`pool|${p.gameKey}`, (open.get(`pool|${p.gameKey}`) ?? 0) + 1)
  return {
    settings: s,
    locked: lockedSideGameKeys(lockCtx),
    week,
    sport: league.sport,
    games: games.map((g) => ({ key: g.key, homeTeam: g.homeTeam, awayTeam: g.awayTeam, homeKey: g.homeKey, awayKey: g.awayKey, startTime: g.startTime?.toISOString() ?? null, open: sideGamePickOpen(g, new Date()), final: g.final, homeScore: g.homeScore, awayScore: g.awayScore })),
    openPicks: [...open].map(([k, count]) => ({ game: k.split('|')[0] as 'token_pool' | 'pool', gameKey: k.split('|')[1], count })),
    pool: castaways.filter((c) => state.pool.has(c.userId) || c.playerState === 'active').map((c) => {
      const entry = state.pool.get(c.userId)?.entry ?? EMPTY_POOL_ENTRY
      return { userId: c.userId, displayName: c.displayName, alive: entry.alive, revivesLeft: poolRevivesLeft(entry, s.survivorPoolRevives), banned: poolBanned(entry, s.survivorPoolRevives), wins: entry.wins, picked: Boolean(state.pool.get(c.userId)?.picks.some((p) => p.week === week)) }
    }),
    auctions: [...state.auctions.values()].map((a) => ({ ...a, bidCount: a.bids.length })),
    pendingPurchases: state.purchases.filter((p) => p.status === 'pending').length,
    castaways: castaways.map((c) => ({ userId: c.userId, displayName: c.displayName, rosterId: c.rosterId, playerState: c.playerState, auctionCash: auctionCashOf(state, c.rosterId) })),
  }
}

export type { SideGameState }

// ── Chimmy grounding and the weekly report ─────────────────────────────────────────────────────

/** Chimmy's side-game grounding for one manager: every rule, and that manager's OWN balances only. */
export async function loadSideGameGroundingLine(leagueId: string, userId: string, now = new Date()): Promise<string> {
  const { sideGameGroundingLine } = await import('./survivorSideGameSummary')
  const { easternWhen } = await import('./survivorSideGameCopy')
  const view = await loadSurvivorSideGameView(leagueId, userId, now)
  const league = await loadSideGameLeague(prisma, leagueId)
  if (!view || !league) return ''
  return sideGameGroundingLine({
    settings: league.sideGames,
    sport: league.sport,
    week: view.week,
    me: {
      state: view.role,
      tokens: view.tokens,
      pot: view.tokenPool.pot,
      tokenPoolPicksThisWeek: view.tokenPool.picks.filter((p) => p.week === view.week).length,
      faab: view.balances.faab,
      auctionCash: view.balances.auctionCash,
      poolAlive: view.pool.entry.alive,
      poolRevivesLeft: view.pool.revivesLeft,
      poolBanned: view.pool.banned,
      poolPickedThisWeek: Boolean(view.pool.pick),
      pendingPurchases: view.purchases.filter((p) => p.status === 'pending').length,
    },
    openAuctions: view.auctions.filter((a) => a.takingBids).map((a) => ({
      label: a.label, closesAt: easternWhen(new Date(a.closesAt), 'en'), currency: a.currency, mode: a.mode, myBids: a.items.filter((i) => i.myBid != null).length,
    })),
    exileBidClosesAt: view.exileBid ? easternWhen(new Date(view.exileBid.closesAt), 'en') : null,
  })
}

/** Counts for the commissioner's weekly report line, plus what Chimmy itself did per seat. */
export async function loadSideGameReportData(leagueId: string, week: number, now = new Date()): Promise<{
  input: SideGameReportInput
  chimmy: Map<string, { tokenPoolPicks: number; poolPicked: boolean; auctionBids: number }>
} | null> {
  const league = await loadSideGameLeague(prisma, leagueId)
  if (!league) return null
  const s = league.sideGames
  const [state, castaways] = await Promise.all([loadSideGameState(prisma, leagueId), loadCastaways(prisma, leagueId)])
  let tokenPoolSettledThisWeek = 0
  for (const tp of state.tokenPool.values()) tokenPoolSettledThisWeek += tp.picks.filter((p) => p.week === week && p.outcome != null).length
  let poolAlive = 0
  let poolOut = 0
  let poolBannedCount = 0
  for (const c of castaways) {
    const entry = state.pool.get(c.userId)?.entry
    if (!entry && c.playerState !== 'active') continue
    const e = entry ?? EMPTY_POOL_ENTRY
    if (poolBanned(e, s.survivorPoolRevives)) poolBannedCount++
    else if (e.alive) poolAlive++
    else poolOut++
  }
  const chimmy = new Map<string, { tokenPoolPicks: number; poolPicked: boolean; auctionBids: number }>()
  for (const c of castaways.filter((x) => x.userId.startsWith('orphan-'))) {
    chimmy.set(c.userId, {
      tokenPoolPicks: state.tokenPool.get(c.userId)?.picks.filter((p) => p.week === week).length ?? 0,
      poolPicked: Boolean(state.pool.get(c.userId)?.picks.some((p) => p.week === week)),
      auctionBids: [...state.auctions.values()].filter((a) => a.week === week).reduce((n, a) => n + a.bids.filter((b) => b.rosterId === c.rosterId).length, 0),
    })
  }
  return {
    input: {
      tokenPoolSettledThisWeek,
      poolAlive,
      poolOut,
      poolBanned: poolBannedCount,
      openAuctions: [...state.auctions.values()].filter((a) => auctionTakingBids(a, now)).map((a) => ({ label: a.label, bids: a.bids.length })),
      pendingPurchases: state.purchases.filter((p) => p.status === 'pending').length,
      enabled: { tokenPool: s.tokenPoolEnabled, pool: s.survivorPoolEnabled },
    },
    chimmy,
  }
}
