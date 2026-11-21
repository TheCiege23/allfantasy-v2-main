import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { MY_TEAM_BENCH_SURFACE, WAIVER_ENGINE_SURFACE, WAIVER_PANEL_SURFACE } from '@/lib/chimmy-advice/adviceSurfaces'
import { foldWaiverEngineBands, type GradedWaiverClaim, type WaiverEngineLedger } from '@/lib/decision-os/waiver/calibration'
import { gradeTradeRows, tradeLedgerRow, type TradeLedgerRow } from '@/lib/decision-os/trade/tradeLedger'
import { foldTradeLetterCalls, type TradeLetterLedger } from '@/lib/decision-os/trade/letterCalibration'
import { foldDraftTips, gradeDraftTip, type DraftTipLedger } from '@/lib/decision-os/draft/tipCalibration'
import { backtestKey, buildIdSpaces, chooseIdSpace, gameRowsToWeekly, weeklyByKey, windowPoints } from '@/lib/shared-services/draft/backtest/backtestInputs'
import {
  addWindowEnd,
  completedThrough,
  firstWeekNotKickedOff,
  foldLedger,
  LAST_REGULAR_WEEK,
  ADD_WINDOW_WEEKS,
  STARTABLE_PPR_PER_WEEK,
  TRADE_LETTERS,
  weekCalendar,
  weekIsOver,
  type AddRow,
  type BenchRow,
  type LedgerSnapshot,
  type TradeLetter,
  type WeekCalendar,
} from './ledgerRecord'

/**
 * ALLFANTASY'S OWN TRACK RECORD — the server half: read what the ledger recorded and what happened,
 * from Postgres only, and fold it (`ledgerRecord.ts`). Called by the outcome-snapshot rebuild
 * (`adviceLearning.ts`) on the maintenance cron, and by `scripts/trade-ledger-report.ts`.
 *
 * Read-only, and no provider call: the schedule (`SportsGame`), the platform's weekly scores
 * (`league_player_weekly_scores`) and the week-stats feed (`player_game_stats`) are all tables the
 * import crons already keep current.
 *
 * ⚠ A MISSING TABLE OR COLUMN IS "UNAVAILABLE" FOR THAT PART, never zero: the bench query reads
 * `withdrawn_at`, which only exists once the ledger migration is applied.
 */

/** Trade evaluations read per rebuild, newest first. */
export const MAX_TRADE_RECEIPTS_READ = 2000

type Db = typeof prisma

/** The NFL season a date belongs to: September through February counts as the year it started. */
export function nflSeasonFor(now: Date): number {
  const y = now.getUTCFullYear()
  return now.getUTCMonth() < 2 ? y - 1 : y
}

/** Each regular-season week's first and last kickoff, from the schedule table. */
export async function loadNflWeekCalendar(season: number, db: Db = prisma): Promise<WeekCalendar> {
  const rows = await db.$queryRaw<Array<{ week: number; first: Date; last: Date }>>`
    SELECT week, MIN("startTime") AS first, MAX("startTime") AS last
    FROM "SportsGame"
    WHERE sport = 'NFL' AND season = ${season} AND "seasonType" = 'regular'
      AND week BETWEEN 1 AND ${LAST_REGULAR_WEEK} AND "startTime" IS NOT NULL
    GROUP BY week`
  return weekCalendar(rows.map((r) => ({ week: Number(r.week), firstKickoff: new Date(r.first), lastKickoff: new Date(r.last) })))
}

/**
 * Standard PPR per player per week from the week-stats feed, for the given Sleeper ids: `pts_ppr`, or
 * the row's own points when it was scored — never a row marked `scored=false`, whose 0 is a default.
 */
export async function readPprByWeek(season: number, ids: readonly string[], db: Db = prisma): Promise<Map<string, Map<number, number>>> {
  const out = new Map<string, Map<number, number>>()
  if (ids.length === 0) return out
  const rows = await db.$queryRaw<Array<{ pid: string; wk: number; p: number | null }>>`
    SELECT "playerId" AS pid, "weekOrRound" AS wk,
           SUM(COALESCE((normalized_stat_map->>'pts_ppr')::float8,
                        CASE WHEN normalized_stat_map->>'scored' = 'false' THEN NULL ELSE "fantasyPoints" END)) AS p
    FROM player_game_stats
    WHERE "sportType" IN ('NFL', 'nfl') AND season = ${season} AND "playerId" = ANY(${[...ids]}::text[])
    GROUP BY 1, 2`
  for (const r of rows) {
    if (r.p == null) continue
    const m = out.get(r.pid) ?? new Map<number, number>()
    m.set(Number(r.wk), Number(r.p))
    out.set(r.pid, m)
  }
  return out
}

