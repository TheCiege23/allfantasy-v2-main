import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  TRADE_CONTEXT_SNAPSHOT_VERSION,
  type TradeContextPlayer,
  type TradeContextSide,
  type TradeContextSnapshot,
} from '@/lib/trade-market/tradeContextSnapshot'

/**
 * CONTEXT FOR THE TRADES THE LIVE SYNC NEVER SAW (owner's call, 2026-11-22).
 *
 * The live sync saves each trade's situation as it happens (`tradeContextSnapshot.ts`), but it reads only the leagues it
 * syncs every 30 minutes. Every other trade reaches `LeagueTrade` through a history writer — the Sleeper backfill, the
 * activity-feed archive, the Fantrax upload — with no context at all. Those are most of the trades.
 *
 * This fills them from what the database already holds, one writer-independent pass:
 *   - each team's roster from the weekly player rows of the WEEK BEFORE the trade (`league_player_weekly_scores`);
 *   - each team's record from the weekly results before it (`WeeklyMatchup`);
 *   - the league's settings from its stored row.
 * ⚠ REBUILT, NOT EXACT, AND IT SAYS SO: `source: 'backfill_rebuilt'` with the roster week. A move made between that
 * week's lineup and the trade is not in it. The learner weighs it accordingly.
 *
 * ⚠ FIRST CAPTURE WINS, so a live capture is never overwritten; and a trade under a day old is left to the live sync,
 * which sees it on every 30-minute pass and captures it exactly.
 * ⚠ A TRADE THAT CANNOT BE REBUILT IS MARKED, not left empty — `{ unavailable: reason }`. Left empty it would be picked
 * again on every run, newest first, and the trades behind it would never be reached. A later version can retry those.
 *
 * OFFSEASON TRADES (about 60% of all trades are offseason or week ≤ 1) have no "week before". Their roster comes from
 * the SAME season's week-1 rows with the trade undone: each side's week-1 roster, minus what it received, plus what it
 * gave. ⚠ Approximate and labelled `week1_unwound`: moves made between the trade and week 1 (a rookie draft, waiver
 * claims) are in that roster. If the week-1 rows already PREDATE the trade (a trade made during week 1, after the
 * lineups locked — the players a side gave are still on it and the ones it got are not), the rows are used as they are.
 * Such a trade waits until its season has week-1 rows; trades marked `no_trade_week` by the first version are retried.
 *
 * DB-first: database reads and one write per trade, no provider call. `TRADE_CONTEXT_BACKFILL=off` switches it off.
 */

export const TRADE_CONTEXT_BACKFILL_ENV = 'TRADE_CONTEXT_BACKFILL'
/** Trades younger than this are the live sync's to capture. */
export const TRADE_CONTEXT_BACKFILL_MIN_AGE_MS = 24 * 60 * 60 * 1000
/** Trades handled per run, newest first. */
export const TRADE_CONTEXT_BACKFILL_LIMIT = 200
/** A run stops starting leagues when less than this is left of its budget. */
export const TRADE_CONTEXT_BACKFILL_MIN_RUNWAY_MS = 15_000

export type BackfillUnavailable = {
  version: typeof TRADE_CONTEXT_SNAPSHOT_VERSION
  source: 'backfill_rebuilt'
  unavailable: 'one_side_stored' | 'no_trade_week' | 'no_roster_rows'
  capturedAt: string
}

export type BackfillTradeRow = {
  managerId: string
  partnerRosterId: number | null
  /** Player ids this side gave and got (`LeagueTrade.playersGiven/Received`). Only the offseason rebuild needs them. */
  playersGiven?: string[]
  playersReceived?: string[]
}

/** Player ids out of a stored `playersGiven/Received` column: plain ids, or objects carrying one. PURE. */
export function tradePlayerIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((p) => {
    if (typeof p === 'string' || typeof p === 'number') return String(p).trim() ? [String(p).trim()] : []
    if (p && typeof p === 'object') {
      const o = p as Record<string, unknown>
      const id = o.id ?? o.playerId ?? o.sleeperId ?? o.player_id
      return typeof id === 'string' || typeof id === 'number' ? [String(id)] : []
    }
    return []
  })
}

