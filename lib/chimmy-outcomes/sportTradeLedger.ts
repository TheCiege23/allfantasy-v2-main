import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { letterHeld, tradeLedgerRow, type TradeLedgerRow } from '@/lib/decision-os/trade/tradeLedger'

/**
 * DID THE TRADE GRADE HOLD UP — NBA, MLB, NHL, NCAAB, SOCCER (owner's call, 2026-11-22: "do all").
 *
 * The trade ledger (`ledgerGrading.ts`) grades saved trade letters against what happened, but only for the NFL: it
 * counts NFL weeks and reads PPR. These sports play most days, so this grades by DATE instead: for every saved grade in
 * a league of the sport, the fantasy points the players RECEIVED scored in games after the day it was graded, minus
 * what the players GIVEN scored over the same days.
 *
 *   net > 0   the graded side out-scored what it gave up
 *   A / B held up when net > 0; D / F when net < 0; C and a tie decide nothing   (the NFL ledger's own rule)
 *
 * ⚠ THE SAME CAVEATS AS THE NFL LEDGER, AND ONE MORE.
 *   - Points are the feed's own fantasy points (`player_game_stats.fantasyPoints`), not each league's scoring — and a
 *     category league has no points at all, so its trades are graded on a number its managers do not play for.
 *   - Picks and FAAB score nothing; a deal with them is graded on its players only.
 *   - A dynasty deal is priced for years; weeks of points are a weak signal for it.
 *   - ID SPACE IS NOT PROVEN. A receipt's player id and the feed's `playerId` must be the same key for a row to score.
 *     The result says how many ids were placed; a low share means this measures little, and says so rather than
 *     guessing a join.
 *
 * READ-ONLY. Nothing here feeds a grade or a confidence — it is a report until its coverage is known.
 */

export const SPORT_LEDGER_SPORTS = ['NBA', 'MLB', 'NHL', 'NCAAB', 'SOCCER'] as const
export type SportLedgerSport = (typeof SPORT_LEDGER_SPORTS)[number]
/** A grade is not judged until this many days of games have passed since it was given. */
export const SPORT_LEDGER_MIN_DAYS = 7

export type SportLedgerRow = TradeLedgerRow & { capturedAtMs: number }
export type SportLetterSummary = { n: number; netPoints: number; ahead: number; behind: number; held: number; decided: number }
export type SportLedgerResult = {
  sport: string
  byLetter: Record<string, SportLetterSummary>
  /** Graded too recently to judge. */
  pending: number
  /** No player on either side could be found in the feed. */
  unscored: number
  scored: number
}

type GamePoints = ReadonlyMap<string, ReadonlyArray<{ dayMs: number; points: number }>>

/** PURE. Grade rows against per-player game points (by UTC day). */
export function gradeSportTradeRows(sport: string, rows: readonly SportLedgerRow[], games: GamePoints, now: Date): SportLedgerResult {
  const DAY = 86_400_000
  const byLetter: Record<string, SportLetterSummary> = {}
  let pending = 0
  let unscored = 0
  let scored = 0
  for (const row of rows) {
    if (now.getTime() - row.capturedAtMs < SPORT_LEDGER_MIN_DAYS * DAY) {
      pending++
      continue
    }
    // Games on days AFTER the day it was graded: a game already under way that day is not "after".
    const from = Math.floor(row.capturedAtMs / DAY) * DAY + DAY
    const total = (ids: readonly string[]): number | null => {
      let any = false
      let sum = 0
      for (const id of ids) {
        const list = games.get(id)
        if (!list) continue
        any = true
        for (const g of list) if (g.dayMs >= from) sum += g.points
      }
      return ids.length === 0 ? 0 : any ? sum : null
    }
    const get = total(row.getPlayerIds)
    const give = total(row.givePlayerIds)
    if (get == null || give == null) {
      unscored++
      continue
    }
    scored++
    const net = get - give
    const s = (byLetter[row.letter] ??= { n: 0, netPoints: 0, ahead: 0, behind: 0, held: 0, decided: 0 })
    s.n++
    s.netPoints += net
    if (net > 0) s.ahead++
    else if (net < 0) s.behind++
    const held = letterHeld(row.letter, net)
    if (held != null) {
      s.decided++
      if (held) s.held++
    }
  }
  for (const s of Object.values(byLetter)) s.netPoints = s.n ? Math.round((s.netPoints / s.n) * 10) / 10 : 0
  return { sport, byLetter, pending, unscored, scored }
}

