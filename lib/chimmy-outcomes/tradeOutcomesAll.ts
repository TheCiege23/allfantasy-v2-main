import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { tradeLedgerRow } from '@/lib/decision-os/trade/tradeLedger'
import { foldTradeLetterCalls, type TradeLetterLedger } from '@/lib/decision-os/trade/letterCalibration'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { weeklyFormat } from '@/lib/core-app/weeklyCapabilities'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'
import { bridgeNcaafRosterIdsToCfbdIds } from '@/lib/redraft/ncaafGameLogIdBridge'
import { aggregateWeeklyStats, getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { aggregateNcaafWeek } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { rosterFormatFromSettings } from '@/lib/adp/draftContextKey'
import { accumulateTeamTotals, resolveCategoryMatchup } from '@/lib/category-scoring/CategoryMatchupResolver'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import type { CategoryDefinition } from '@/lib/category-scoring/types'
import { completedThrough, firstWeekNotKickedOff, type WeekCalendar } from './ledgerRecord'

/**
 * DID THE TRADE GRADE WORK OUT — EVERY SPORT, EVERY LEAGUE TYPE (owner's call, 2026-11-22: "dynasty trades and the rest
 * of the sports types and league types such as survivor, c2c, devy etc. — those are just as important").
 *
 * The NFL ledger (`ledgerGrading.gradeTrades`) grades NFL REDRAFT letters in standard PPR, and only those. This grades
 * everything else, in the same scheduled rebuild, into its own buckets — one per sport and kind — so a dynasty letter is
 * never judged by weeks of points and an NBA letter is never judged by an NFL calendar:
 *
 *   points   redraft-shaped seasons — best ball, guillotine, survivor, zombie, big brother, tournament, IDP redraft, and
 *            every sport's redraft. The players each side received, scored UNDER THAT LEAGUE'S OWN RULES
 *            (`buildLeagueStatScorer`), in games after the grade: per week for the NFL (its calendar), per day scaled
 *            to a week for every other sport.
 *   value    dynasty-shaped leagues — dynasty, keeper, devy, C2C, salary cap / contract. For the NFL, what each side's
 *            players are worth on the dynasty market (FantasyCalc, the league's own QB format) at least
 *            VALUE_MIN_DAYS after the grade, as a share of the deal: the outcome a dynasty price was a bet on. Other
 *            sports have no dated dynasty market yet, so their dynasty deals are graded on points over a longer window
 *            and counted in that sport's points bucket — said in the bucket's own `kind`.
 *
 * Every bucket feeds the same held-up rule as the NFL letters (`letterHeldUp`: A/B held when their side came out ahead,
 * D/F when it fell behind, C and ties decide nothing) and the same age-decayed confidence fold.
 *
 * ⚠ WHAT IS LEFT OUT, AND COUNTED:
 *   - NFL plain redraft: the existing ledger owns it (`ledgerGrading`), and two NFL redraft records would disagree.
 *   - category and roto leagues whose category set is not stored (`category_league`). The rest are graded on CATEGORIES
 *     WON over the same window (2026-11-22) — a points outcome would grade a number their managers do not play for.
 *   - a dynasty deal that moved FAAB, or a pick its grade's lines do not place on a side (`picks_not_valued`). Picks the
 *     lines do place are priced on the same dynasty book's pick rows a month on (2026-11-22). Players-only dynasty
 *     deals are graded; the skip is reported so its size is visible.
 *   - a player the game logs or the market cannot place: the side is unscored, never scored as zero.
 *
 * Counts only — no league, player, user or trade id leaves this module.
 */

/** points: league-scored points a week. value: dynasty market share. categories: categories won minus lost (2026-11-22). */
export type TradeOutcomeKind = 'points' | 'value' | 'categories'
export type TradeOutcomeTally = { n: number; net: number; ahead: number; behind: number }
export type TradeOutcomeBucket = {
  sport: string
  kind: TradeOutcomeKind
  /** Points: league-scored fantasy points a week, get minus give. Value: percentage points of the deal's total value. */
  byLetter: Partial<Record<string, TradeOutcomeTally>>
  pending: number
  unscored: number
  gradable: number
  /** Why rows were not graded here, by reason. */
  skips: Record<string, number>
  letters: TradeLetterLedger
}
export type TradeOutcomeLedger = Record<string, TradeOutcomeBucket>

/** Days of games a points grade waits for before it is judged (non-NFL; the NFL waits for one completed week). */
export const POINTS_MIN_DAYS = 7
/** A points grade counts games through this many days after it was given — the rest of a typical season. */
export const POINTS_HORIZON_DAYS = 120
/** A dynasty deal graded on points (no dated market for the sport) gets a full year of games. */
export const DYNASTY_POINTS_HORIZON_DAYS = 365
/** A dynasty value grade is judged on the market no sooner than this after the deal. */
export const VALUE_MIN_DAYS = 30
const DAY = 86_400_000

const VALUE_TYPES = /dynasty|keeper|devy|c2c|campus|salary_cap|salary-cap|contract/
/**
 * The kind of outcome a league's trades are graded on. Read from the receipt's own league type (what the grade was
 * given under), falling back to the league row. PURE.
 */
export function tradeOutcomeKind(typeText: string | null | undefined, isDynasty = false): TradeOutcomeKind {
  const t = String(typeText ?? '').toLowerCase()
  if (VALUE_TYPES.test(t)) return 'value'
  if (t) return 'points'
  return isDynasty ? 'value' : 'points'
}

/** True for the one combination the NFL ledger already grades. PURE. */
export function gradedByNflLedger(sport: string, typeText: string | null | undefined): boolean {
  const t = String(typeText ?? '').toLowerCase()
  return sport === 'NFL' && /^\s*redraft\s*$/.test(t)
}

export const outcomeBucketKey = (sport: string, kind: TradeOutcomeKind) => `${sport.toUpperCase()}:${kind}`

export type OutcomeCall =
  | { status: 'graded'; letter: string; net: number; capturedAtMs: number }
  | { status: 'pending' | 'unscored'; letter: string }

/** Fold graded calls into one bucket. PURE. */
export function foldOutcomeBucket(sport: string, kind: TradeOutcomeKind, calls: readonly OutcomeCall[], skips: Record<string, number>, now: Date): TradeOutcomeBucket {
  const byLetter: Record<string, TradeOutcomeTally> = {}
  let pending = 0
  let unscored = 0
  const graded: Array<{ letter: string; netPerWeek: number; ageDays: number }> = []
  for (const c of calls) {
    if (c.status !== 'graded') {
      if (c.status === 'pending') pending++
      else unscored++
    } else {
      const t = (byLetter[c.letter] ??= { n: 0, net: 0, ahead: 0, behind: 0 })
      t.n++
      t.net += c.net
      if (c.net > 0) t.ahead++
      else if (c.net < 0) t.behind++
      graded.push({ letter: c.letter, netPerWeek: c.net, ageDays: Math.max(0, (now.getTime() - c.capturedAtMs) / DAY) })
    }
  }
  for (const t of Object.values(byLetter)) t.net = t.n ? Math.round((t.net / t.n) * 10) / 10 : 0
  return { sport, kind, byLetter, pending, unscored, gradable: calls.length, skips, letters: foldTradeLetterCalls(graded) }
}

/**
 * Points a list of players scored, by game day, from `fromMs` (inclusive) to `throughMs` (inclusive). Null when any of
 * them cannot be placed in the game logs — a side is never scored as zero for a player we cannot see. PURE.
 */
/**
 * A category league's outcome: over the window, each side's players' stat lines summed, then the league's own
 * categories compared the way a weekly matchup compares them (`resolveCategoryMatchup`). Net = categories the
 * received side won minus those it lost. Null when any player cannot be placed in the game logs. PURE.
 */
export function categoriesNet(
  getIds: readonly string[],
  giveIds: readonly string[],
  byPlayer: ReadonlyMap<string, ReadonlyArray<{ dayMs: number; stats: Record<string, number> }>>,
  fromMs: number,
  throughMs: number,
  categories: readonly CategoryDefinition[],
): number | null {
  const totals = (ids: readonly string[]) => {
    const lines: Record<string, number>[] = []
    for (const id of ids) {
      const games = byPlayer.get(id)
      if (!games) return null
      for (const g of games) if (g.dayMs >= fromMs && g.dayMs <= throughMs) lines.push(g.stats)
    }
    return accumulateTeamTotals(lines)
  }
  const get = totals(getIds)
  const give = totals(giveIds)
  if (!get || !give || categories.length === 0) return null
  const r = resolveCategoryMatchup(get, give, categories)
  return r.aWins - r.bWins
}

export function pointsOver(ids: readonly string[], byPlayer: ReadonlyMap<string, ReadonlyArray<{ dayMs: number; points: number }>>, fromMs: number, throughMs: number): number | null {
  let total = 0
  for (const id of ids) {
    const games = byPlayer.get(id)
    if (!games) return null
    for (const g of games) if (g.dayMs >= fromMs && g.dayMs <= throughMs) total += g.points
  }
  return total
}

/** A draft pick as a grade line names it: "2027 1st", "2027 1st (Early)", "2026 Pick 1.04", "2027 Round 2". PURE. */
export function parseTradedPick(name: string): { season: string; round: number } | null {
  const t = String(name ?? '').trim()
  const m = /^(\d{4})\s+(?:pick\s+(\d+)\.\d+|(\d+)(?:st|nd|rd|th)\b|round\s+(\d+)\b|r(\d+)\b)/i.exec(t)
  if (!m) return null
  const round = Number(m[2] ?? m[3] ?? m[4] ?? m[5])
  return Number.isFinite(round) && round >= 1 ? { season: m[1]!, round } : null
}

export type TradedPick = { season: string; round: number }

/**
 * A dynasty deal's outcome: get minus give as a share of both, in percentage points. Null when anything is unpriced —
 * a player OR a pick (2026-11-22: picks are priced on the same dynasty book's pick rows a month on). PURE.
 */
export function valueShareNet(
  getIds: readonly string[],
  giveIds: readonly string[],
  valueOf: (id: string) => number | null,
  picks?: { get: readonly TradedPick[]; give: readonly TradedPick[]; valueOf: (p: TradedPick) => number | null },
): number | null {
  const sum = (ids: readonly string[], ps: readonly TradedPick[] = []) => {
    let s = 0
    for (const id of ids) {
      const v = valueOf(id)
      if (v == null) return null
      s += v
    }
    for (const p of ps) {
      const v = picks?.valueOf(p) ?? null
      if (v == null) return null
      s += v
    }
    return s
  }
  const get = sum(getIds, picks?.get)
  const give = sum(giveIds, picks?.give)
  if (get == null || give == null || get + give <= 0) return null
  return Math.round(((get - give) / (get + give)) * 1000) / 10
}

/**
 * The picks each way in a graded deal, from the grade's own LINES (each names its side): null when the deal also moved
 * FAAB, or when the lines do not account for every pick the receipt holds — a pick we cannot place is never guessed
 * onto a side. PURE.
 */
export function picksFromReceipt(receipt: unknown): { getPicks: TradedPick[]; givePicks: TradedPick[] } | null {
  const r = (receipt && typeof receipt === 'object' ? receipt : {}) as { assets?: unknown; grade?: { lines?: unknown } }
  const assets = Array.isArray(r.assets) ? (r.assets as Array<{ kind?: unknown }>) : []
  if (assets.some((a) => a?.kind === 'faab')) return null
  const pickAssets = assets.filter((a) => a?.kind === 'pick').length
  const lines = Array.isArray(r.grade?.lines) ? (r.grade!.lines as Array<{ side?: unknown; name?: unknown }>) : []
  const getPicks: TradedPick[] = []
  const givePicks: TradedPick[] = []
  for (const l of lines) {
    const p = typeof l?.name === 'string' ? parseTradedPick(l.name) : null
    if (!p) continue
    if (l.side === 'get') getPicks.push(p)
    else if (l.side === 'give') givePicks.push(p)
  }
  if (getPicks.length + givePicks.length === 0 || getPicks.length + givePicks.length !== pickAssets) return null
  return { getPicks, givePicks }
}

// ───────────────────────── the database half ─────────────────────────

type Db = typeof prisma
type Snap = { is_trade: boolean; surface: string | null; captured_at: Date; receipt: unknown; sport: string; league_type: string | null; league_variant: string | null; is_dynasty: boolean; settings: unknown }
type Row = NonNullable<Exclude<ReturnType<typeof tradeLedgerRow>, { skip: unknown }>> & {
  /** Draft picks each way, read off the grade's own lines (NFL dynasty value deals only). */
  getPicks?: TradedPick[]
  givePicks?: TradedPick[]
  /** A category league's own categories (kind `categories`). */
  categories?: readonly CategoryDefinition[]
  capturedAtMs: number
  sport: string
  kind: TradeOutcomeKind
  settings: unknown
  typeText: string
}

/** Receipts read per rebuild, newest first, one per deal. */
export const MAX_OUTCOME_RECEIPTS = 4000

const SPORT_KEYS: Record<string, string[]> = {
  NCAAF: ['NCAAF', 'NCAAFB', 'ncaaf', 'ncaafb'],
  NCAAB: ['NCAAB', 'NCAABB', 'ncaab', 'ncaabb'],
}
const sportKeys = (sport: string) => SPORT_KEYS[sport] ?? [sport, sport.toLowerCase()]

export async function gradeAllTradeOutcomes(opts: {
  now?: Date
  db?: Db
  nflCal?: WeekCalendar | null
  nflSeason?: number | null
  /** A partner workspace's leagues (lib/partner-portal): only trades evaluated in these leagues. Every snapshot carries its league, so the scope is exact. */
  leagueIds?: readonly string[]
} = {}): Promise<TradeOutcomeLedger> {
  if (opts.leagueIds && opts.leagueIds.length === 0) return {}
  const now = opts.now ?? new Date()
  const db = opts.db ?? prisma
  // Imported here, not at the top: `ledgerGrading` calls this module, and a top-level import would be a cycle.
  const { placePlayerIds } = await import('./ledgerGrading')
  const since = new Date(now.getTime() - DYNASTY_POINTS_HORIZON_DAYS * DAY)
  const snaps = await db.$queryRaw<Snap[]>`
    SELECT d.* FROM (
      SELECT DISTINCT ON (COALESCE(s."inputHash", s.id))
             s."tradeId" IS NOT NULL AS is_trade, s.surface, s."capturedAt" AS captured_at, s."evaluationReceipt" AS receipt,
             upper(l.sport::text) AS sport, l."leagueType" AS league_type, l."leagueVariant" AS league_variant,
             COALESCE(l."isDynasty", false) AS is_dynasty, l.settings
      FROM trade_decision_snapshots s
      JOIN leagues l ON l.id = s."leagueId"
      WHERE s."evaluationReceipt" IS NOT NULL AND s."capturedAt" >= ${since}
        ${opts.leagueIds ? Prisma.sql`AND s."leagueId" = ANY(${[...opts.leagueIds]}::text[])` : Prisma.empty}
      ORDER BY COALESCE(s."inputHash", s.id), s."capturedAt" ASC, s.id ASC
    ) d
    ORDER BY d.captured_at DESC
    LIMIT ${MAX_OUTCOME_RECEIPTS}`

  const skipsBy = new Map<string, Record<string, number>>()
  const skip = (key: string, why: string) => {
    const s = skipsBy.get(key) ?? {}
    s[why] = (s[why] ?? 0) + 1
    skipsBy.set(key, s)
  }
  const rows: Row[] = []
  for (const s of snaps) {
    const sport = String(s.sport ?? '').toUpperCase()
    const receiptType = String(((s.receipt as { grade?: { leagueType?: { type?: unknown } } })?.grade?.leagueType?.type) ?? '')
    const typeText = receiptType || s.league_variant || s.league_type || ''
    if (gradedByNflLedger(sport, typeText)) continue
    const kind = tradeOutcomeKind(typeText, s.is_dynasty)
    const key = outcomeBucketKey(sport, kind === 'value' && sport !== 'NFL' ? 'points' : kind)
    const r = tradeLedgerRow({ receipt: s.receipt, surface: s.surface, isTrade: s.is_trade, fromWeek: 0 })
    if ('skip' in r) {
      skip(key, r.skip)
      continue
    }
    if (kind === 'points' || sport !== 'NFL') {
      const format = weeklyFormat({ leagueType: s.league_type, settings: s.settings })
      if (format === 'categories' || format === 'roto') {
        /*
         * 2026-11-22: graded on CATEGORIES WON, never on points. Only when the league's own category set is stored and
         * validated (`nativeCategoryScoringContext`); a category league we cannot read the categories of is still skipped.
         */
        const ctx = nativeCategoryScoringContext(s.settings, sport)
        if (!ctx) {
          skip(outcomeBucketKey(sport, 'categories'), 'category_league')
          continue
        }
        rows.push({ ...r, capturedAtMs: new Date(s.captured_at).getTime(), sport, kind: 'categories', categories: ctx.categories as readonly CategoryDefinition[], settings: s.settings, typeText })
        continue
      }
    }
    let picks: { getPicks: TradedPick[]; givePicks: TradedPick[] } | null = null
    if (kind === 'value' && sport === 'NFL' && r.nonPlayerAssets) {
      picks = picksFromReceipt(s.receipt)
      if (!picks) {
        // FAAB in a dynasty deal, or a pick the grade's lines do not name: still not valued, still counted.
        skip(key, 'picks_not_valued')
        continue
      }
    }
    rows.push({ ...r, ...(picks ?? {}), capturedAtMs: new Date(s.captured_at).getTime(), sport, kind, settings: s.settings, typeText })
  }

  const callsBy = new Map<string, OutcomeCall[]>()
  const push = (key: string, call: OutcomeCall) => callsBy.set(key, [...(callsBy.get(key) ?? []), call])

  // NFL dynasty-shaped deals: the dynasty market, after the wait.
  const nflValue = rows.filter((r) => r.sport === 'NFL' && r.kind === 'value')
  if (nflValue.length) {
    const ids = [...new Set(nflValue.flatMap((r) => [...r.getPlayerIds, ...r.givePlayerIds]))]
    const toSleeper = await placePlayerIds(ids, db as never)
    const sleeperIds = [...new Set(toSleeper.values())]
    const valueBy = new Map<string, Map<string, number>>()
    for (const qb of ['ONE_QB', 'SUPERFLEX'] as const) {
      const rowsQ = sleeperIds.length
        ? await db.$queryRaw<Array<{ sleeper_id: string; value: number }>>`
            SELECT DISTINCT ON ("sleeperId") "sleeperId" AS sleeper_id, value
            FROM "PlayerValueSnapshot"
            WHERE source = 'FANTASYCALC' AND format = 'DYNASTY' AND "qbFormat" = ${qb} AND "sleeperId" IN (${Prisma.join(sleeperIds)})
            ORDER BY "sleeperId", "capturedAt" DESC`
        : []
      valueBy.set(qb, new Map(rowsQ.map((x) => [x.sleeper_id, Number(x.value)])))
    }
    // The same dynasty book's PICK rows, newest capture (stored daily since 2026-09-20) — only when a deal moved picks.
    const pickPrice = new Map<string, (p: TradedPick) => number | null>()
    if (nflValue.some((r) => (r.getPicks?.length ?? 0) + (r.givePicks?.length ?? 0) > 0)) {
      const { loadLatestPickValueSnapshots } = await import('@/lib/player-values/latestPickValueSnapshots')
      const { pickPricerFrom } = await import('@/lib/core-app/tradePicks')
      for (const qb of ['ONE_QB', 'SUPERFLEX'] as const) {
        const rowsP = await loadLatestPickValueSnapshots({ source: 'FANTASYCALC', format: 'DYNASTY', qbFormat: qb, client: db as never }).catch(() => [])
        const price = pickPricerFrom(rowsP)
        // The book's mean VALUE for the round (the scale the players' values are on); a drafted-and-gone season has no row.
        pickPrice.set(qb, (p) => price(p.season, p.round)?.value || null)
      }
    }
    for (const r of nflValue) {
      const key = outcomeBucketKey('NFL', 'value')
      if (now.getTime() - r.capturedAtMs < VALUE_MIN_DAYS * DAY) {
        push(key, { status: 'pending', letter: r.letter })
        continue
      }
      const qb = rosterFormatFromSettings(r.settings) === 'superflex' ? 'SUPERFLEX' : 'ONE_QB'
      const book = valueBy.get(qb)!
      const hasPicks = (r.getPicks?.length ?? 0) + (r.givePicks?.length ?? 0) > 0
      const net = valueShareNet(r.getPlayerIds, r.givePlayerIds, (id) => {
        const sid = toSleeper.get(id)
        return sid != null ? book.get(sid) ?? null : null
      }, hasPicks ? { get: r.getPicks ?? [], give: r.givePicks ?? [], valueOf: pickPrice.get(qb) ?? (() => null) } : undefined)
      push(key, net == null ? { status: 'unscored', letter: r.letter } : { status: 'graded', letter: r.letter, net, capturedAtMs: r.capturedAtMs })
    }
  }

  // NFL points-shaped special formats: league-scored points per completed week after the grade.
  const nflPoints = rows.filter((r) => r.sport === 'NFL' && r.kind === 'points')
  if (nflPoints.length && opts.nflCal && opts.nflCal.size > 0 && opts.nflSeason) {
    const cal = opts.nflCal
    const through = completedThrough(cal, now)
    const ids = [...new Set(nflPoints.flatMap((r) => [...r.getPlayerIds, ...r.givePlayerIds]))]
    const toSleeper = await placePlayerIds(ids, db as never)
    const sleeperIds = [...new Set(toSleeper.values())]
    const stats = sleeperIds.length
      ? await db.playerGameStat.findMany({
          where: { sportType: { in: ['NFL', 'nfl'] }, season: opts.nflSeason, playerId: { in: sleeperIds } },
          select: { playerId: true, weekOrRound: true, normalizedStatMap: true, fantasyPoints: true },
        })
      : []
    const positions = await positionsBySleeperId(db, sleeperIds)
    for (const r of nflPoints) {
      const key = outcomeBucketKey('NFL', 'points')
      const from = firstWeekNotKickedOff(cal, new Date(r.capturedAtMs))
      if (from == null) {
        push(key, { status: 'unscored', letter: r.letter })
        continue
      }
      if (through < from) {
        push(key, { status: 'pending', letter: r.letter })
        continue
      }
      const scorer = buildLeagueStatScorer({ sport: 'NFL', settings: r.settings as never })
      const byPlayer = new Map<string, Array<{ dayMs: number; points: number }>>()
      for (const id of [...r.getPlayerIds, ...r.givePlayerIds]) {
        const sid = toSleeper.get(id)
        if (!sid) continue
        const games = stats.filter((g) => g.playerId === sid)
        if (!games.length) continue
        byPlayer.set(id, games.map((g) => {
          const map = (g.normalizedStatMap ?? {}) as Record<string, number> & { scored?: unknown }
          const pts = map.scored === false || String(map.scored) === 'false' ? 0
            : scorer ? scorer(map, positions.get(sid) ?? null)
            : Number(map.pts_ppr ?? g.fantasyPoints ?? 0)
          // For the NFL the "day" axis is the WEEK number: `pointsOver` only compares and sums, so weeks work unchanged.
          return { dayMs: g.weekOrRound, points: pts }
        }))
      }
      const get = pointsOver(r.getPlayerIds, byPlayer, from, through)
      const give = pointsOver(r.givePlayerIds, byPlayer, from, through)
      const weeks = through - from + 1
      push(key, get == null || give == null ? { status: 'unscored', letter: r.letter } : { status: 'graded', letter: r.letter, net: (get - give) / weeks, capturedAtMs: r.capturedAtMs })
    }
  }

  // Every other sport: league-scored points per game day, scaled to a week.
  const bySport = new Map<string, Row[]>()
  for (const r of rows) if (r.sport !== 'NFL') bySport.set(r.sport, [...(bySport.get(r.sport) ?? []), r])
  for (const [sport, list] of bySport) {
    const key = outcomeBucketKey(sport, 'points')
    const ids = [...new Set(list.flatMap((r) => [...r.getPlayerIds, ...r.givePlayerIds]))]
    const keys = sportKeys(sport)
    let gameIds: string[] = []
    let rosterIdFor: (gameLogId: string) => string | undefined = () => undefined
    const refused = new Set<string>()
    if (sport === 'NCAAF') {
      const b = await bridgeNcaafRosterIdsToCfbdIds(db as never, ids)
      gameIds = b.cfbdIds
      rosterIdFor = b.rosterIdFor
      for (const id of [...b.ambiguous, ...b.unresolved]) refused.add(id)
    } else {
      const b = await bridgeRosterIdsToGameLogIds(db as never, keys, ids)
      gameIds = b.gameLogIds
      rosterIdFor = b.rosterIdFor
      for (const id of [...b.ambiguous, ...b.nameRefused]) refused.add(id)
    }
    const earliest = Math.min(...list.map((r) => r.capturedAtMs))
    const logs = gameIds.length
      ? await db.playerGameStat.findMany({
          where: { sportType: { in: keys }, playerId: { in: gameIds }, gameDate: { gte: new Date(earliest - DAY) } },
          select: { playerId: true, gameId: true, providerGameId: true, normalizedStatMap: true, gameDate: true },
        })
      : []
    // Group a player's rows by game, then canonicalise each game the way the sport's scoring expects.
    const games = new Map<string, Map<string, { dayMs: number; rows: unknown[] }>>()
    for (const g of logs) {
      const rosterId = rosterIdFor(g.playerId)
      if (!rosterId || refused.has(rosterId) || !g.gameDate) continue
      const gameKey = g.providerGameId || String(g.gameId ?? '').split(':')[0] || String(g.gameDate.getTime())
      const perPlayer = games.get(rosterId) ?? new Map()
      const entry = perPlayer.get(gameKey) ?? { dayMs: Math.floor(g.gameDate.getTime() / DAY) * DAY, rows: [] }
      entry.rows.push(g.normalizedStatMap)
      perPlayer.set(gameKey, entry)
      games.set(rosterId, perPlayer)
    }
    const normalizer = sport === 'NCAAF' ? null : getDailySportNormalizer(sport)
    const canonical = (rowsOfGame: unknown[]): Record<string, number> =>
      sport === 'NCAAF' ? aggregateNcaafWeek(rowsOfGame).stats : normalizer ? aggregateWeeklyStats(rowsOfGame, normalizer).stats : {}
    const positions = await positionsByRosterId(db, ids, sport)
    for (const r of list) {
      if (r.kind === 'categories') {
        const catKey = outcomeBucketKey(sport, 'categories')
        const from = Math.floor(r.capturedAtMs / DAY) * DAY + DAY
        const through = Math.min(now.getTime(), r.capturedAtMs + POINTS_HORIZON_DAYS * DAY)
        if (Math.floor((through - from) / DAY) + 1 < POINTS_MIN_DAYS) {
          push(catKey, { status: 'pending', letter: r.letter })
          continue
        }
        const byPlayer = new Map<string, Array<{ dayMs: number; stats: Record<string, number> }>>()
        for (const id of [...r.getPlayerIds, ...r.givePlayerIds]) {
          const g = games.get(id)
          if (g) byPlayer.set(id, [...g.values()].map((e) => ({ dayMs: e.dayMs, stats: canonical(e.rows) })))
        }
        const net = categoriesNet(r.getPlayerIds, r.givePlayerIds, byPlayer, from, through, r.categories ?? [])
        push(catKey, net == null ? { status: 'unscored', letter: r.letter } : { status: 'graded', letter: r.letter, net, capturedAtMs: r.capturedAtMs })
        continue
      }
      const scorer = buildLeagueStatScorer({ sport, settings: r.settings as never })
      if (!scorer) {
        skip(key, 'no_scoring_rules')
        continue
      }
      const horizon = r.kind === 'value' ? DYNASTY_POINTS_HORIZON_DAYS : POINTS_HORIZON_DAYS
      const from = Math.floor(r.capturedAtMs / DAY) * DAY + DAY
      const through = Math.min(now.getTime(), r.capturedAtMs + horizon * DAY)
      const days = Math.floor((through - from) / DAY) + 1
      if (days < POINTS_MIN_DAYS) {
        push(key, { status: 'pending', letter: r.letter })
        continue
      }
      const byPlayer = new Map<string, Array<{ dayMs: number; points: number }>>()
      for (const id of [...r.getPlayerIds, ...r.givePlayerIds]) {
        const g = games.get(id)
        if (!g) continue
        byPlayer.set(id, [...g.values()].map((e) => ({ dayMs: e.dayMs, points: scorer(canonical(e.rows), positions.get(id) ?? null) })))
      }
      const get = pointsOver(r.getPlayerIds, byPlayer, from, through)
      const give = pointsOver(r.givePlayerIds, byPlayer, from, through)
      push(key, get == null || give == null ? { status: 'unscored', letter: r.letter } : { status: 'graded', letter: r.letter, net: ((get - give) / days) * 7, capturedAtMs: r.capturedAtMs })
    }
  }

  const out: TradeOutcomeLedger = {}
  const keys = new Set([...callsBy.keys(), ...skipsBy.keys()])
  for (const key of keys) {
    const [sport, kind] = key.split(':') as [string, TradeOutcomeKind]
    out[key] = foldOutcomeBucket(sport, kind, callsBy.get(key) ?? [], skipsBy.get(key) ?? {}, now)
  }
  return out
}

/** NFL positions by Sleeper id — NFL only; see the read. */
async function positionsBySleeperId(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  // NFL by construction: the only caller is the NFL points branch, and Sleeper reuses ids across
  // sports (NBA 1466 McGee is not NFL 1466 Kelce), so the sport is part of the key.
  const rows = await db.sportsPlayer.findMany({ where: { sport: 'NFL', sleeperId: { in: [...ids] } }, select: { sleeperId: true, position: true } })
  return new Map(rows.flatMap((r) => (r.sleeperId && r.position ? [[r.sleeperId, r.position] as const] : [])))
}

/** A roster id's position, from whichever id column it is (a position is only needed for position-weighted rules). */
async function positionsByRosterId(db: Db, ids: readonly string[], sport: string): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const rows = await db.sportsPlayer.findMany({
    // externalid-audited: position only, held to this sport; a cross-source id collision can at worst mis-weight one position-weighted rule, never a points total
    where: { sport: { in: [sport, sport.toLowerCase()] }, OR: [{ sleeperId: { in: [...ids] } }, { externalId: { in: [...ids] } }] },
    select: { sleeperId: true, externalId: true, position: true },
  })
  const out = new Map<string, string>()
  for (const r of rows) {
    if (!r.position) continue
    if (r.sleeperId && ids.includes(r.sleeperId)) out.set(r.sleeperId, r.position)
    if (r.externalId && ids.includes(r.externalId)) out.set(r.externalId, r.position)
  }
  return out
}