/** The week whose rows hold a trade's roster: the week before, or week 1 for an offseason trade. */
export function rosterWeekFor(week: number): number {
  return week > 1 ? week - 1 : 1
}

export type BackfillCandidate = {
  leagueId: string
  transactionId: string
  season: number
  week: number
  tradeAt: Date | null
  platform: string
  sport: string
  rows: BackfillTradeRow[]
}

export type WeeklyRosterRow = { playerId: string; rosterId: string; isStarter: boolean }
export type WeeklyResultRow = { rosterId: string; week: number; win: number; pointsFor: number; pointsAgainst: number }
export type StoredLeague = {
  sport: string
  season: number
  leagueSize: number | null
  scoring: string | null
  isDynasty: boolean
  leagueVariant: string | null
  leagueType: string | null
  settings: unknown
}

/** The two teams of a two-sided trade: each row names its PARTNER's roster, so a team's roster id comes from the other row. */
export function sidesOf(rows: BackfillTradeRow[]): Array<{ rosterId: string; managerId: string }> | null {
  if (rows.length !== 2) return null
  const [a, b] = rows as [BackfillTradeRow, BackfillTradeRow]
  if (a.partnerRosterId == null || b.partnerRosterId == null || a.partnerRosterId === b.partnerRosterId) return null
  return [
    { rosterId: String(b.partnerRosterId), managerId: a.managerId },
    { rosterId: String(a.partnerRosterId), managerId: b.managerId },
  ]
}

/**
 * Do the week-1 rows show the rosters AFTER the trade? Counts, across both sides, players a side got that are on it
 * (after) against players a side gave that are still on it (before). A tie — including no evidence at all — is read as
 * after, since an offseason trade is made before week 1 far more often than during it. PURE.
 */
export function week1RowsAfterTrade(
  rows: BackfillTradeRow[],
  sides: Array<{ rosterId: string }>,
  byRoster: Map<string, WeeklyRosterRow[]>,
): boolean {
  let after = 0
  let before = 0
  sides.forEach((side, i) => {
    const held = new Set((byRoster.get(side.rosterId) ?? []).map((r) => r.playerId))
    for (const id of rows[i]?.playersReceived ?? []) if (held.has(id)) after += 1
    for (const id of rows[i]?.playersGiven ?? []) if (held.has(id)) before += 1
  })
  return after >= before
}

function rosterPositionsOf(settings: unknown): string[] | null {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : null
  const raw = s ? (s.roster_positions ?? s.rosterPositions) : null
  return Array.isArray(raw) ? raw.map((p) => String(p).toUpperCase()) : null
}

function slotCounts(slots: string[] | null): Record<string, number> | null {
  if (!slots?.length) return null
  const counts: Record<string, number> = {}
  for (const s of slots) if (s !== 'BN' && s !== 'IR' && s !== 'TAXI') counts[s] = (counts[s] ?? 0) + 1
  return Object.keys(counts).length ? counts : null
}