type Db = Pick<typeof prisma, '$queryRaw'>

/** Every saved trade grade in the sport's leagues over the window, one per deal, with the games to grade it. */
export async function loadSportTradeLedger(
  sport: SportLedgerSport,
  opts: { sinceDays?: number; limit?: number; db?: Db; now?: Date } = {},
): Promise<{ result: SportLedgerResult; read: number; gradable: number; skips: Record<string, number>; idsTotal: number; idsPlaced: number }> {
  const db = opts.db ?? prisma
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - (opts.sinceDays ?? 180) * 86_400_000)
  const limit = Math.max(1, opts.limit ?? 5000)
  const snaps = await db.$queryRaw<Array<{ is_trade: boolean; surface: string | null; captured_at: Date; receipt: unknown }>>`
    SELECT d.is_trade, d.surface, d.captured_at, d.receipt
    FROM (
      SELECT DISTINCT ON (COALESCE(s."inputHash", s.id))
             s."tradeId" IS NOT NULL AS is_trade, s.surface, s."capturedAt" AS captured_at, s."evaluationReceipt" AS receipt
      FROM trade_decision_snapshots s
      JOIN leagues l ON l.id = s."leagueId"
      WHERE s."evaluationReceipt" IS NOT NULL AND upper(l.sport::text) = ${sport} AND s."capturedAt" >= ${since}
      ORDER BY COALESCE(s."inputHash", s.id), s."capturedAt" ASC, s.id ASC
    ) d
    ORDER BY d.captured_at DESC
    LIMIT ${limit}`
  const skips: Record<string, number> = {}
  const rows: SportLedgerRow[] = []
  for (const s of snaps) {
    const r = tradeLedgerRow({ receipt: s.receipt, surface: s.surface, isTrade: s.is_trade, fromWeek: 0 })
    if ('skip' in r) skips[r.skip] = (skips[r.skip] ?? 0) + 1
    else rows.push({ ...r, capturedAtMs: new Date(s.captured_at).getTime() })
  }
  const ids = [...new Set(rows.flatMap((r) => [...r.getPlayerIds, ...r.givePlayerIds]))]
  const games = new Map<string, Array<{ dayMs: number; points: number }>>()
  for (let i = 0; i < ids.length; i += 2000) {
    const part = ids.slice(i, i + 2000)
    const stats = await db.$queryRaw<Array<{ pid: string; day: Date; p: number | null }>>`
      SELECT "playerId" AS pid, game_date AS day,
             SUM(CASE WHEN normalized_stat_map->>'scored' = 'false' THEN NULL ELSE "fantasyPoints" END) AS p
      FROM player_game_stats
      WHERE upper("sportType") = ${sport} AND game_date IS NOT NULL AND game_date >= ${since}
        AND "playerId" IN (${Prisma.join(part)})
      GROUP BY 1, 2`
    for (const g of stats) {
      if (g.p == null) continue
      games.set(g.pid, [...(games.get(g.pid) ?? []), { dayMs: new Date(g.day).getTime(), points: Number(g.p) }])
    }
  }
  return {
    result: gradeSportTradeRows(sport, rows, games, now),
    read: snaps.length,
    gradable: rows.length,
    skips,
    idsTotal: ids.length,
    idsPlaced: ids.filter((id) => games.has(id)).length,
  }
}
