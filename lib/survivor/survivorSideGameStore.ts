import 'server-only'

/**
 * Side games — the store: the ledger read/write, the league context, our stored game finals, token
 * balances, auction cash and the FAAB charge an auction makes. Everything here is DB-only (reads
 * `SportsGame`, never a provider) and every write is idempotent by key.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeGameStatus } from '@/lib/scores/gameScoreProviders'
import { isSurvivorPlanSport, planWeekWindow } from './survivorPlanCalendar'
import { readSurvivorSideGameSettings, type SideGamePrize, type SurvivorSideGameSettings } from './survivorSideGameSettings'
import { foldSideGameRows, teamGroupsFromRows, type SideGameGame, type SideGameRawGame, type TeamGroups } from './survivorSideGameRules'
import { foldSideGameLedger, SIDE_GAME_CATEGORY, SIDE_GAME_ENTITY, sideGameEntity, SIDE_GAME_ACTIONS, type SideGameState } from './survivorSideGameLedger'
import { applySurvivorReward, type SurvivorRewardSpec } from './SurvivorEffectEngine'
import { readSurvivorFaabBalance } from './survivorRewardEngine'
import type { SurvivorRewardSourceKind } from './survivorRewardModel'

export type Db = Prisma.TransactionClient | PrismaClient

export interface SideGameLeague {
  id: string
  sport: string
  season: number
  language: string | null
  settings: unknown
  platform: string | null
  userId: string | null
  survivorTokenCap: number | null
  sideGames: SurvivorSideGameSettings
}

export async function loadSideGameLeague(db: Db, leagueId: string): Promise<SideGameLeague | null> {
  const row = await db.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, season: true, language: true, settings: true, platform: true, userId: true, survivorMode: true, survivorTokenCap: true, survivorExileHarshTokenLoss: true },
  })
  if (!row?.survivorMode) return null
  return {
    id: row.id,
    sport: String(row.sport ?? 'NFL').toUpperCase(),
    season: row.season ?? new Date().getUTCFullYear(),
    language: row.language ?? null,
    settings: row.settings,
    platform: row.platform ?? null,
    userId: row.userId ?? null,
    survivorTokenCap: row.survivorTokenCap ?? null,
    sideGames: readSurvivorSideGameSettings(row.settings, { harshTokenLoss: row.survivorExileHarshTokenLoss }),
  }
}

export async function currentSurvivorWeek(db: Db, leagueId: string): Promise<{ week: number; phase: string | null }> {
  const game = await db.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true, phase: true } })
  return { week: Math.max(0, game?.currentWeek ?? 0), phase: game?.phase ?? null }
}

/** One transaction under the league's side-game lock: two runner ticks or two clicks cannot interleave. */
export async function inSideGameLock<T>(leagueId: string, work: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-side-game:${leagueId}`}, 0))::text`
      return work(db)
    },
    { timeout: 30_000, maxWait: 10_000 },
  )
}

export async function loadSideGameState(db: Db, leagueId: string): Promise<SideGameState> {
  const rows = await db.survivorAuditEntry.findMany({
    where: { leagueId, relatedEntityType: SIDE_GAME_ENTITY },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { action: true, relatedEntityId: true, week: true, data: true, createdAt: true },
  })
  return foldSideGameLedger(rows)
}

/** Append one ledger row. Returns false (and writes nothing) when its key was already written. */
export async function appendSideGameRow(
  db: Db,
  state: SideGameState | null,
  args: { leagueId: string; entity: string; action: string; week: number | null; key: string; data: Record<string, unknown>; actorUserId?: string | null; targetUserId?: string | null },
): Promise<boolean> {
  if (state?.keys.has(args.key)) return false
  if (!state) {
    const dup = await db.survivorAuditEntry.findFirst({ where: { leagueId: args.leagueId, relatedEntityType: SIDE_GAME_ENTITY, data: { path: ['key'], equals: args.key } }, select: { id: true } })
    if (dup) return false
  }
  await db.survivorAuditEntry.create({
    data: {
      leagueId: args.leagueId,
      week: args.week,
      category: SIDE_GAME_CATEGORY,
      action: args.action,
      actorUserId: args.actorUserId ?? null,
      targetUserId: args.targetUserId ?? null,
      relatedEntityId: args.entity,
      relatedEntityType: SIDE_GAME_ENTITY,
      data: { ...args.data, key: args.key, at: typeof args.data.at === 'string' ? args.data.at : new Date().toISOString() } as Prisma.InputJsonValue,
      isVisibleToCommissioner: true,
      // Picks, bids and balances are private game state; the season-end reveal may show them.
      isVisibleToPublic: false,
      isRevealablePostSeason: true,
    },
  })
  state?.keys.add(args.key)
  return true
}

// ── Games ──────────────────────────────────────────────────────────────────────────────────────

