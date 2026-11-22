import type { PrismaClient } from '@prisma/client'

import type { LeagueValueAdjustment } from '@/lib/trade-value/leagueTradeValue'
import { parsePickLabel } from '@/lib/parsePickLabel'
import { NEED_MARKET_CACHE_KEY, PICK_MARKET_CACHE_KEY, POSTURE_MARKET_CACHE_KEY } from './formatMarkets'
import { equivalentRoundBucket, nextDraftYear, type PickClassKey } from './pickMarketLearner'
import type { NeedLevel, NeedPosition } from './needMarketLearner'
import type { AssetKind, Posture } from './postureMarketLearner'
import { booksNotHeld, HOLDOUT_CACHE_KEY, holdoutRowsOf } from './holdoutCheck'

/**
 * THE LEARNED TABLES IN THE GRADES — EACH BEHIND ITS OWN SWITCH, ALL OFF (owner's call, 2026-11-22: "switching them on
 * is a separate decision, made on what the daily runs show").
 *
 * The daily market run stores three shadow tables: pick values (`pickMarketLearner.ts`), contend/rebuild premiums
 * (`postureMarketLearner.ts`) and need premiums (`needMarketLearner.ts`). This reads them and turns a PUBLISHED entry
 * into a visible per-line adjustment; nothing unpublished, stale or switched off changes a grade:
 *
 *   TRADE_LEARNED_PICKS=on    a pick line is priced at its class's learned value instead of the curve's (league-value
 *                             grade — what the pick is worth in this market, to anyone).
 *   TRADE_LEARNED_NEED=on     the "for your team" premium for a position you cannot fill is the measured one for teams
 *                             short there, in place of the hand-set 6% per open slot.
 *   TRADE_LEARNED_POSTURE=on  on the "for your team" letter, what you take on is moved by what teams with your record pay
 *                             for that kind of asset (veterans, youth, picks) over middle teams.
 *
 * ⚠ The posture and need moves are about THE VIEWER'S team, so they belong to the your-team letter, never the
 * league-value one: a deal's market value is the same for everyone.
 */

export const LEARNED_PICKS_ENV = 'TRADE_LEARNED_PICKS'
export const LEARNED_NEED_ENV = 'TRADE_LEARNED_NEED'
export const LEARNED_POSTURE_ENV = 'TRADE_LEARNED_POSTURE'

const on = (env: NodeJS.ProcessEnv, key: string) => String(env[key] ?? '').trim().toLowerCase() === 'on'
export const learnedPicksOn = (env: NodeJS.ProcessEnv = process.env) => on(env, LEARNED_PICKS_ENV)
export const learnedNeedOn = (env: NodeJS.ProcessEnv = process.env) => on(env, LEARNED_NEED_ENV)
export const learnedPostureOn = (env: NodeJS.ProcessEnv = process.env) => on(env, LEARNED_POSTURE_ENV)

/** A stored table older than this is not a market (the same horizon the player market is trusted for). */
const LEARNED_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000

type PickClassRow = { key: PickClassKey; published: boolean; value: number; prior: number; trades: number }
type PremiumRow = { published: boolean; premiumPct: number | null; trades: number }
export type LearnedTables = {
  picks: Map<string, PickClassRow[]>
  need: Map<string, Array<PremiumRow & { position: NeedPosition; need: Exclude<NeedLevel, 'normal'> }>>
  posture: Map<string, Array<PremiumRow & { buyer: Exclude<Posture, 'middle'>; bought: AssetKind }>>
}

/** Rows of one stored table by book, or an empty map when absent, stale or unreadable. PURE. */
export function booksOf<T>(raw: unknown, field: 'classes' | 'premiums', now: Date): Map<string, T[]> {
  const out = new Map<string, T[]>()
  const d = raw && typeof raw === 'object' ? (raw as { generatedAt?: unknown; books?: unknown }) : null
  const at = d && typeof d.generatedAt === 'string' ? Date.parse(d.generatedAt) : NaN
  if (!d || !Number.isFinite(at) || now.getTime() - at > LEARNED_MAX_AGE_MS || !Array.isArray(d.books)) return out
  for (const b of d.books as Array<Record<string, unknown>>) {
    if (typeof b.book === 'string' && Array.isArray(b[field])) out.set(b.book, b[field] as T[])
  }
  return out
}

/**
 * Drop every book whose learner did NOT hold on later trades (`holdoutCheck.ts`). Only a stored `not_held` removes
 * anything — no verdict, a stale one or `unknown` leaves the tables exactly as read. PURE.
 */
export function withoutNotHeld(tables: LearnedTables, holdoutRaw: unknown, now: Date): LearnedTables {
  const rows = holdoutRowsOf(holdoutRaw, now)
  if (rows.length === 0) return tables
  const keep = <T,>(m: Map<string, T[]>, learner: 'picks' | 'posture' | 'need') => {
    const drop = booksNotHeld(rows, learner)
    return drop.size === 0 ? m : new Map([...m].filter(([book]) => !drop.has(book)))
  }
  return { picks: keep(tables.picks, 'picks'), posture: keep(tables.posture, 'posture'), need: keep(tables.need, 'need') }
}