/**
 * A receipt's player id is a Sleeper id, or a SportsPlayer row id that carries one. Returns the
 * Sleeper id each input id is keyed by in the feed; an id it cannot place is absent.
 */
export async function placePlayerIds(ids: readonly string[], db: Db = prisma): Promise<Map<string, string>> {
  const placed = new Map<string, string>(ids.map((id) => [id, id]))
  if (ids.length === 0) return placed
  const mapped = await db.sportsPlayer.findMany({ where: { id: { in: [...ids] } }, select: { id: true, sleeperId: true } })
  for (const m of mapped) if (m.sleeperId?.trim()) placed.set(m.id, m.sleeperId.trim())
  return placed
}

/**
 * `AND <col> = ANY(ids)` when the read is scoped to a set of leagues (a partner workspace), nothing otherwise —
 * the platform-wide rebuild passes no scope and its SQL is unchanged.
 */
function leagueScope(column: Prisma.Sql, leagueIds: readonly string[] | undefined): Prisma.Sql {
  return leagueIds ? Prisma.sql`AND ${column} = ANY(${[...leagueIds]}::text[])` : Prisma.empty
}

type BenchRowSql = {
  user_id: string; week: number; withdrawn: boolean; rec_pts: number | null; alt_pts: number | null
  sport?: string | null; rec_projected?: number | null; alt_projected?: number | null; given_at?: Date | null
}

/** Exported for its fallback test (`__tests__/decision-os/bench-calibration.test.ts`). */
export async function loadBenchRows(season: number, db: Db, leagueIds?: readonly string[]): Promise<BenchRow[]> {
  const from = Prisma.sql`
    FROM chimmy_advice a
    JOIN leagues l ON l.id = a.league_id
    LEFT JOIN league_player_weekly_scores r
      ON r."leagueId" = l."platformLeagueId" AND r."seasonYear" = a.season AND r.week = a.week AND r."playerId" = a.rec_player_key
    LEFT JOIN league_player_weekly_scores s
      ON s."leagueId" = l."platformLeagueId" AND s."seasonYear" = a.season AND s.week = a.week AND s."playerId" = a.alt_player_key
    WHERE a.surface = ${MY_TEAM_BENCH_SURFACE} AND a.advice_type = 'start_sit' AND a.alt_player_key <> '' AND a.season = ${season}
      ${leagueScope(Prisma.sql`a.league_id`, leagueIds)}`
  /*
   * What each call knew (2026-11-21), for the bench check's own calibration: the sport, both projections when it was
   * made, and when. ⚠ `rec_projected` / `alt_projected` arrive with `20261115000000_chimmy_advice_ledger_inputs`, and
   * the writer already tolerates a database without them — so does this read: if the wider SELECT fails, the original
   * one runs and the tally is exactly what it was, with no edge bands. A missing column is "no calibration", never a
   * lost bench record.
   */
  let rows: BenchRowSql[]
  try {
    rows = await db.$queryRaw<BenchRowSql[]>`
      SELECT a.user_id, a.week, a.withdrawn_at IS NOT NULL AS withdrawn, r.points AS rec_pts, s.points AS alt_pts,
             a.sport, a.rec_projected, a.alt_projected, a.given_at
      ${from}`
  } catch {
    rows = await db.$queryRaw<BenchRowSql[]>`
      SELECT a.user_id, a.week, a.withdrawn_at IS NOT NULL AS withdrawn, r.points AS rec_pts, s.points AS alt_pts
      ${from}`
  }
  return rows.map((r) => ({
    userId: r.user_id,
    week: Number(r.week),
    withdrawn: Boolean(r.withdrawn),
    recPts: r.rec_pts == null ? null : Number(r.rec_pts),
    altPts: r.alt_pts == null ? null : Number(r.alt_pts),
    sport: r.sport ?? null,
    recProjected: r.rec_projected == null ? null : Number(r.rec_projected),
    altProjected: r.alt_projected == null ? null : Number(r.alt_projected),
    givenAt: r.given_at ?? null,
  }))
}