/**
 * A week's games from OUR `SportsGame` table — never a provider. Football weeks are keyed on
 * `week`; daily sports have no week column, so the Survivor plan's own window is used.
 */
export async function loadSideGameWeekGames(db: Db, sport: string, season: number, week: number): Promise<SideGameGame[]> {
  const select = { homeTeam: true, awayTeam: true, startTime: true, status: true, homeScore: true, awayScore: true, seasonType: true } as const
  let rows = await db.sportsGame.findMany({ where: { sport, season, week, OR: [{ seasonType: 'regular' }, { seasonType: null }] }, select })
  if (!rows.length && isSurvivorPlanSport(sport)) {
    const window = planWeekWindow(sport, season, week)
    if (window) rows = await db.sportsGame.findMany({ where: { sport, startTime: { gte: window.start, lt: window.end }, OR: [{ seasonType: 'regular' }, { seasonType: null }] }, select })
  }
  return foldSideGameRows(sport, rows.map(toRaw))
}

/** Every stored final this season before `week` (Chimmy's records). */
export async function loadSideGameSeasonGames(db: Db, sport: string, season: number, beforeWeek: number): Promise<SideGameGame[]> {
  const rows = await db.sportsGame.findMany({
    where: { sport, season, week: { lt: beforeWeek, gte: 1 }, OR: [{ seasonType: 'regular' }, { seasonType: null }] },
    select: { homeTeam: true, awayTeam: true, startTime: true, status: true, homeScore: true, awayScore: true },
    take: 2000,
  })
  return foldSideGameRows(sport, rows.map(toRaw))
}

function toRaw(r: { homeTeam: string; awayTeam: string; startTime: Date | null; status: string | null; homeScore: number | null; awayScore: number | null }): SideGameRawGame {
  return { homeTeam: r.homeTeam, awayTeam: r.awayTeam, startTime: r.startTime, final: normalizeGameStatus(r.status) === 'final', homeScore: r.homeScore, awayScore: r.awayScore }
}

// ── Castaways ──────────────────────────────────────────────────────────────────────────────────

export interface SideGameCastaway {
  userId: string
  displayName: string
  playerState: string
  rosterId: string | null
  tokenBalance: number
}

export async function loadCastaway(db: Db, leagueId: string, userId: string): Promise<SideGameCastaway | null> {
  const p = await db.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { userId: true, displayName: true, playerState: true, redraftRosterId: true, tokenBalance: true } })
  return p ? { userId: p.userId, displayName: p.displayName, playerState: p.playerState, rosterId: p.redraftRosterId ?? null, tokenBalance: p.tokenBalance } : null
}

export async function loadCastaways(db: Db, leagueId: string): Promise<SideGameCastaway[]> {
  const rows = await db.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true, displayName: true, playerState: true, redraftRosterId: true, tokenBalance: true } })
  return rows.map((p) => ({ userId: p.userId, displayName: p.displayName, playerState: p.playerState, rosterId: p.redraftRosterId ?? null, tokenBalance: p.tokenBalance }))
}

/**
 * Move an Exile token balance inside the caller's transaction — floor 0, the league cap respected —
 * and write the same `token` audit row `applyExileTokenDelta` writes, so the token history reads as one.
 */
export async function adjustSideGameTokens(db: Db, args: { leagueId: string; userId: string; week: number; delta: number; cap: number | null; source: string }): Promise<{ applied: number; balance: number }> {
  const player = await db.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId: args.leagueId, userId: args.userId } }, select: { id: true, tokenBalance: true } })
  if (!player || !args.delta) return { applied: 0, balance: player?.tokenBalance ?? 0 }
  let next = Math.max(0, player.tokenBalance + args.delta)
  if (args.cap != null && args.cap >= 0 && next > args.cap && args.delta > 0) next = Math.max(player.tokenBalance, args.cap)
  const applied = next - player.tokenBalance
  if (!applied) return { applied: 0, balance: player.tokenBalance }
  await db.survivorPlayer.update({ where: { id: player.id }, data: { tokenBalance: next, ...(applied > 0 ? { totalTokensEarned: { increment: applied } } : {}) } })
  await db.survivorAuditEntry.create({
    data: {
      leagueId: args.leagueId, week: args.week, category: 'token', action: applied > 0 ? 'TOKEN_EARNED' : 'TOKEN_LOST', targetUserId: args.userId,
      data: { userId: args.userId, amount: Math.abs(applied), signedDelta: applied, source: args.source, week: args.week, newBalance: next } as Prisma.InputJsonValue,
      isVisibleToCommissioner: true, isVisibleToPublic: false,
    },
  })
  return { applied, balance: next }
}

// ── Currencies ─────────────────────────────────────────────────────────────────────────────────