/** The rebuilt context of one trade, or the reason it cannot be rebuilt. PURE. */
export function buildRebuiltTradeContext(input: {
  candidate: BackfillCandidate
  rosterRows: WeeklyRosterRow[]
  resultRows: WeeklyResultRow[]
  league: StoredLeague | null
  positions: Map<string, { position: string | null; team: string | null }>
  now: Date
}): TradeContextSnapshot | BackfillUnavailable {
  const { candidate: c, now } = input
  const capturedAt = now.toISOString()
  const unavailable = (reason: BackfillUnavailable['unavailable']): BackfillUnavailable => ({
    version: TRADE_CONTEXT_SNAPSHOT_VERSION, source: 'backfill_rebuilt', unavailable: reason, capturedAt,
  })
  const sides = sidesOf(c.rows)
  if (!sides) return unavailable('one_side_stored')
  const offseason = !(c.week > 1)
  const rosterWeek = rosterWeekFor(c.week)

  const byRoster = new Map<string, WeeklyRosterRow[]>()
  for (const r of input.rosterRows) byRoster.set(r.rosterId, [...(byRoster.get(r.rosterId) ?? []), r])
  if (sides.some((s) => !(byRoster.get(s.rosterId)?.length))) return unavailable('no_roster_rows')
  const unwind = offseason && week1RowsAfterTrade(c.rows, sides, byRoster)

  const out: TradeContextSide[] = sides.map(({ rosterId, managerId }, i) => {
    const results = input.resultRows.filter((r) => r.rosterId === rosterId && r.week < c.week)
    let held = (byRoster.get(rosterId) ?? []).map((r) => ({ playerId: r.playerId, isStarter: r.isStarter as boolean | null }))
    if (unwind) {
      // Undo the trade: drop what this side got, put back what it gave (lineup unknown for a player put back).
      const got = new Set(c.rows[i]?.playersReceived ?? [])
      held = held.filter((r) => !got.has(r.playerId))
      const have = new Set(held.map((r) => r.playerId))
      for (const id of c.rows[i]?.playersGiven ?? []) if (!have.has(id)) { held.push({ playerId: id, isStarter: null }); have.add(id) }
    }
    const rosterBefore: TradeContextPlayer[] = held
      .map((r) => ({
        id: r.playerId,
        position: input.positions.get(r.playerId)?.position ?? null,
        team: input.positions.get(r.playerId)?.team ?? null,
        slot: null,
        starter: r.isStarter,
        reserve: null,
        taxi: null,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return {
      rosterId,
      managerId,
      record: {
        wins: results.filter((r) => r.win === 1).length,
        losses: results.filter((r) => r.win === 0).length,
        ties: results.filter((r) => r.win !== 0 && r.win !== 1).length,
        pointsFor: Math.round(results.reduce((n, r) => n + r.pointsFor, 0) * 100) / 100,
        pointsAgainst: results.length ? Math.round(results.reduce((n, r) => n + r.pointsAgainst, 0) * 100) / 100 : null,
        rank: null,
      },
      faabRemaining: null,
      waiverPriority: null,
      rosterBefore,
    }
  })

  const slots = rosterPositionsOf(input.league?.settings)
  const lagHours = c.tradeAt ? Math.round(((now.getTime() - c.tradeAt.getTime()) / 3_600_000) * 10) / 10 : null
  return {
    version: TRADE_CONTEXT_SNAPSHOT_VERSION,
    source: 'backfill_rebuilt',
    rosterBasis: unwind ? { kind: 'week1_unwound', week: rosterWeek } : { kind: 'weekly_rows', week: rosterWeek },
    provider: c.platform,
    capturedAt,
    tradeAt: c.tradeAt?.toISOString() ?? null,
    lagHours,
    movesUndone: 0,
    league: input.league
      ? ({
          sport: input.league.sport,
          season: c.season,
          leagueSize: input.league.leagueSize ?? undefined,
          scoring: input.league.scoring,
          isDynasty: input.league.isDynasty,
          ...(slots ? { roster_positions: slots } : {}),
        } as TradeContextSnapshot['league'])
      : { sport: c.sport.toUpperCase(), season: c.season },
    starterSlots: slotCounts(slots),
    scoring: null,
    sides: out,
  }
}

export type TradeContextBackfillDeps = {
  listCandidates: (limit: number, olderThan: Date) => Promise<BackfillCandidate[]>
  loadRosterRows: (leagueId: string, season: number, week: number) => Promise<WeeklyRosterRow[]>
  loadResultRows: (leagueId: string, season: number) => Promise<WeeklyResultRow[]>
  loadLeague: (leagueId: string) => Promise<StoredLeague | null>
  loadPositions: (sport: string, playerIds: string[]) => Promise<Map<string, { position: string | null; team: string | null }>>
  /** First capture wins: writes only rows whose context is still empty. Returns rows written. */
  save: (leagueId: string, transactionId: string, context: TradeContextSnapshot | BackfillUnavailable) => Promise<number>
  remainingMs: () => number
  now: () => Date
}

export type TradeContextBackfillResult = {
  off?: true
  considered: number
  rebuilt: number
  unavailable: Record<BackfillUnavailable['unavailable'], number>
  rowsWritten: number
  deferred: number
  errors: string[]
}

export async function backfillTradeContexts(
  deps: TradeContextBackfillDeps,
  env: NodeJS.ProcessEnv = process.env,
  limit = TRADE_CONTEXT_BACKFILL_LIMIT,
): Promise<TradeContextBackfillResult> {
  const result: TradeContextBackfillResult = {
    considered: 0, rebuilt: 0, unavailable: { one_side_stored: 0, no_trade_week: 0, no_roster_rows: 0 }, rowsWritten: 0, deferred: 0, errors: [],
  }
  if (String(env[TRADE_CONTEXT_BACKFILL_ENV] ?? '').trim().toLowerCase() === 'off') return { ...result, off: true }
  const now = deps.now()
  const candidates = await deps.listCandidates(limit, new Date(now.getTime() - TRADE_CONTEXT_BACKFILL_MIN_AGE_MS))
  result.considered = candidates.length

  // One read per league-season for results and settings, one per roster week — not per trade.
  const results = new Map<string, Promise<WeeklyResultRow[]>>()
  const leagues = new Map<string, Promise<StoredLeague | null>>()
  const rosters = new Map<string, Promise<WeeklyRosterRow[]>>()
  for (const c of candidates) {
    if (deps.remainingMs() < TRADE_CONTEXT_BACKFILL_MIN_RUNWAY_MS) {
      result.deferred += 1
      continue
    }
    try {
      const seasonKey = `${c.leagueId}:${c.season}`
      if (!results.has(seasonKey)) results.set(seasonKey, deps.loadResultRows(c.leagueId, c.season))
      if (!leagues.has(c.leagueId)) leagues.set(c.leagueId, deps.loadLeague(c.leagueId))
      const rosterWeek = rosterWeekFor(c.week)
      const weekKey = `${seasonKey}:${rosterWeek}`
      if (!rosters.has(weekKey)) rosters.set(weekKey, deps.loadRosterRows(c.leagueId, c.season, rosterWeek))
      const rosterRows = await rosters.get(weekKey)!
      // A player put back by the offseason unwind needs his position too.
      const ids = [...new Set([...rosterRows.map((r) => r.playerId), ...c.rows.flatMap((r) => r.playersGiven ?? [])])]
      const context = buildRebuiltTradeContext({
        candidate: c,
        rosterRows,
        resultRows: await results.get(seasonKey)!,
        league: await leagues.get(c.leagueId)!,
        positions: ids.length ? await deps.loadPositions(c.sport, ids) : new Map(),
        now,
      })
      result.rowsWritten += await deps.save(c.leagueId, c.transactionId, context)
      if ('unavailable' in context) result.unavailable[context.unavailable] += 1
      else result.rebuilt += 1
    } catch (err) {
      if (result.errors.length < 5) result.errors.push(`${c.leagueId}/${c.transactionId}: ${err instanceof Error ? err.message.slice(0, 120) : 'failed'}`)
    }
  }
  return result
}

/** The live dependencies. */
export function defaultTradeContextBackfillDeps(budget: { remainingMs: () => number }): TradeContextBackfillDeps {
  return {
    listCandidates: async (limit, olderThan) => {
      const keys = await prisma.$queryRaw<Array<{ league: string; tx: string }>>`
        SELECT h."sleeperLeagueId" AS league, lt."transactionId" AS tx
        FROM "LeagueTrade" lt JOIN "LeagueTradeHistory" h ON h.id = lt."historyId"
        WHERE (lt."contextSnapshot" IS NULL OR lt."contextSnapshot"->>'unavailable' = 'no_trade_week')
          AND lt."tradeDate" IS NOT NULL AND lt."tradeDate" < ${olderThan}
          -- An offseason trade waits for its season's week-1 rows, so it neither crowds the draw nor gets marked early.
          AND (lt.week > 1 OR EXISTS (
            SELECT 1 FROM league_player_weekly_scores w
            WHERE w."leagueId" = h."sleeperLeagueId" AND w."seasonYear" = lt.season AND w.week = 1))
        GROUP BY 1, 2
        ORDER BY max(lt."tradeDate") DESC
        LIMIT ${limit}`
      if (keys.length === 0) return []
      const rows = await prisma.leagueTrade.findMany({
        where: { OR: keys.map((k) => ({ transactionId: k.tx, history: { sleeperLeagueId: k.league } })) },
        select: {
          transactionId: true, season: true, week: true, tradeDate: true, platform: true, sport: true, partnerRosterId: true,
          playersGiven: true, playersReceived: true,
          history: { select: { sleeperLeagueId: true, sleeperUsername: true } },
        },
      })
      const byKey = new Map<string, BackfillCandidate>()
      for (const r of rows) {
        const key = `${r.history.sleeperLeagueId}\u0001${r.transactionId}`
        const c = byKey.get(key) ?? {
          leagueId: r.history.sleeperLeagueId, transactionId: r.transactionId, season: r.season, week: r.week,
          tradeAt: r.tradeDate, platform: r.platform, sport: r.sport, rows: [],
        }
        c.rows.push({
          managerId: r.history.sleeperUsername, partnerRosterId: r.partnerRosterId,
          playersGiven: tradePlayerIds(r.playersGiven), playersReceived: tradePlayerIds(r.playersReceived),
        })
        byKey.set(key, c)
      }
      // Newest first, as selected.
      return keys.flatMap((k) => byKey.get(`${k.league}\u0001${k.tx}`) ?? [])
    },
    loadRosterRows: async (leagueId, season, week) =>
      (await prisma.leaguePlayerWeeklyScore.findMany({
        where: { leagueId, seasonYear: season, week, rosterId: { not: null } },
        select: { playerId: true, rosterId: true, isStarter: true },
      })).map((r) => ({ playerId: r.playerId, rosterId: String(r.rosterId), isStarter: r.isStarter })),
    loadResultRows: async (leagueId, season) =>
      prisma.weeklyMatchup.findMany({
        where: { leagueId, seasonYear: season },
        select: { rosterId: true, week: true, win: true, pointsFor: true, pointsAgainst: true },
      }),
    loadLeague: async (leagueId) =>
      prisma.league.findFirst({
        where: { platformLeagueId: leagueId },
        orderBy: { season: 'desc' },
        select: { sport: true, season: true, leagueSize: true, scoring: true, isDynasty: true, leagueVariant: true, leagueType: true, settings: true },
      }),
    loadPositions: async (_sport, playerIds) => {
      const rows = await prisma.sportsPlayer.findMany({
        where: { sleeperId: { in: playerIds } },
        select: { sleeperId: true, position: true, team: true },
      })
      return new Map(rows.flatMap((r) => (r.sleeperId ? [[r.sleeperId, { position: r.position, team: r.team }] as const] : [])))
    },
    save: async (leagueId, transactionId, context) =>
      (await prisma.leagueTrade.updateMany({
        // First capture wins — except over the first version's `no_trade_week` marker, which this version can fill.
        where: {
          transactionId,
          history: { sleeperLeagueId: leagueId },
          OR: [{ contextSnapshot: { equals: Prisma.DbNull } }, { contextSnapshot: { path: ['unavailable'], equals: 'no_trade_week' } }],
        },
        data: { contextSnapshot: context as unknown as Prisma.InputJsonValue },
      })).count,
    remainingMs: budget.remainingMs,
    now: () => new Date(),
  }
}