async function loadAddRows(season: number, db: Db, leagueIds?: readonly string[]): Promise<AddRow[]> {
  const rows = await db.$queryRaw<Array<{ user_id: string; week: number; rec_key: string; alt_key: string }>>`
    SELECT user_id, week, rec_player_key AS rec_key, alt_player_key AS alt_key
    FROM chimmy_advice
    WHERE surface = ${WAIVER_PANEL_SURFACE} AND advice_type = 'add' AND season = ${season}
      ${leagueScope(Prisma.sql`league_id`, leagueIds)}`
  const ids = [...new Set(rows.flatMap((r) => [r.rec_key, r.alt_key]).filter(Boolean))]
  const feed = await readPprByWeek(season, ids, db)
  return rows.map((r) => {
    const week = Number(r.week)
    const end = Math.min(week + ADD_WINDOW_WEEKS - 1, LAST_REGULAR_WEEK)
    const sum = (id: string) => {
      const m = feed.get(id)
      let pts = 0
      let weeks = 0
      for (let w = week; w <= end; w++) {
        const p = m?.get(w)
        if (p != null) {
          pts += p
          weeks++
        }
      }
      return { pts, weeks }
    }
    const rec = sum(r.rec_key)
    const hasDrop = Boolean(r.alt_key)
    return { userId: r.user_id, week, recPts: rec.weeks > 0 ? rec.pts : null, recWeeks: rec.weeks, altPts: hasDrop ? sum(r.alt_key).pts : null, hasDrop }
  })
}

/**
 * THE WAIVER ENGINE'S #1 CLAIMS, WITH THE SCORE IT GAVE THEM (2026-11-20) — the input to the engine's own
 * calibration (`lib/decision-os/waiver/calibration.ts`). Rows from the scheduled weekly run
 * (`waiver_engine`) and the panel (`waiver_panel`), but only those carrying a score: both record one only
 * in a league the ledger can measure (redraft, full-PPR NFL), so a row with no score is out of scope by
 * construction and never reaches the bands.
 */
export type EngineClaimRow = AddRow & { score: number; givenAt: Date }

async function loadEngineClaimRows(season: number, db: Db): Promise<EngineClaimRow[]> {
  const rows = await db.$queryRaw<Array<{ user_id: string; week: number; rec_key: string; score: number; given_at: Date }>>`
    SELECT user_id, week, rec_player_key AS rec_key, confidence_pct AS score, given_at
    FROM chimmy_advice
    WHERE surface IN (${WAIVER_ENGINE_SURFACE}, ${WAIVER_PANEL_SURFACE}) AND advice_type = 'add' AND season = ${season}
      AND confidence_pct IS NOT NULL`
  const ids = [...new Set(rows.map((r) => r.rec_key).filter(Boolean))]
  const feed = await readPprByWeek(season, ids, db)
  return rows.map((r) => {
    const week = Number(r.week)
    const end = Math.min(week + ADD_WINDOW_WEEKS - 1, LAST_REGULAR_WEEK)
    const m = feed.get(r.rec_key)
    let pts = 0
    let weeks = 0
    for (let w = week; w <= end; w++) {
      const p = m?.get(w)
      if (p != null) {
        pts += p
        weeks++
      }
    }
    return {
      userId: r.user_id,
      week,
      recPts: weeks > 0 ? pts : null,
      recWeeks: weeks,
      altPts: null,
      hasDrop: false,
      score: Number(r.score),
      givenAt: new Date(r.given_at),
    }
  })
}

/**
 * Graded engine claims → the per-band counts the snapshot stores. The pickup rule exactly: nothing until
 * the claim's three-week window is provably over, a window with no stat row is unscored (never "not
 * startable"), and startable is STARTABLE_PPR_PER_WEEK or more per week of the window.
 */
export function gradeEngineClaims(rows: readonly EngineClaimRow[], cal: WeekCalendar, now: Date): WaiverEngineLedger {
  const graded: GradedWaiverClaim[] = []
  for (const r of rows) {
    const end = addWindowEnd(r.week)
    if (!weekIsOver(cal, end, now)) continue
    if (!(r.recWeeks > 0) || r.recPts == null || !Number.isFinite(r.recPts)) continue
    const weeks = end - r.week + 1
    const at = r.givenAt instanceof Date ? r.givenAt.getTime() : Number.NaN
    graded.push({
      score: r.score,
      startable: r.recPts / weeks >= STARTABLE_PPR_PER_WEEK,
      ageDays: Number.isFinite(at) ? (now.getTime() - at) / 86_400_000 : 0,
    })
  }
  return foldWaiverEngineBands(graded)
}