type CacheDelegate = { sportsDataCache: { findUnique: (args: { where: { cacheKey: string } }) => PromiseLike<unknown> } }

let memo: { at: number; tables: LearnedTables } | null = null
const MEMO_MS = 10 * 60 * 1000

/** The three tables, read once per ten minutes per process. Empty (never throws) when unreadable. */
export async function loadLearnedTables(prisma: CacheDelegate, now = new Date()): Promise<LearnedTables> {
  if (memo && now.getTime() - memo.at < MEMO_MS) return memo.tables
  const read = async (key: string) => {
    const row = (await Promise.resolve(prisma.sportsDataCache.findUnique({ where: { cacheKey: key } })).catch(() => null)) as { data?: unknown } | null
    return row?.data ?? null
  }
  const [picks, posture, need, holdout] = await Promise.all([read(PICK_MARKET_CACHE_KEY), read(POSTURE_MARKET_CACHE_KEY), read(NEED_MARKET_CACHE_KEY), read(HOLDOUT_CACHE_KEY)])
  const tables = withoutNotHeld(
    {
      picks: booksOf<PickClassRow>(picks, 'classes', now),
      posture: booksOf(posture, 'premiums', now),
      need: booksOf(need, 'premiums', now),
    },
    holdout,
    now,
  )
  memo = { at: now.getTime(), tables }
  return tables
}

/** Test hook: forget the memo. */
export function resetLearnedTablesMemo(): void {
  memo = null
}

const pct = (p: number) => `${p > 0 ? '+' : ''}${Math.round(p * 10) / 10}%`

/**
 * A pick line's learned value as a multiplier on what it was priced at, or null. PURE.
 * The pick's class: its round as the 12-team round it equals in a league this size, and how many drafts away it is.
 */
export function learnedPickAdjustment(
  tables: LearnedTables,
  book: string,
  pickLabel: string,
  teams: number | null,
  now: Date,
): LeagueValueAdjustment | null {
  const parsed = parsePickLabel(pickLabel) as { year?: number | string; season?: number | string; round?: number | string } | null
  const season = Number(parsed?.year ?? parsed?.season)
  const round = Number(parsed?.round)
  if (!Number.isFinite(season) || !Number.isFinite(round) || round < 1) return null
  const horizon = season - nextDraftYear(now)
  if (horizon < 0) return null
  const key = `${equivalentRoundBucket(round, teams)}:${Math.min(2, horizon)}` as PickClassKey
  const row = tables.picks.get(book)?.find((c) => c.key === key)
  if (!row?.published || !(row.prior > 0) || !(row.value > 0)) return null
  const factor = row.value / row.prior
  if (Math.abs(factor - 1) < 0.005) return null
  return {
    kind: 'tradeMarket',
    factor,
    reason: `AllFantasy pick market ${pct((factor - 1) * 100)}: what managers paid for picks like this (${horizon === 0 ? 'next draft' : horizon === 1 ? 'the draft after' : 'two or more drafts out'}) across ${row.trades} completed trades, against the standard pick curve`,
  }
}

/** The measured premium, in percent, for a team at this need level at this position — published and positive only. PURE. */
export function learnedNeedPremium(tables: LearnedTables, book: string, position: string, level: 'short' | 'short_this_week'): { pct: number; trades: number } | null {
  const row = tables.need.get(book)?.find((p) => p.position === position.toUpperCase() && p.need === level)
  return row?.published && row.premiumPct != null && row.premiumPct > 0 ? { pct: row.premiumPct, trades: row.trades } : null
}

/**
 * What the TRADE market says a hole at each position is worth, as one sentence per position — for advice outside a
 * trade (a waiver pickup that fills the hole, 2026-11-22). Published, positive premiums only; EVIDENCE, never a
 * multiplier: nothing here moves a waiver score or a bid. PURE.
 */
export function tradeNeedEvidence(tables: LearnedTables, book: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of tables.need.get(book) ?? []) {
    if (row.need !== 'short' || !row.published || row.premiumPct == null || !(row.premiumPct > 0)) continue
    out[row.position] = `In trades, teams short at ${row.position} paid ${pct(row.premiumPct)} over normal-depth teams across ${row.trades} completed trades`
  }
  return out
}

/** What teams with this record pay for this kind of asset over middle teams, as an adjustment — published only. PURE. */
export function learnedPostureAdjustment(
  tables: LearnedTables,
  book: string,
  posture: Posture | null,
  kind: AssetKind | null,
): LeagueValueAdjustment | null {
  if (!posture || posture === 'middle' || !kind) return null
  const row = tables.posture.get(book)?.find((p) => p.buyer === posture && p.bought === kind)
  if (!row?.published || row.premiumPct == null || row.premiumPct === 0) return null
  const record = posture === 'contend' ? 'at .600 or better' : 'at .400 or worse'
  const what = kind === 'veteran' ? 'players 27 or older' : kind === 'youth' ? 'players 24 or younger' : 'draft picks'
  return {
    kind: 'need',
    factor: 1 + row.premiumPct / 100,
    reason: `teams ${record} paid ${pct(row.premiumPct)} for ${what} over middle-of-the-table teams across ${row.trades} completed trades`,
  }
}