export function auctionCashOf(state: SideGameState, rosterId: string | null): number {
  return rosterId ? state.cash.get(rosterId) ?? 0 : 0
}

/** The balance a bid is measured against: FAAB (what waivers spend) or auction cash. */
export async function bidBalance(db: Db, state: SideGameState, leagueId: string, currency: 'faab' | 'auction_cash', rosterId: string | null): Promise<number> {
  if (!rosterId) return 0
  if (currency === 'auction_cash') return auctionCashOf(state, rosterId)
  return Math.max(0, Math.floor((await readSurvivorFaabBalance(db, leagueId, rosterId)) ?? 0))
}

/**
 * Charge FAAB for an auction win. Runs under the REWARD lock (`survivor-reward:<league>`) so it can
 * never interleave with a reward paying or reversing FAAB on the same roster, and records itself in
 * the side-game ledger in the same transaction, so a retry charges once. Never below 0.
 */
export async function chargeSideGameFaab(args: { leagueId: string; rosterId: string; amount: number; key: string; week: number; reason: string }): Promise<number> {
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-reward:${args.leagueId}`}, 0))::text`
    const dup = await db.survivorAuditEntry.findFirst({ where: { leagueId: args.leagueId, relatedEntityType: SIDE_GAME_ENTITY, data: { path: ['key'], equals: args.key } }, select: { data: true } })
    if (dup) return Number((dup.data as Record<string, unknown>)?.amount ?? 0)
    const roster = await db.roster.findFirst({ where: { id: args.rosterId, leagueId: args.leagueId }, select: { id: true, redraftRosterId: true, faabRemaining: true } })
    const redraft = roster?.redraftRosterId ? await db.redraftRoster.findFirst({ where: { id: roster.redraftRosterId, leagueId: args.leagueId }, select: { id: true, faabBalance: true } }) : null
    const balance = redraft?.faabBalance ?? roster?.faabRemaining ?? 0
    const take = Math.max(0, Math.min(Math.floor(args.amount), Math.floor(balance)))
    if (take && redraft && redraft.faabBalance != null) await db.redraftRoster.update({ where: { id: redraft.id }, data: { faabBalance: Math.max(0, redraft.faabBalance - take) } })
    if (take && roster && roster.faabRemaining != null) await db.roster.update({ where: { id: roster.id }, data: { faabRemaining: Math.max(0, Math.round(roster.faabRemaining - take)) } })
    await appendSideGameRow(db, null, {
      leagueId: args.leagueId, entity: sideGameEntity.cash(args.rosterId), action: 'faab_charge', week: args.week, key: args.key,
      data: { amount: take, requested: args.amount, reason: args.reason },
    })
    return take
  }, { timeout: 30_000, maxWait: 10_000 })
}

/**
 * Give back an auction's FAAB charge — exactly what the charge row says was TAKEN (never what was
 * bid), under the same reward lock and in one transaction with its ledger row, so a retry refunds
 * once. Returns the amount refunded (0 when nothing was charged or it was refunded already).
 */
export async function refundSideGameFaab(args: { leagueId: string; rosterId: string; chargeKey: string; key: string; week: number; reason: string; refundOf: string }): Promise<number> {
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-reward:${args.leagueId}`}, 0))::text`
    const dup = await db.survivorAuditEntry.findFirst({ where: { leagueId: args.leagueId, relatedEntityType: SIDE_GAME_ENTITY, data: { path: ['key'], equals: args.key } }, select: { data: true } })
    if (dup) return 0
    const charge = await db.survivorAuditEntry.findFirst({ where: { leagueId: args.leagueId, relatedEntityType: SIDE_GAME_ENTITY, data: { path: ['key'], equals: args.chargeKey } }, select: { data: true } })
    const taken = Math.max(0, Math.floor(Number((charge?.data as Record<string, unknown> | undefined)?.amount ?? 0)))
    if (taken) {
      const roster = await db.roster.findFirst({ where: { id: args.rosterId, leagueId: args.leagueId }, select: { id: true, redraftRosterId: true, faabRemaining: true } })
      const redraft = roster?.redraftRosterId ? await db.redraftRoster.findFirst({ where: { id: roster.redraftRosterId, leagueId: args.leagueId }, select: { id: true, faabBalance: true } }) : null
      if (redraft && redraft.faabBalance != null) await db.redraftRoster.update({ where: { id: redraft.id }, data: { faabBalance: redraft.faabBalance + taken } })
      if (roster && roster.faabRemaining != null) await db.roster.update({ where: { id: roster.id }, data: { faabRemaining: Math.round(roster.faabRemaining + taken) } })
    }
    await appendSideGameRow(db, null, {
      leagueId: args.leagueId, entity: sideGameEntity.cash(args.rosterId), action: SIDE_GAME_ACTIONS.auctionRefund, week: args.week, key: args.key,
      data: { amount: taken, currency: 'faab', chargeKey: args.chargeKey, reason: args.reason, refundOf: args.refundOf },
    })
    return taken
  }, { timeout: 30_000, maxWait: 10_000 })
}