export type TradeLedgerInputs = {
  rows: Array<TradeLedgerRow & { completed: boolean; capturedAtMs: number }>
  skips: Record<string, number>
  read: number
  /** Standard PPR per week over [from, through] for a set of receipt player ids; null when one cannot be placed. */
  pointsPerWeek: (ids: readonly string[], from: number, through: number) => number | null
  idsTotal: number
  idsPlaced: number
}

/** The surface `reviewStoredTrade` evaluates under (`lib/decision-os/trade/tradeReviewContext.ts`). */
export const COMMISSIONER_REVIEW_SURFACE = 'commissioner-review'

/**
 * Every saved trade evaluation of the season, as gradable rows, with the feed to grade them — ONE ROW PER DEAL.
 *
 * 🛑 A RECEIPT IS AN EVALUATION, NOT A DEAL, AND UNTIL 2026-11-20 THIS COUNTED EVALUATIONS. `saveAdHocReceipt`
 * reuses a receipt only for the same surface, viewer and league within 24 hours, so one disputed trade looked at
 * on three days, on two screens, by both managers and by the commissioner was graded as a dozen trades. The
 * letter's record beside every Trade Center grade (and its 20-deal floor) was inflated by however often its
 * deals were re-opened. Now each `inputHash` — league, both sides' assets and the viewer's side — counts once,
 * at its FIRST evaluation: the letter the manager was shown before anything else happened. The two sides of
 * one deal stay two rows on purpose; they are two calls (an A for one side is an F for the other). A row from
 * before the hash column existed has none and counts on its own, as before.
 *
 * The dedup is in SQL, ahead of the LIMIT, so re-opened deals no longer crowd real ones out of the read.
 * `surface` narrows to one surface first (the commissioner review's own record), deduplicated the same way.
 */
export async function loadTradeLedgerInputs(
  season: number,
  cal: WeekCalendar,
  opts: { limit?: number; db?: Db; surface?: string } = {},
): Promise<TradeLedgerInputs> {
  const db = opts.db ?? prisma
  const limit = Math.max(1, opts.limit ?? MAX_TRADE_RECEIPTS_READ)
  const onSurface = opts.surface ? Prisma.sql`AND s.surface = ${opts.surface}` : Prisma.empty
  const snaps = await db.$queryRaw<Array<{ is_trade: boolean; completed: boolean; surface: string | null; captured_at: Date; receipt: unknown }>>`
    SELECT d.is_trade, d.completed, d.surface, d.captured_at, d.receipt
    FROM (
      SELECT DISTINCT ON (COALESCE(s."inputHash", s.id))
             s."tradeId" IS NOT NULL AS is_trade,
             COALESCE(t.status IN ('accepted', 'processed', 'completed'), false) AS completed,
             s.surface, s."capturedAt" AS captured_at, s."evaluationReceipt" AS receipt
      FROM trade_decision_snapshots s
      LEFT JOIN af_league_trades t ON t.id = s."tradeId"
      WHERE s."evaluationReceipt" IS NOT NULL
        AND s."capturedAt" >= ${new Date(Date.UTC(season, 7, 1))} AND s."capturedAt" < ${new Date(Date.UTC(season + 1, 1, 15))}
        ${onSurface}
      ORDER BY COALESCE(s."inputHash", s.id), s."capturedAt" ASC, s.id ASC
    ) d
    ORDER BY d.captured_at DESC
    LIMIT ${limit}`

  const skips: Record<string, number> = {}
  const rows: TradeLedgerInputs['rows'] = []
  for (const s of snaps) {
    const r = tradeLedgerRow({ receipt: s.receipt, surface: s.surface, isTrade: s.is_trade, fromWeek: firstWeekNotKickedOff(cal, new Date(s.captured_at)) })
    if ('skip' in r) skips[r.skip] = (skips[r.skip] ?? 0) + 1
    else rows.push({ ...r, completed: Boolean(s.completed), capturedAtMs: new Date(s.captured_at).getTime() })
  }

  const ids = [...new Set(rows.flatMap((r) => [...r.getPlayerIds, ...r.givePlayerIds]))]
  const toSleeper = await placePlayerIds(ids, db)
  const feed = await readPprByWeek(season, [...new Set(toSleeper.values())], db)
  const placed = (id: string): string | null => {
    const sid = toSleeper.get(id)
    return sid && feed.has(sid) ? sid : null
  }
  const pointsPerWeek = (list: readonly string[], from: number, through: number): number | null => {
    const weeks = through - from + 1
    if (weeks <= 0) return null
    let total = 0
    for (const id of list) {
      const sid = placed(id)
      if (!sid) return null
      const m = feed.get(sid)!
      for (let w = from; w <= through; w++) total += m.get(w) ?? 0
    }
    return total / weeks
  }
  return { rows, skips, read: snaps.length, pointsPerWeek, idsTotal: ids.length, idsPlaced: ids.filter((id) => placed(id) != null).length }
}