// ── Team groups (conferences and divisions) ────────────────────────────────────────────────────

/**
 * A sport's conferences and divisions from OUR `SportsTeam` table — never a provider. Every sport we
 * support stores teams there; the NFL also has its groups built into the rules.
 */
export async function loadSideGameTeamGroups(db: Db, sport: string): Promise<TeamGroups> {
  const rows = await db.sportsTeam.findMany({
    where: { sport, OR: [{ conference: { not: null } }, { division: { not: null } }] },
    select: { name: true, shortName: true, city: true, conference: true, division: true },
    take: 2000,
  })
  return teamGroupsFromRows(sport, rows)
}

// ── Prizes ─────────────────────────────────────────────────────────────────────────────────────

export function prizeRewardSpec(prize: SideGamePrize, rosterId: string, targetWeek: number | null): SurvivorRewardSpec | null {
  switch (prize.kind) {
    case 'faab': return prize.amount > 0 ? { type: 'faab_grant', rosterId, amount: prize.amount } : null
    case 'score_bonus': return prize.amount > 0 ? { type: 'score_bonus', rosterId, points: prize.amount, targetWeek } : null
    case 'advantage': return { type: 'advantage', rosterId, powerType: prize.powerType }
    case 'free_trade_token': return { type: 'free_trade_token', rosterId, samePositionOnly: prize.samePositionOnly }
    case 'steal_blocker': return { type: 'steal_blocker', rosterId }
    // Disadvantages wait for the winner's choice of opponent (the reward API's choice flow).
    case 'opponent_penalty': return prize.amount > 0 ? { type: 'opponent_penalty', chooserRosterId: rosterId, points: prize.amount, targetWeek } : null
    case 'vote_taken': return { type: 'vote_taken', chooserRosterId: rosterId }
    default: return null
  }
}

/**
 * `permanent`: the reward API REFUSED the prize (the winner is no longer an active castaway, the
 * spec no longer applies) — retrying cannot pay it. Otherwise the failure was transient (a DB error)
 * and the runner retries it on its next tick.
 */
export type PrizePayment = { ok: true; via: 'reward' | 'auction_cash' | 'tokens' | 'none'; rewardId: string | null } | { ok: false; error: string; permanent?: boolean }

/**
 * Pay a side-game prize: a reward-API prize through `applySurvivorReward` (idempotent on `key`), or
 * an auction-cash / token prize into the side-game ledger. Never throws.
 */
export async function paySideGamePrize(args: {
  leagueId: string
  prize: SideGamePrize
  rosterId: string | null
  userId: string
  key: string
  week: number
  targetWeek: number | null
  source: { kind: SurvivorRewardSourceKind; id: string; label: string }
  tokenCap: number | null
}): Promise<PrizePayment> {
  try {
    if (args.prize.kind === 'none') return { ok: true, via: 'none', rewardId: null }
    if (args.prize.kind === 'auction_cash' || args.prize.kind === 'tokens') {
      if (args.prize.amount < 1) return { ok: true, via: 'none', rewardId: null }
      await inSideGameLock(args.leagueId, async (db) => {
        const state = await loadSideGameState(db, args.leagueId)
        if (state.keys.has(args.key)) return
        if (args.prize.kind === 'auction_cash') {
          if (!args.rosterId) return
          await appendSideGameRow(db, state, { leagueId: args.leagueId, entity: sideGameEntity.cash(args.rosterId), action: SIDE_GAME_ACTIONS.cashCredit, week: args.week, key: args.key, data: { amount: args.prize.amount, reason: args.source.label } })
        } else {
          await adjustSideGameTokens(db, { leagueId: args.leagueId, userId: args.userId, week: args.week, delta: args.prize.amount, cap: args.tokenCap, source: args.source.kind })
          await appendSideGameRow(db, state, { leagueId: args.leagueId, entity: sideGameEntity.tokenPool(args.userId), action: 'token_prize', week: args.week, key: args.key, data: { amount: args.prize.amount, reason: args.source.label } })
        }
      })
      return { ok: true, via: args.prize.kind, rewardId: null }
    }
    if (!args.rosterId) return { ok: false, error: 'no_roster', permanent: true }
    const spec = prizeRewardSpec(args.prize, args.rosterId, args.targetWeek)
    if (!spec) return { ok: true, via: 'none', rewardId: null }
    const result = await applySurvivorReward({ leagueId: args.leagueId, idempotencyKey: args.key, source: args.source, week: args.week, reward: spec })
    return result.ok ? { ok: true, via: 'reward', rewardId: result.rewardId } : { ok: false, error: result.error, permanent: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