type GradedTrades = { tally: LedgerSnapshot['trades']; letters: TradeLetterLedger }

async function gradeTrades(season: number, cal: WeekCalendar, now: Date, db: Db, surface?: string): Promise<GradedTrades> {
  const inputs = await loadTradeLedgerInputs(season, cal, { db, surface })
  const redraft = inputs.rows.filter((r) => r.format === 'redraft')
  const g = gradeTradeRows(redraft, completedThrough(cal, now), inputs.pointsPerWeek)
  const byLetter: LedgerSnapshot['trades']['byLetter'] = {}
  for (const letter of TRADE_LETTERS) {
    const s = g.byLetter.get(letter)
    if (s) byLetter[letter as TradeLetter] = { n: s.n, netPerWeek: s.netPerWeek, ahead: s.positive, behind: s.negative }
  }
  // Each letter's held-up record, decayed by the grade's age — the trade grade's own confidence (`letterCalibration.ts`).
  const letters = foldTradeLetterCalls(
    g.scored.map(({ row, netPerWeek }) => ({
      letter: row.letter,
      netPerWeek,
      ageDays: Number.isFinite(row.capturedAtMs) ? (now.getTime() - row.capturedAtMs) / 86_400_000 : 0,
    })),
  )
  return { tally: { byLetter, pending: g.pending, unscored: g.unscored, read: inputs.read, gradable: redraft.length }, letters }
}

/** A recorder key (`name|position`, as `recommendationRecorder.ts` writes it) → the outcome table's key. */
function recorderKeyToOutcomeKey(key: string): string {
  const i = key.lastIndexOf('|')
  return i < 0 ? backtestKey(key, '') : backtestKey(key.slice(0, i), key.slice(i + 1))
}

/**
 * Draft OS's served pick tips this NFL season (`draft_recommendation_records`), each graded against the best-projected
 * alternatives the pool held at that moment (`decision-os/draft/tipCalibration.ts`), standard PPR from the first week not kicked
 * off through the last one played. Nothing is read beyond the records when there are none.
 */
async function gradeDraftTips(season: number, cal: WeekCalendar, now: Date, db: Db): Promise<DraftTipLedger> {
  const records = await db.draftRecommendationRecord.findMany({
    where: { sport: 'NFL', createdAt: { gte: new Date(Date.UTC(season, 5, 1)), lt: new Date(Date.UTC(season + 1, 1, 15)) } },
    select: { createdAt: true, round: true, servedMode: true, observeName: true, observePosition: true, activeName: true, activePosition: true, detail: true },
    take: 20_000,
  })
  if (records.length === 0) return {}
  const through = completedThrough(cal, now)
  const [players, gameRaw] = await Promise.all([
    db.sportsPlayer.findMany({ where: { sport: 'NFL' }, select: { id: true, externalId: true, sleeperId: true, source: true, name: true, position: true } }),
    db.playerGameStat.findMany({
      where: { sportType: { in: ['NFL', 'nfl'] }, season },
      select: { playerId: true, weekOrRound: true, fantasyPoints: true, normalizedStatMap: true },
    }),
  ])
  const game = gameRowsToWeekly(gameRaw)
  const space = chooseIdSpace(buildIdSpaces(players), game.rows.map((r) => r.playerId)).space
  const { byKey } = weeklyByKey(game.rows, space)
  const windows = new Map<number, Map<string, number>>()
  const calls: Array<{ round: number; grade: 'held' | 'missed' | null }> = []
  for (const r of records) {
    const from = firstWeekNotKickedOff(cal, new Date(r.createdAt))
    if (from == null || from > through) continue
    let pts = windows.get(from)
    if (!pts) windows.set(from, (pts = windowPoints(byKey, from, through)))
    const servedName = r.servedMode === 'active' ? r.activeName : r.observeName
    const servedPos = r.servedMode === 'active' ? r.activePosition : r.observePosition
    const detail = (r.detail ?? {}) as { projections?: Record<string, number> }
    const window = pts
    calls.push({
      round: r.round,
      grade: gradeDraftTip({
        servedKey: servedName ? `${servedName}|${servedPos ?? ''}` : null,
        projections: detail.projections && typeof detail.projections === 'object' ? detail.projections : {},
        points: (key) => window.get(recorderKeyToOutcomeKey(key)) ?? null,
      }),
    })
  }
  return foldDraftTips(calls)
}

/** Swallow only "this part's table/column is not there"; anything else is the caller's to see. */
async function part<T>(fn: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const e = err as { code?: unknown; meta?: { code?: unknown } } | null
    const code = String(e?.code ?? '')
    const pg = String(e?.meta?.code ?? '')
    if (['P2021', 'P2022', '42P01', '42703'].includes(code) || ['42P01', '42703'].includes(pg)) return empty
    throw err
  }
}

/**
 * The whole ledger for the current NFL season. Null when the schedule carries no regular-season weeks
 * for it — then nothing can be proven over, and nothing is written.
 */
export async function recomputeLedgerRecord(opts: { now?: Date; db?: Db } = {}): Promise<LedgerSnapshot | null> {
  const now = opts.now ?? new Date()
  const db = opts.db ?? prisma
  const season = nflSeasonFor(now)
  const cal = await loadNflWeekCalendar(season, db)
  if (cal.size === 0) return null
  const noTrades: GradedTrades = { tally: { byLetter: {}, pending: 0, unscored: 0, read: 0, gradable: 0 }, letters: {} }
  const [bench, adds, graded, commissionerGraded, engineClaims] = await Promise.all([
    part(() => loadBenchRows(season, db), [] as BenchRow[]),
    part(() => loadAddRows(season, db), [] as AddRow[]),
    part(() => gradeTrades(season, cal, now, db), noTrades),
    // The same letters, graded only where a commissioner was shown them in a trade review.
    part(() => gradeTrades(season, cal, now, db, COMMISSIONER_REVIEW_SURFACE), noTrades),
    // The waiver engine's #1 claims, by the score it gave them — its own calibration.
    part(() => loadEngineClaimRows(season, db), [] as EngineClaimRow[]),
  ])
  /*
   * Draft OS's served pick tips, graded against the board they were given on — its own calibration. ⚠ Contained on its
   * own, not through `part()`: it is the newest part and only feeds a confidence line, so any failure in it costs only
   * that line, never the bench, pickup, trade and waiver records beside it.
   */
  const draftTips = await gradeDraftTips(season, cal, now, db).catch((err: unknown) => {
    console.warn('[ledgerGrading] draft tip grading failed', err instanceof Error ? err.message : err)
    return {} as DraftTipLedger
  })
  const waiverEngine = gradeEngineClaims(engineClaims, cal, now)
  return foldLedger({
    season,
    cal,
    now,
    bench,
    adds,
    trades: graded.tally,
    commissionerTrades: commissionerGraded.tally,
    waiverEngine,
    tradeLetters: graded.letters,
    commissionerTradeLetters: commissionerGraded.letters,
    draftTips,
  })
}

/**
 * The same ledger, scoped to a set of leagues — a partner workspace's linked leagues (lib/partner-portal).
 * Start/sit (My Team's bench check) and pickups (the waiver panel's #1 add) only: trade evaluations are not
 * keyed to a league in a way a partner scope can trust yet, so they are left out rather than guessed.
 *
 * The `users` map is EMPTIED: a partner sees counts for its leagues, never which person was given which call.
 * Null when the schedule has no regular-season weeks for the season, or when no league is given.
 */
export async function recomputeLedgerForLeagues(
  leagueIds: readonly string[],
  opts: { now?: Date; db?: Db } = {},
): Promise<LedgerSnapshot | null> {
  if (leagueIds.length === 0) return null
  const now = opts.now ?? new Date()
  const db = opts.db ?? prisma
  const season = nflSeasonFor(now)
  const cal = await loadNflWeekCalendar(season, db)
  if (cal.size === 0) return null
  const [bench, adds] = await Promise.all([
    part(() => loadBenchRows(season, db, leagueIds), [] as BenchRow[]),
    part(() => loadAddRows(season, db, leagueIds), [] as AddRow[]),
  ])
  const folded = foldLedger({ season, cal, now, bench, adds, trades: { byLetter: {}, pending: 0, unscored: 0, read: 0, gradable: 0 } })
  return { ...folded, users: {} }
}
