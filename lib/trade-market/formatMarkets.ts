import { Prisma, type PrismaClient } from '@prisma/client'

import { leagueVariantFor, valueBookFor } from '@/lib/core-app/valueBook'
import { lineupProfileFromSettings, type LineupPosition, type LineupProfile } from '@/lib/league/lineupProfile'
import { authoritativeRowsBySleeperId } from '@/lib/player-match/authoritativePlayerRow'
import { normalizedFaabValue } from '@/lib/trade-value/faabValue'
import { loadLatestPlayerValueSnapshots, type LatestPlayerValueClient } from '@/lib/player-values/latestPlayerValueSnapshots'
import {
  attributeTrade,
  computeCompletedTradeValue,
  COMPLETED_SOURCE_VERSION,
  tierBaselines,
  type CompletedTradeGather,
  type CompletedTradeMarketValue,
  type CompletedTradeObservation,
} from './completedTradeObservations'
import { isCentred } from './sinceSeasonArg'
import {
  captureDayFor,
  computeDatedBook,
  datedLearnerLive,
  emptyDatedGather,
  recencyWeight,
  type DatedBookComparison,
  type DatedGather,
} from './datedMarketLearner'
import { computePickMarket, parsePicks, pickObservationFor, type PickMarket, type PickObservation } from './pickMarketLearner'
import {
  ageAtTrade,
  computePostureMarket,
  packageKind,
  postureOf,
  VETERAN_MIN_AGE,
  YOUTH_MAX_AGE,
  type PackagePart,
  type PostureMarket,
  type PostureObservation,
} from './postureMarketLearner'
import { FIRST_ROUND_IN_MARKET_UNITS, pickRoundShare } from '@/lib/pick-curve'

/**
 * The AllFantasy trade market, SPLIT BY THE FORMAT EACH TRADE WAS MADE IN.
 *
 * 🛑 THE SINGLE MARKET MEASURED EVERY TRADE AGAINST THE DYNASTY · 1QB CHART, AND MOST TRADES ARE NOT
 * 1QB. Measured on production 2026-11-11 over this season's trades with a readable lineup: 2,930 were
 * 1QB+superflex, 1,912 1QB, 425 superflex-only, 144 2QB, ~125 three-or-more-QB (incl. 4-QB leagues).
 * In a superflex league quarterbacks absorb value and everyone else is cheaper relative to them, so
 * reading those trades on the 1QB chart called QBs "rising" and everyone else "falling" for a reason
 * that had nothing to do with any player's market. Redraft-league trades were read on the DYNASTY
 * chart the same way, where rookies and veterans are priced on a different axis entirely.
 *
 * So every trade is now measured against the chart its own league is graded on — `valueBookFor`, the
 * exact rule the grade uses — and each book is its own market with its own tier baselines and its own
 * centring gate. A trade whose league cannot be identified, or whose lineup cannot be read, is LEFT OUT
 * and counted as such: an unknown format is not evidence about any of the four.
 *
 * ⚠ A PAST SEASON IS READ ON ITS OWN LINEUP. Sleeper issues a new league id every season and
 * `LeagueTradeHistory` keeps the season's id, so a 2024 trade never matches a current `League` row. It
 * matches `league_dynasty_seasons`, whose metadata keeps that season's own `rosterPositions` and Sleeper
 * type (`seasonLeagueRow`) — 100% of 2024 and 2025 trades, measured 2026-11-11, against ~16–19% when
 * the only route was `league_seasons` and today's settings. That route remains only as a last resort,
 * flagged `carried`.
 */

export type MarketBook = { format: 'DYNASTY' | 'REDRAFT'; qbFormat: 'ONE_QB' | 'SUPERFLEX' }

export const MARKET_BOOKS: readonly MarketBook[] = [
  { format: 'DYNASTY', qbFormat: 'ONE_QB' },
  { format: 'DYNASTY', qbFormat: 'SUPERFLEX' },
  { format: 'REDRAFT', qbFormat: 'ONE_QB' },
  { format: 'REDRAFT', qbFormat: 'SUPERFLEX' },
]

/** `AllFantasyMarketPlayerValue.leagueConcept` for a book. Distinct from the legacy `dynasty` rows. */
export function bookConcept(b: MarketBook): string {
  return `ct-${b.format.toLowerCase()}-${b.qbFormat === 'SUPERFLEX' ? 'sf' : '1qb'}`
}

export function bookKey(b: MarketBook): string {
  return `${b.format}:${b.qbFormat}`
}

const FORMAT_CALCULATION_VERSION = 'ct2.0'

type ResolvedTradeLeague = {
  /** Our `League.id` — the unit "distinct leagues" is counted in. */
  leagueKey: string
  book: MarketBook
  lineup: LineupProfile
  /** True when found only through `league_seasons`, i.e. read on today's settings rather than that season's. */
  carried: boolean
  /** The league's FAAB budget, for pricing FAAB that moved in a trade. Null when the league states none. */
  faabBudget: number | null
  /** Teams in the league, for reading a pick as the 12-team round it equals. Null when the settings do not say. */
  teams: number | null
  /**
   * `LeagueTrade.leagueFormat` as `comprehensive-trade-learning` reads it ('dynasty' | 'keeper' ⇒ the
   * dynasty chart). Derived from the BOOK, so a keeper league that prices on the redraft chart (low keeper
   * share) is written 'redraft' — the two readers then cannot disagree about which chart a trade is on.
   */
  tradeFormat: 'dynasty' | 'keeper' | 'redraft'
}

type LeagueRow = { id: string; platformLeagueId: string; settings: unknown; leagueType: string | null }

/** The FAAB budget a league's settings state, under any of the names importers use. */
export function faabBudgetFromSettings(settings: unknown): number | null {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  for (const key of ['waiver_budget', 'faab_budget', 'waiverBudget', 'faabBudget']) {
    const v = Number(s[key])
    if (Number.isFinite(v) && v > 0) return v
  }
  return null
}

/** Teams in a league, from its settings under any of the names importers use. */
export function teamsFromSettings(settings: unknown): number | null {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const nested = s.settings && typeof s.settings === 'object' ? (s.settings as Record<string, unknown>) : {}
  for (const v of [s.num_teams, s.total_rosters, s.numTeams, s.teams, s.leagueSize, nested.num_teams]) {
    const n = Number(v)
    if (Number.isInteger(n) && n >= 2 && n <= 64) return n
  }
  return null
}

const chunk = <T,>(xs: readonly T[], n = 1000): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** Pure: a stored league → its book and lineup, or null when either cannot be read. */
export function resolveLeague(row: LeagueRow, carried: boolean): ResolvedTradeLeague | null {
  const lineup = lineupProfileFromSettings(row.settings)
  if (!lineup || !lineup.qbClass) return null
  const vb = valueBookFor(row.settings, row.leagueType)
  const tradeFormat = vb.format === 'DYNASTY' ? (leagueVariantFor(row.settings, row.leagueType).keeper ? 'keeper' : 'dynasty') : 'redraft'
  return {
    leagueKey: row.id,
    book: { format: vb.format, qbFormat: vb.qbFormat },
    lineup,
    carried,
    faabBudget: faabBudgetFromSettings(row.settings),
    teams: teamsFromSettings(row.settings),
    tradeFormat,
  }
}

/**
 * Write `leagueFormat` / `isSuperFlex` onto stored trades that have none. Only EMPTY rows are touched —
 * nothing else sets these columns today, and a value someone did set is never overwritten.
 *
 * 🛑 WHY THIS MATTERS: `comprehensive-trade-learning` reads a null `leagueFormat` as REDRAFT and a null
 * `isSuperFlex` as 1QB, and no import path ever filled them — so it priced every dynasty and superflex
 * trade on the wrong chart. The format markets already resolve each trade's league (incl. past seasons
 * on their own settings), so they fill the columns as a by-product. Returns the rows updated.
 */
export async function stampTradeFormats(
  prisma: PrismaClient,
  stamps: ReadonlyArray<{ transactionId: string; tradeFormat: ResolvedTradeLeague['tradeFormat']; isSuperFlex: boolean }>,
): Promise<number> {
  const groups = new Map<string, string[]>()
  for (const s of stamps) {
    const key = `${s.tradeFormat}|${s.isSuperFlex}`
    const list = groups.get(key) ?? []
    list.push(s.transactionId)
    groups.set(key, list)
  }
  let updated = 0
  for (const [key, txIds] of groups) {
    const [leagueFormat, sf] = key.split('|')
    for (const ids of chunk(txIds)) {
      const r = await prisma.leagueTrade.updateMany({
        where: { transactionId: { in: ids }, leagueFormat: null },
        data: { leagueFormat, isSuperFlex: sf === 'true' },
      })
      updated += r.count
    }
  }
  return updated
}

/** Trade histories resolved per run by `stampAllTradeFormats`, drawn at random from those still unlabelled. */
export const STAMP_ALL_HISTORY_LIMIT = 5000

export type StampAllResult = { histories: number; resolved: number; unresolved: number; rowsStamped: number }

/**
 * EVERY TRADE'S LEAGUE TYPE, IN EVERY SEASON (owner's call, 2026-11-22 — the census "league-type gap").
 *
 * `stampTradeFormats` labels only the trades the market's own window reads (this season and the two before), so every
 * older trade kept a null `leagueFormat`: 11,761 of 29,808 NFL trades in the 2026-11-22 census, at least 10,898 of them
 * from 2018–2023. That is not a lookup failure — those leagues resolve like any other — and it is not harmless:
 * `comprehensive-trade-learning` reads null as REDRAFT and 1QB, and the history the next learner step reads is exactly
 * those seasons.
 *
 * So: trade histories still unlabelled, in any season, through the same three-step lookup the market uses
 * (`resolveTradeLeagues`: the current league, that season's own stored settings, then today's settings), labelled by
 * history. Only EMPTY rows are written, as before. A random draw of histories per run, so one that cannot be resolved
 * never holds a place ahead of the rest; the ones that resolve drop out of the draw, and the rest are said out loud.
 */
export async function stampAllTradeFormats(prisma: PrismaClient, limit = STAMP_ALL_HISTORY_LIMIT): Promise<StampAllResult> {
  const rows = await prisma.$queryRaw<Array<{ historyId: string }>>(Prisma.sql`
    SELECT "historyId" FROM (SELECT DISTINCT "historyId" FROM "LeagueTrade" WHERE "leagueFormat" IS NULL) h
    ORDER BY random() LIMIT ${limit}`)
  const ids = rows.map((r) => r.historyId).filter(Boolean)
  if (ids.length === 0) return { histories: 0, resolved: 0, unresolved: 0, rowsStamped: 0 }
  const leagues = await resolveTradeLeagues(prisma, ids)
  const groups = new Map<string, string[]>()
  for (const [historyId, league] of leagues) {
    const key = `${league.tradeFormat}|${league.book.qbFormat === 'SUPERFLEX'}`
    groups.set(key, [...(groups.get(key) ?? []), historyId])
  }
  let rowsStamped = 0
  for (const [key, historyIds] of groups) {
    const [leagueFormat, sf] = key.split('|')
    for (const part of chunk(historyIds)) {
      const r = await prisma.leagueTrade.updateMany({
        where: { historyId: { in: part }, leagueFormat: null },
        data: { leagueFormat, isSuperFlex: sf === 'true' },
      })
      rowsStamped += r.count
    }
  }
  return { histories: ids.length, resolved: leagues.size, unresolved: ids.length - leagues.size, rowsStamped }
}

/** Sleeper `settings.type`: 0 redraft, 1 keeper, 2 dynasty. */
const SLEEPER_LEAGUE_TYPE: Record<string, string> = { '0': 'redraft', '1': 'keeper', '2': 'dynasty' }

/**
 * A PAST SEASON of a league, on THAT season's own settings. PURE.
 *
 * `league_dynasty_seasons.metadata` holds what the historical import read for each season: its own
 * `rosterPositions` and Sleeper `rawSettings` (incl. `type` and `max_keepers`). Measured on production
 * 2026-11-11, every 2024 and 2025 trade's league has one — so an old trade is read on the lineup it was
 * actually made under, not on today's.
 *
 * The season's facts are laid OVER the current league's settings, so everything the season does not
 * record (a human-confirmed concept, specialty rules) still comes from the league — and
 * `resolveLeagueConcept` lets a confirmed concept win over the season's provider type, the same
 * precedence the grade uses. Null when the metadata carries no lineup.
 */
export function seasonLeagueRow(current: LeagueRow, seasonPlatformLeagueId: string, metadata: unknown): LeagueRow | null {
  const m = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : null
  const raw = Array.isArray(m?.rosterPositions) ? (m!.rosterPositions as unknown[]) : null
  if (!raw || raw.length === 0) return null
  // Sleeper stores one string per slot; other importers store `{ position, count }`.
  const entries = raw.map((e) =>
    e && typeof e === 'object' && !Array.isArray(e)
      ? `${String((e as Record<string, unknown>).position ?? '')}:${Number((e as Record<string, unknown>).count ?? 1)}`
      : e,
  )
  const rawSettings = m!.rawSettings && typeof m!.rawSettings === 'object' && !Array.isArray(m!.rawSettings) ? (m!.rawSettings as Record<string, unknown>) : {}
  const typeName = rawSettings.type != null ? SLEEPER_LEAGUE_TYPE[String(rawSettings.type)] : undefined
  const base = current.settings && typeof current.settings === 'object' && !Array.isArray(current.settings) ? (current.settings as Record<string, unknown>) : {}
  const settings: Record<string, unknown> = {
    ...base,
    roster_positions: entries,
    // `starter_slots` would otherwise shadow nothing (roster_positions is read first), but drop it so no
    // reader can mistake today's slots for that season's.
    starter_slots: undefined,
    ...(typeof rawSettings.max_keepers === 'number' ? { max_keepers: rawSettings.max_keepers } : {}),
    // That season's FAAB budget, so FAAB in a past trade is priced against the budget it was spent from.
    ...(typeof rawSettings.waiver_budget === 'number' ? { waiver_budget: rawSettings.waiver_budget } : {}),
    ...(typeName ? { isDynasty: typeName === 'dynasty' } : {}),
  }
  return { id: current.id, platformLeagueId: seasonPlatformLeagueId, settings, leagueType: typeName ?? current.leagueType }
}

/**
 * `LeagueTrade.historyId` → the league the trade happened in, in this order:
 *   1. a current league with that platform id (this season's trades);
 *   2. that SEASON's own settings from `league_dynasty_seasons` (`seasonLeagueRow`);
 *   3. `league_seasons` → the league's settings TODAY (`carried: true`), the last resort.
 */
async function resolveTradeLeagues(
  prisma: PrismaClient,
  historyIds: readonly string[],
): Promise<Map<string, ResolvedTradeLeague>> {
  const out = new Map<string, ResolvedTradeLeague>()
  const histories: Array<{ id: string; sleeperLeagueId: string }> = []
  for (const ids of chunk([...new Set(historyIds)])) {
    histories.push(...(await prisma.leagueTradeHistory.findMany({ where: { id: { in: ids } }, select: { id: true, sleeperLeagueId: true } })))
  }
  const pids = [...new Set(histories.map((h) => h.sleeperLeagueId))]
  const byPid = new Map<string, { row: LeagueRow; carried: boolean }>()
  for (const ids of chunk(pids)) {
    const rows = (await prisma.league.findMany({
      where: { platformLeagueId: { in: ids } },
      select: { id: true, platformLeagueId: true, settings: true, leagueType: true },
    })) as LeagueRow[]
    for (const r of rows) if (!byPid.has(r.platformLeagueId)) byPid.set(r.platformLeagueId, { row: r, carried: false })
  }

  // 2. Past seasons on their own settings.
  const pastSeasons = new Map<string, { leagueId: string; metadata: unknown }>()
  for (const ids of chunk(pids.filter((p) => !byPid.has(p)))) {
    const rows = await prisma.leagueDynastySeason.findMany({
      where: { platformLeagueId: { in: ids } },
      select: { platformLeagueId: true, leagueId: true, metadata: true },
      orderBy: { importedAt: 'desc' },
    })
    for (const r of rows) if (!pastSeasons.has(r.platformLeagueId)) pastSeasons.set(r.platformLeagueId, { leagueId: r.leagueId, metadata: r.metadata })
  }
  const pastLeagueIds = [...new Set([...pastSeasons.values()].map((s) => s.leagueId))]
  const currentById = new Map<string, LeagueRow>()
  for (const ids of chunk(pastLeagueIds)) {
    const rows = (await prisma.league.findMany({
      where: { id: { in: ids } },
      select: { id: true, platformLeagueId: true, settings: true, leagueType: true },
    })) as LeagueRow[]
    for (const r of rows) currentById.set(r.id, r)
  }
  for (const [pid, s] of pastSeasons) {
    const current = currentById.get(s.leagueId)
    const row = current ? seasonLeagueRow(current, pid, s.metadata) : null
    if (row) byPid.set(pid, { row, carried: false })
  }

  // 3. Last resort: today's settings for that league.
  const missing = pids.filter((p) => !byPid.has(p))
  const seasonMap = new Map<string, string>()
  for (const ids of chunk(missing)) {
    const seasons = await prisma.leagueSeason.findMany({ where: { platformLeagueId: { in: ids } }, select: { platformLeagueId: true, leagueId: true } })
    for (const s of seasons) if (!seasonMap.has(s.platformLeagueId)) seasonMap.set(s.platformLeagueId, s.leagueId)
  }
  const leagueIds = [...new Set(seasonMap.values())]
  const byId = new Map<string, LeagueRow>()
  for (const ids of chunk(leagueIds)) {
    const rows = (await prisma.league.findMany({
      where: { id: { in: ids } },
      select: { id: true, platformLeagueId: true, settings: true, leagueType: true },
    })) as LeagueRow[]
    for (const r of rows) byId.set(r.id, r)
  }
  for (const [pid, lid] of seasonMap) {
    const r = byId.get(lid)
    if (r) byPid.set(pid, { row: r, carried: true })
  }
  for (const h of histories) {
    const hit = byPid.get(h.sleeperLeagueId)
    const resolved = hit ? resolveLeague(hit.row, hit.carried) : null
    if (resolved) out.set(h.id, resolved)
  }
  return out
}

/** One player's appearance in one trade, kept for the lineup-factor measurement. */
export type LineupObservation = {
  book: MarketBook
  position: LineupPosition
  lineup: LineupProfile
  leagueKey: string
  transactionId: string
  chartValue: number
  observedValue: number
}

type FormatGather = {
  byBook: Map<string, CompletedTradeGather>
  /** The same trades measured on the chart of their own day (`datedMarketLearner.ts`), per book. */
  byBookDated: Map<string, DatedGather>
  /** Dynasty books only: one pick equation per trade with a pick in it, measured on the trade's day (`pickMarketLearner.ts`). */
  byBookPicks: Map<string, PickGather>
  /** Every book: one observation per side whose posture and purchase could be read (`postureMarketLearner.ts`). */
  byBookPosture: Map<string, PostureGather>
  lineupObservations: LineupObservation[]
  /** Every trade whose league resolved, with the format to stamp on it (`stampTradeFormats`). */
  formatStamps: Array<{ transactionId: string; tradeFormat: ResolvedTradeLeague['tradeFormat']; isSuperFlex: boolean }>
  skipped: Record<string, number>
  tradesConsidered: number
  tradesUsed: number
}

type TradeRow = {
  transactionId: string
  historyId: string
  season: number
  tradeDate: Date | null
  playersGiven: unknown
  playersReceived: unknown
  picksGiven: unknown
  picksReceived: unknown
  /** For the posture market: the week, the partner's roster, and the saved context with both sides' records. */
  week?: number | null
  partnerRosterId?: number | null
  contextSnapshot?: unknown
}

const asIds = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.length > 0) : []

/** One roster's side of one trade, as the Sleeper trade-fact sweep recorded it. */
type TradeFactSide = { faabIn: number; faabOut: number; playersInIds: string[]; playersOutIds: string[] }

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))

/**
 * The FAAB this trade row's own side sent and received, or null when it was not recorded. PURE.
 *
 * `LeagueTrade` stores one row per side but no roster id for its own side, so the side is found by its
 * PLAYERS: the fact whose players-out are this row's players-given and whose players-in are its
 * players-received. A trade with no recorded FAAB (the fact predates FAAB capture, or there is no fact)
 * returns null, and the caller prices it exactly as before — never as a known zero.
 */
export function faabForTradeRow(
  row: { playersGiven: unknown; playersReceived: unknown },
  sides: readonly TradeFactSide[] | undefined,
): { given: number; received: number } | null {
  if (!sides || sides.length === 0) return null
  const given = asIds(row.playersGiven)
  const received = asIds(row.playersReceived)
  const own = sides.filter((s) => sameSet(s.playersOutIds, given) && sameSet(s.playersInIds, received))
  // Two matching sides (both sent nothing but FAAB/picks) cannot be told apart: no claim.
  if (own.length !== 1) return null
  return { given: own[0]!.faabOut, received: own[0]!.faabIn }
}

/** Recorded FAAB per Sleeper transaction id — only facts written since FAAB capture carry `faabIn`. */
async function loadTradeFaab(prisma: PrismaClient, txIds: readonly string[]): Promise<Map<string, TradeFactSide[]>> {
  const out = new Map<string, TradeFactSide[]>()
  for (const ids of chunk([...new Set(txIds)])) {
    const rows = await prisma.$queryRaw<Array<{ tx: string; payload: Record<string, unknown> }>>(Prisma.sql`
      SELECT payload->>'sleeperTransactionId' AS tx, payload
      FROM dw_transaction_facts
      WHERE type = 'trade' AND payload ? 'faabIn' AND payload->>'sleeperTransactionId' = ANY(${ids}::text[])`)
    for (const r of rows) {
      const p = r.payload ?? {}
      const side: TradeFactSide = {
        faabIn: Number(p.faabIn) || 0,
        faabOut: Number(p.faabOut) || 0,
        playersInIds: asIds(p.playersInIds),
        playersOutIds: asIds(p.playersOutIds),
      }
      const list = out.get(r.tx) ?? []
      list.push(side)
      out.set(r.tx, list)
    }
  }
  return out
}

export async function gatherFormatObservations(
  prisma: PrismaClient,
  opts: { sinceSeason: number; now?: Date },
): Promise<FormatGather> {
  const skipped: Record<string, number> = {}
  const bump = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1)

  const rows = (await prisma.leagueTrade.findMany({
    where: { season: { gte: opts.sinceSeason }, sport: 'nfl' },
    select: {
      transactionId: true,
      historyId: true,
      season: true,
      tradeDate: true,
      playersGiven: true,
      playersReceived: true,
      picksGiven: true,
      picksReceived: true,
      week: true,
      partnerRosterId: true,
      contextSnapshot: true,
    },
  })) as TradeRow[]
  // ⚠ Every trade is stored once per side; one row describes the whole trade (see completedTradeObservations).
  const unique = new Map<string, TradeRow>()
  for (const t of rows) if (t.transactionId && !unique.has(t.transactionId)) unique.set(t.transactionId, t)

  const leagues = await resolveTradeLeagues(prisma, [...unique.values()].map((t) => t.historyId))
  // Best-effort: a FAAB read failure prices trades as before rather than failing the whole run.
  const faab = await loadTradeFaab(prisma, [...unique.keys()]).catch(() => new Map<string, TradeFactSide[]>())

  const ids = new Set<string>()
  for (const t of unique.values()) for (const id of [...asIds(t.playersGiven), ...asIds(t.playersReceived)]) ids.add(id)

  /*
   * The newest capture per player, per book — through the bounded helper. A `findMany` ordered by date
   * with no `take`/`distinct` reads every daily capture of every player in all four books just to keep
   * the first; `latest-player-value-snapshots.test.ts` guards against exactly that read.
   */
  const charts = new Map<string, Map<string, number>>()
  for (const b of MARKET_BOOKS) {
    const m = new Map<string, number>()
    for (const part of chunk([...ids])) {
      const snaps = await loadLatestPlayerValueSnapshots({
        sleeperIds: part,
        source: 'FANTASYCALC',
        format: b.format,
        qbFormat: b.qbFormat,
        client: prisma as unknown as LatestPlayerValueClient,
      })
      for (const s of snaps) if (!m.has(s.sleeperId)) m.set(s.sleeperId, Number(s.value))
    }
    charts.set(bookKey(b), m)
  }

  const meta = new Map<string, { name: string; position: string | null; age?: number | null }>()
  for (const part of chunk([...ids])) {
    const players = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: part } },
      select: { sleeperId: true, name: true, position: true, age: true, source: true, fetchedAt: true },
      orderBy: { fetchedAt: 'desc' },
    })
    const authoritative = authoritativeRowsBySleeperId(players)
    for (const id of part) {
      const r = authoritative.get(id.trim().toLowerCase())
      if (r) meta.set(id, { name: r.name, position: r.position ?? null, age: (r as { age?: number | null }).age ?? null })
    }
  }

  const byBook = new Map<string, CompletedTradeGather>()
  for (const b of MARKET_BOOKS) byBook.set(bookKey(b), { byPlayer: new Map(), skipped: {}, tradesConsidered: 0, tradesUsed: 0 })
  const lineupObservations: LineupObservation[] = []
  const formatStamps: FormatGather['formatStamps'] = []
  let tradesUsed = 0

  for (const t of unique.values()) {
    const league = leagues.get(t.historyId)
    if (!league) {
      bump('unknown_league_format')
      continue
    }
    formatStamps.push({ transactionId: t.transactionId, tradeFormat: league.tradeFormat, isSuperFlex: league.book.qbFormat === 'SUPERFLEX' })
    const key = bookKey(league.book)
    const gather = byBook.get(key)!
    gather.tradesConsidered++
    const chart = charts.get(key)!
    /*
     * FAAB, where it was recorded, priced on the league's own budget by the same linear formula the
     * grade uses with no live league state (`normalizedFaabValue`). Recorded-and-zero counts as known;
     * unrecorded is priced as before (no FAAB), and counted so the gap stays visible.
     */
    const faabMoved = faabForTradeRow(t, faab.get(t.transactionId))
    if (faabMoved == null) bump('faab_not_recorded')
    else if (faabMoved.given > 0 || faabMoved.received > 0) bump('faab_priced')
    const attributed = attributeTrade(t, chart, {
      allowPicks: league.book.format === 'DYNASTY',
      extraGiven: faabMoved ? normalizedFaabValue(faabMoved.given, league.faabBudget) : 0,
      extraReceived: faabMoved ? normalizedFaabValue(faabMoved.received, league.faabBudget) : 0,
    })
    if (attributed.kind === 'skip') {
      bump(attributed.reason)
      gather.skipped[attributed.reason] = (gather.skipped[attributed.reason] ?? 0) + 1
      continue
    }
    tradesUsed++
    gather.tradesUsed++
    for (const { id, own, observedValue } of attributed.records) {
      const entry =
        gather.byPlayer.get(id) ??
        { name: meta.get(id)?.name ?? null, position: meta.get(id)?.position ?? null, baseValue: own, observations: [] as CompletedTradeObservation[] }
      entry.observations.push({ transactionId: t.transactionId, playerId: id, observedValue, season: t.season, tradeDate: t.tradeDate })
      gather.byPlayer.set(id, entry)
      const pos = String(meta.get(id)?.position ?? '').toUpperCase()
      if (pos === 'QB' || pos === 'RB' || pos === 'WR' || pos === 'TE') {
        lineupObservations.push({
          book: league.book,
          position: pos,
          lineup: league.lineup,
          leagueKey: league.leagueKey,
          transactionId: t.transactionId,
          chartValue: own,
          observedValue,
        })
      }
    }
  }

  /*
   * THE SAME TRADES, MEASURED ON THEIR OWN DAY (`datedMarketLearner.ts`). A separate pass, so the current market above
   * is exactly what it was; a failure here leaves the dated market empty and says why, and costs the current one nothing.
   */
  const byBookDated = new Map<string, DatedGather>()
  for (const b of MARKET_BOOKS) byBookDated.set(bookKey(b), emptyDatedGather())
  const byBookPicks = new Map<string, PickGather>()
  for (const b of MARKET_BOOKS) if (b.format === 'DYNASTY') byBookPicks.set(bookKey(b), { observations: [], skipped: {} })
  const byBookPosture = new Map<string, PostureGather>()
  for (const b of MARKET_BOOKS) byBookPosture.set(bookKey(b), { observations: [], skipped: {} })
  try {
    await gatherDatedObservations(prisma, { unique, leagues, faab, meta, charts, byBookDated, byBookPicks, byBookPosture, now: opts.now ?? new Date() })
  } catch {
    for (const g of byBookDated.values()) g.skipped.dated_unavailable = (g.skipped.dated_unavailable ?? 0) + 1
    for (const g of byBookPicks.values()) g.skipped.dated_unavailable = (g.skipped.dated_unavailable ?? 0) + 1
    for (const g of byBookPosture.values()) g.skipped.dated_unavailable = (g.skipped.dated_unavailable ?? 0) + 1
  }

  return { byBook, byBookDated, byBookPicks, byBookPosture, lineupObservations, formatStamps, skipped, tradesConsidered: unique.size, tradesUsed }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Each trade measured on the capture nearest before its date (within two weeks), as a ratio of what the other side paid
 * to the player's own value that day, weighted by recency. One distinct-days read per book, one read per capture day
 * actually needed — never every daily capture of every player.
 */
async function gatherDatedObservations(
  prisma: PrismaClient,
  ctx: {
    unique: Map<string, TradeRow>
    leagues: Map<string, ResolvedTradeLeague>
    faab: Map<string, TradeFactSide[]>
    meta: Map<string, { name: string; position: string | null; age?: number | null }>
    charts: Map<string, Map<string, number>>
    byBookDated: Map<string, DatedGather>
    byBookPicks?: Map<string, PickGather>
    byBookPosture?: Map<string, PostureGather>
    now: Date
  },
): Promise<void> {
  const bump = (g: DatedGather, k: string) => (g.skipped[k] = (g.skipped[k] ?? 0) + 1)
  const days = new Map<string, number[]>()
  for (const b of MARKET_BOOKS) {
    const rows = await prisma.$queryRaw<Array<{ day: Date }>>(Prisma.sql`
      SELECT DISTINCT date_trunc('day', "capturedAt") AS day FROM "PlayerValueSnapshot"
      WHERE source = 'FANTASYCALC' AND format = ${b.format} AND "qbFormat" = ${b.qbFormat}
      ORDER BY 1`)
    days.set(bookKey(b), rows.map((r) => new Date(r.day).getTime()).filter(Number.isFinite))
  }

  const plan: Array<{ t: TradeRow; key: string; day: number; league: ResolvedTradeLeague }> = []
  const needed = new Map<string, Set<string>>()
  for (const t of ctx.unique.values()) {
    const league = ctx.leagues.get(t.historyId)
    if (!league) continue // counted by the current pass as unknown_league_format
    const key = bookKey(league.book)
    const g = ctx.byBookDated.get(key)!
    if (!t.tradeDate) {
      bump(g, 'undated')
      continue
    }
    const day = captureDayFor(days.get(key) ?? [], t.tradeDate)
    if (day == null) {
      bump(g, 'no_dated_chart')
      continue
    }
    const dk = `${key}|${day}`
    const ids = needed.get(dk) ?? new Set<string>()
    for (const id of [...asIds(t.playersGiven), ...asIds(t.playersReceived)]) ids.add(id)
    needed.set(dk, ids)
    plan.push({ t, key, day, league })
  }

  const dated = new Map<string, Map<string, number>>()
  for (const [dk, ids] of needed) {
    const [key, dayStr] = dk.split('|') as [string, string]
    const book = MARKET_BOOKS.find((b) => bookKey(b) === key)!
    const day = Number(dayStr)
    const m = new Map<string, number>()
    for (const part of chunk([...ids])) {
      const rows = await prisma.playerValueSnapshot.findMany({
        where: { source: 'FANTASYCALC', format: book.format, qbFormat: book.qbFormat, sleeperId: { in: part }, capturedAt: { gte: new Date(day), lt: new Date(day + DAY_MS) } },
        // One row per player — that day's newest capture — never his whole history (latest-player-value-snapshots guard).
        distinct: ['sleeperId'],
        orderBy: [{ sleeperId: 'asc' }, { capturedAt: 'desc' }],
        select: { sleeperId: true, value: true },
      })
      for (const r of rows) if (!m.has(r.sleeperId)) m.set(r.sleeperId, Number(r.value))
    }
    dated.set(dk, m)
  }

  for (const { t, key, day, league } of plan) {
    const g = ctx.byBookDated.get(key)!
    const faabMoved = faabForTradeRow(t, ctx.faab.get(t.transactionId))
    const pickGather = ctx.byBookPicks?.get(key)
    if (pickGather && t.tradeDate) {
      // The same trade, read for what its picks were worth: its players on the same day's chart, FAAB the same way.
      const chartOfDay = dated.get(`${key}|${day}`)!
      const given = asIds(t.playersGiven)
      const received = asIds(t.playersReceived)
      const obs = [...given, ...received].every((id) => chartOfDay.has(id))
        ? pickObservationFor({
            transactionId: t.transactionId,
            tradeDate: t.tradeDate,
            teams: league.teams,
            picksGiven: t.picksGiven,
            picksReceived: t.picksReceived,
            playersGivenValue: given.reduce((n, id) => n + (chartOfDay.get(id) ?? 0), 0),
            playersReceivedValue: received.reduce((n, id) => n + (chartOfDay.get(id) ?? 0), 0),
            faabGivenValue: faabMoved ? normalizedFaabValue(faabMoved.given, league.faabBudget) : 0,
            faabReceivedValue: faabMoved ? normalizedFaabValue(faabMoved.received, league.faabBudget) : 0,
            weight: recencyWeight(t.tradeDate, ctx.now),
          })
        : ('unpriced_player' as const)
      if (typeof obs === 'object') {
        pickGather.observations.push(obs)
        if (league.teams == null) pickGather.skipped.teams_assumed_12 = (pickGather.skipped.teams_assumed_12 ?? 0) + 1
      } else if (obs !== 'no_picks') pickGather.skipped[obs] = (pickGather.skipped[obs] ?? 0) + 1
    }
    const postureGather = ctx.byBookPosture?.get(key)
    if (postureGather && t.tradeDate) {
      const read = postureObservationsFor(t, dated.get(`${key}|${day}`)!, ctx.meta, faabMoved, league, recencyWeight(t.tradeDate, ctx.now), ctx.now)
      if (Array.isArray(read)) postureGather.observations.push(...read)
      else postureGather.skipped[read] = (postureGather.skipped[read] ?? 0) + 1
    }
    const attributed = attributeTrade(t, dated.get(`${key}|${day}`)!, {
      allowPicks: league.book.format === 'DYNASTY',
      extraGiven: faabMoved ? normalizedFaabValue(faabMoved.given, league.faabBudget) : 0,
      extraReceived: faabMoved ? normalizedFaabValue(faabMoved.received, league.faabBudget) : 0,
    })
    if (attributed.kind === 'skip') {
      bump(g, attributed.reason)
      continue
    }
    const today = ctx.charts.get(key)!
    const weight = recencyWeight(t.tradeDate, ctx.now)
    let used = false
    for (const { id, own, observedValue } of attributed.records) {
      const baseValue = today.get(id)
      // The ratio is applied to TODAY's value, so a player off today's board has nowhere to land.
      if (!baseValue || baseValue <= 0 || own <= 0) continue
      const entry = g.byPlayer.get(id) ?? { name: ctx.meta.get(id)?.name ?? null, position: ctx.meta.get(id)?.position ?? null, baseValue, observations: [] }
      entry.observations.push({ transactionId: t.transactionId, ratio: observedValue / own, weight })
      g.byPlayer.set(id, entry)
      used = true
    }
    if (used) g.tradesUsed++
    else bump(g, 'off_todays_board')
  }
}

// ─── Lineup factors ─────────────────────────────────────────────────────────────────────────────────

type LineupBucket = 'low' | 'high'

type LineupFactor = {
  position: LineupPosition
  bucket: LineupBucket
  /** low: the league's starters at this position are BELOW `bound`; high: ABOVE it. */
  bound: number
  /** Multiplier on the chart value, measured. 1.08 = trades 8% higher than in usual lineups. */
  factor: number
  observations: number
  leagues: number
  trades: number
  standardObservations: number
  published: boolean
  /** Why it is or is not published, in words. */
  note: string
}

export type LineupFactorTable = {
  generatedAt: string
  sinceSeason: number
  /** The "usual" band per position: starters per team from `low` to `high` inclusive. */
  usual: Record<LineupPosition, { low: number; high: number }>
  factors: LineupFactor[]
}

/** Thresholds for publishing a lineup factor. A factor is a claim about a whole format, so it needs breadth. */
const LINEUP_MIN_OBSERVATIONS = 100
const LINEUP_MIN_LEAGUES = 8
const LINEUP_MIN_STANDARD = 200
const LINEUP_FACTOR_MIN = 0.8
const LINEUP_FACTOR_MAX = 1.25

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]!
}

/** How many starters at `position` a lineup has, on the axis the factor is measured on. */
export function lineupDemand(lineup: LineupProfile, position: LineupPosition): number {
  // Quarterbacks are counted in whole starters (QB + superflex): the format split already separates 1 from 2.
  return position === 'QB' ? lineup.qbDemand : lineup.demand[position]
}

/**
 * Measure, per position, how much more (or less) a player trades for in leagues that start more (or
 * fewer) of his position than usual. PURE.
 *
 * Each observation is first normalised by its own book's tier baseline (`tierBaselines`), so a bucket
 * full of stars is not mistaken for a premium — the same correction the per-player market makes. The
 * factor is the median normalised ratio in the bucket over the median in the usual band, and it is
 * published only with `LINEUP_MIN_*` breadth behind it.
 *
 * ⚠ QUARTERBACKS ARE MEASURED INSIDE THE SUPERFLEX BOOK ONLY: 3+ QB lineups (incl. 4-QB) against
 * 2-QB lineups. Their 1QB / superflex difference is the chart split itself, not a lineup factor.
 */
export function computeLineupFactors(
  observations: readonly LineupObservation[],
  baselineFor: (book: MarketBook, chartValue: number) => number,
  meta: { sinceSeason: number; now?: Date },
): LineupFactorTable {
  const positions: LineupPosition[] = ['QB', 'RB', 'WR', 'TE']
  const usual = {} as LineupFactorTable['usual']
  const factors: LineupFactor[] = []

  for (const position of positions) {
    const obs = observations.filter((o) => o.position === position && (position !== 'QB' || o.book.qbFormat === 'SUPERFLEX'))
    if (obs.length === 0) {
      usual[position] = { low: 0, high: 0 }
      continue
    }
    const demands = obs.map((o) => lineupDemand(o.lineup, position))
    const band = position === 'QB' ? { low: 2, high: 2 } : { low: quantile(demands, 0.25), high: quantile(demands, 0.75) }
    usual[position] = band
    const ratio = (o: LineupObservation) => o.observedValue / o.chartValue / (baselineFor(o.book, o.chartValue) || 1)
    const standard = obs.filter((o) => {
      const d = lineupDemand(o.lineup, position)
      return d >= band.low && d <= band.high
    })
    const standardMedian = median(standard.map(ratio))

    for (const bucket of ['low', 'high'] as const) {
      if (position === 'QB' && bucket === 'low') continue
      const inBucket = obs.filter((o) => {
        const d = lineupDemand(o.lineup, position)
        return bucket === 'low' ? d < band.low : d > band.high
      })
      const leagues = new Set(inBucket.map((o) => o.leagueKey)).size
      const trades = new Set(inBucket.map((o) => o.transactionId)).size
      const bucketMedian = median(inBucket.map(ratio))
      const raw = bucketMedian != null && standardMedian != null && standardMedian > 0 ? bucketMedian / standardMedian : null
      const factor = raw == null ? 1 : Math.round(Math.min(LINEUP_FACTOR_MAX, Math.max(LINEUP_FACTOR_MIN, raw)) * 1000) / 1000
      const short: string[] = []
      if (inBucket.length < LINEUP_MIN_OBSERVATIONS) short.push(`${inBucket.length} of ${LINEUP_MIN_OBSERVATIONS} player-trades`)
      if (leagues < LINEUP_MIN_LEAGUES) short.push(`${leagues} of ${LINEUP_MIN_LEAGUES} leagues`)
      if (standard.length < LINEUP_MIN_STANDARD) short.push(`${standard.length} of ${LINEUP_MIN_STANDARD} usual-lineup player-trades`)
      const published = short.length === 0 && raw != null
      factors.push({
        position,
        bucket,
        bound: bucket === 'low' ? band.low : band.high,
        factor,
        observations: inBucket.length,
        leagues,
        trades,
        standardObservations: standard.length,
        published,
        note: published
          ? `measured across ${trades} trades in ${leagues} leagues`
          : `not enough evidence yet (${short.join(', ') || 'no comparable trades'})`,
      })
    }
  }
  return { generatedAt: (meta.now ?? new Date()).toISOString(), sinceSeason: meta.sinceSeason, usual, factors }
}

export const LINEUP_FACTORS_CACHE_KEY = 'af-trade-market:lineup-factors:NFL'

// ─── The write ──────────────────────────────────────────────────────────────────────────────────────

export type BookResult = {
  book: MarketBook
  concept: string
  evaluated: number
  published: number
  written: number
  tradesUsed: number
  medianAdjustment: number | null
  refused: 'not_centred' | null
  /** Which market was published: `current` (today's chart) or `dated` (`TRADE_MARKET_LEARNER=dated`). */
  learner?: 'current' | 'dated'
  /** The dated market for this book and its gap to the current one — computed every run, published only when live. */
  dated?: DatedBookComparison
}

/** One dynasty book's learned pick values (shadow — stored, read by nothing yet). */
export type PickBookResult = { book: MarketBook; concept: string } & PickMarket & { skipped: Record<string, number> }

/** Per-book values from one gather. PURE. */
function computeBookValues(gather: CompletedTradeGather): { values: CompletedTradeMarketValue[]; medianAdjustment: number | null } {
  const baselineFor = tierBaselines(gather)
  const values = [...gather.byPlayer.entries()].map(([playerId, e]) =>
    computeCompletedTradeValue({
      playerId,
      playerName: e.name,
      position: e.position,
      baseValue: e.baseValue,
      observations: e.observations,
      tierBaselineRatio: baselineFor(e.baseValue),
    }),
  )
  const adj = values.filter((v) => v.published).map((v) => v.adjustmentPercent).sort((a, b) => a - b)
  return { values, medianAdjustment: adj.length ? adj[Math.floor(adj.length / 2)]! : null }
}

/** The dated market's rows carry their own version, so a row's model is recoverable from the row. */
const DATED_CALCULATION_VERSION = 'ct3.0-dated'

async function writeBook(
  prisma: PrismaClient,
  concept: string,
  values: readonly CompletedTradeMarketValue[],
  generatedAt: Date,
  calculationVersion: string = FORMAT_CALCULATION_VERSION,
): Promise<number> {
  const sport = 'NFL'
  let written = 0
  for (const v of values) {
    if (!v.published) continue
    const where = { sport_leagueConcept_playerId: { sport, leagueConcept: concept, playerId: v.playerId } }
    const existing = await prisma.allFantasyMarketPlayerValue.findUnique({ where, select: { id: true, marketValue: true, adjustmentPercent: true } }).catch(() => null)
    const data = {
      playerName: v.playerName,
      position: v.position,
      baseValue: v.baseValue,
      marketValue: v.marketValue,
      adjustmentPercent: v.adjustmentPercent,
      adjustmentPoints: v.adjustmentPoints,
      confidence: v.confidence,
      sampleSize: v.sampleSize,
      acceptedTradeCount: v.sampleSize,
      // Structurally zero: completed trades only — there is no declined offer to count.
      rejectedSignalCount: 0,
      vetoedSignalCount: 0,
      blockSignalCount: 0,
      interestSignalCount: 0,
      recentSignalCount: v.sampleSize,
      direction: v.direction,
      published: v.published,
      sourceVersion: COMPLETED_SOURCE_VERSION,
      calculationVersion,
      reasons: v.reasons as unknown as object,
      generatedAt,
    }
    const row = await prisma.allFantasyMarketPlayerValue.upsert({ where, create: { sport, leagueConcept: concept, playerId: v.playerId, ...data }, update: data })
    written++
    if (!existing || existing.marketValue !== row.marketValue) {
      await prisma.allFantasyMarketValueAudit
        .create({
          data: {
            marketValueId: row.id,
            sport,
            leagueConcept: concept,
            playerId: v.playerId,
            previousValue: existing?.marketValue ?? null,
            newValue: row.marketValue,
            previousAdjustmentPercent: existing?.adjustmentPercent ?? null,
            newAdjustmentPercent: row.adjustmentPercent,
            confidence: row.confidence,
            sampleSize: row.sampleSize,
            reasonSummary: v.reasons as unknown as object,
            calculationVersion,
            generatedAt,
          },
        })
        .catch(() => null)
    }
  }
  return written
}

/**
 * One gather → four book markets (each centring-gated on its OWN population) + the lineup factor table.
 * DRY-RUN BY DEFAULT. Writes only `AllFantasyMarketPlayerValue`, its audit, and one `SportsDataCache` row.
 *
 * `skipBooks` lets the scheduled caller widen the window only for books an earlier window could not
 * publish, without rewriting the books it already did.
 */
export async function recalculateFormatMarkets(
  prisma: PrismaClient,
  opts: {
    sinceSeason: number
    dryRun?: boolean
    requireCentred?: boolean
    skipBooks?: ReadonlySet<string>
    writeLineupFactors?: boolean
    /** Also fill empty `LeagueTrade.leagueFormat` / `isSuperFlex` for every resolved trade (`stampTradeFormats`). */
    stampTrades?: boolean
    now?: Date
    env?: NodeJS.ProcessEnv
  },
): Promise<{ books: BookResult[]; pickMarkets: PickBookResult[]; postureMarkets: PostureBookResult[]; lineup: LineupFactorTable; lineupWritten: boolean; tradesUsed: number; tradesStamped: number; skipped: Record<string, number> }> {
  const dryRun = opts.dryRun !== false
  const generatedAt = opts.now ?? new Date()
  const gathered = await gatherFormatObservations(prisma, { sinceSeason: opts.sinceSeason, now: generatedAt })
  const datedLive = datedLearnerLive(opts.env)

  const books: BookResult[] = []
  const baselines = new Map<string, (v: number) => number>()
  for (const book of MARKET_BOOKS) {
    const key = bookKey(book)
    const gather = gathered.byBook.get(key)!
    baselines.set(key, tierBaselines(gather))
    const concept = bookConcept(book)
    if (opts.skipBooks?.has(key)) continue
    const current = computeBookValues(gather)
    const datedBook = computeDatedBook(gathered.byBookDated.get(key)!, current.values)
    // ⚠ The same centring gate, on the median of whichever market is being published.
    const values = datedLive ? datedBook.values : current.values
    const medianAdjustment = datedLive ? datedBook.comparison.medianAdjustment : current.medianAdjustment
    const tradesUsed = datedLive ? datedBook.comparison.tradesUsed : gather.tradesUsed
    const published = values.filter((v) => v.published).length
    const refused = !dryRun && opts.requireCentred === true && published > 0 && !isCentred(medianAdjustment) ? ('not_centred' as const) : null
    const written = !dryRun && refused === null ? await writeBook(prisma, concept, values, generatedAt, datedLive ? DATED_CALCULATION_VERSION : FORMAT_CALCULATION_VERSION) : 0
    books.push({ book, concept, evaluated: values.length, published, written, tradesUsed, medianAdjustment, refused, learner: datedLive ? 'dated' : 'current', dated: datedBook.comparison })
  }
  // Every dynasty book, skipped or not: the pick market is its own measurement, and the caller decides which window to keep.
  const pickMarkets: PickBookResult[] = pickLearnerOn(opts.env)
    ? MARKET_BOOKS.flatMap((book) => {
        const g = gathered.byBookPicks.get(bookKey(book))
        return g ? [{ book, concept: bookConcept(book), ...computePickMarket(g.observations, generatedAt), skipped: g.skipped }] : []
      })
    : []
  const postureMarkets: PostureBookResult[] = postureLearnerOn(opts.env)
    ? MARKET_BOOKS.flatMap((book) => {
        const g = gathered.byBookPosture.get(bookKey(book))
        return g ? [{ book, concept: bookConcept(book), ...computePostureMarket(g.observations, generatedAt), skipped: g.skipped }] : []
      })
    : []

  const lineup = computeLineupFactors(
    gathered.lineupObservations,
    (book, chartValue) => baselines.get(bookKey(book))?.(chartValue) ?? 1,
    { sinceSeason: opts.sinceSeason, now: generatedAt },
  )
  let lineupWritten = false
  if (!dryRun && opts.writeLineupFactors !== false) {
    await writeLineupFactorTable(prisma, lineup)
    lineupWritten = true
  }
  // Best-effort and last: a stamping failure must never cost the markets this run already wrote.
  const tradesStamped = !dryRun && opts.stampTrades ? await stampTradeFormats(prisma, gathered.formatStamps).catch(() => 0) : 0
  return { books, pickMarkets, postureMarkets, lineup, lineupWritten, tradesUsed: gathered.tradesUsed, tradesStamped, skipped: gathered.skipped }
}

/** One book's posture observations and why the rest were not used. */
type PostureGather = { observations: PostureObservation[]; skipped: Record<string, number> }

type SnapshotSide = { rosterId?: unknown; record?: { wins?: unknown; losses?: unknown; ties?: unknown } | null }

/**
 * Both sides of one trade, read for posture: each side's record from the saved context, what it bought, and what it
 * paid on the trade day's chart (players on that chart, picks on the curve, FAAB on the league's budget). PURE.
 * The row is one side; its partner's roster id names the other side in the context, so the row's own side is the
 * context side that is NOT the partner.
 */
export function postureObservationsFor(
  t: Pick<TradeRow, 'transactionId' | 'tradeDate' | 'week' | 'partnerRosterId' | 'contextSnapshot' | 'playersGiven' | 'playersReceived' | 'picksGiven' | 'picksReceived'>,
  chart: ReadonlyMap<string, number>,
  meta: ReadonlyMap<string, { age?: number | null }>,
  faabMoved: { given: number; received: number } | null,
  league: Pick<ResolvedTradeLeague, 'faabBudget'>,
  weight: number,
  now: Date,
): PostureObservation[] | 'no_context' | 'no_posture' | 'unpriced_player' | 'mixed_package' {
  const snap = t.contextSnapshot && typeof t.contextSnapshot === 'object' ? (t.contextSnapshot as { sides?: SnapshotSide[]; unavailable?: unknown }) : null
  const sides = snap && !snap.unavailable && Array.isArray(snap.sides) ? snap.sides : null
  if (!sides || sides.length !== 2 || t.partnerRosterId == null || !t.tradeDate) return 'no_context'
  const partner = sides.find((s) => String(s.rosterId) === String(t.partnerRosterId))
  const own = sides.find((s) => s !== partner)
  if (!partner || !own) return 'no_context'
  const rec = (s: SnapshotSide) => s.record ? { wins: Number(s.record.wins) || 0, losses: Number(s.record.losses) || 0, ties: Number(s.record.ties) || 0 } : null
  const week = Number(t.week ?? 0)
  const ownPosture = postureOf(rec(own), week)
  const partnerPosture = postureOf(rec(partner), week)
  if (!ownPosture && !partnerPosture) return 'no_posture'

  const tradeDate = t.tradeDate
  const players = (raw: unknown) => asIds(raw)
  const given = players(t.playersGiven)
  const received = players(t.playersReceived)
  if (![...given, ...received].every((id) => chart.has(id))) return 'unpriced_player'
  const partsOf = (ids: string[], picksRaw: unknown, faab: number): PackagePart[] | null => {
    const picks = parsePicks(picksRaw)
    if (picks == null) return null
    const parts: PackagePart[] = ids.map((id) => {
      const age = ageAtTrade(meta.get(id)?.age ?? null, tradeDate, now)
      const kind = age == null ? 'other' : age >= VETERAN_MIN_AGE ? 'veteran' : age <= YOUTH_MAX_AGE ? 'youth' : 'other'
      return { kind, value: chart.get(id) ?? 0 }
    })
    for (const p of picks) parts.push({ kind: 'picks', value: FIRST_ROUND_IN_MARKET_UNITS * pickRoundShare(p.round) })
    if (faab > 0) parts.push({ kind: 'other', value: normalizedFaabValue(faab, league.faabBudget) })
    return parts
  }
  const gaveParts = partsOf(given, t.picksGiven, faabMoved?.given ?? 0)
  const gotParts = partsOf(received, t.picksReceived, faabMoved?.received ?? 0)
  if (!gaveParts || !gotParts) return 'unpriced_player'
  const total = (ps: PackagePart[]) => ps.reduce((n, p) => n + p.value, 0)
  const gave = total(gaveParts)
  const got = total(gotParts)
  if (!(gave > 0) || !(got > 0)) return 'unpriced_player'

  const out: PostureObservation[] = []
  // The row's side bought what it received and paid what it gave; its partner the other way round.
  const ownBought = packageKind(gotParts)
  if (ownPosture && ownBought) out.push({ transactionId: t.transactionId, buyer: ownPosture, bought: ownBought, ratio: gave / got, weight })
  const partnerBought = packageKind(gaveParts)
  if (partnerPosture && partnerBought) out.push({ transactionId: t.transactionId, buyer: partnerPosture, bought: partnerBought, ratio: got / gave, weight })
  return out.length ? out : 'mixed_package'
}

/** One book's posture premiums (shadow — stored, read by nothing yet). */
export type PostureBookResult = { book: MarketBook; concept: string } & PostureMarket & { skipped: Record<string, number> }

/** `TRADE_POSTURE_LEARNER=off` stops the posture market being computed or stored. */
export const TRADE_POSTURE_LEARNER_ENV = 'TRADE_POSTURE_LEARNER'
export function postureLearnerOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[TRADE_POSTURE_LEARNER_ENV] ?? '').trim().toLowerCase() !== 'off'
}

export const POSTURE_MARKET_CACHE_KEY = 'af-trade-market:posture-premiums:NFL'

/** Store the posture premiums, per book, for 21 days. Shadow: nothing reads this key yet. */
export async function writePostureMarketTable(prisma: PrismaClient, markets: readonly PostureBookResult[], generatedAt: Date): Promise<void> {
  const expiresAt = new Date(generatedAt.getTime() + 21 * 24 * 60 * 60 * 1000)
  const data = { generatedAt: generatedAt.toISOString(), books: markets.map((m) => ({ ...m, book: bookKey(m.book) })) }
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: POSTURE_MARKET_CACHE_KEY },
    create: { cacheKey: POSTURE_MARKET_CACHE_KEY, expiresAt, data: data as unknown as object },
    update: { expiresAt, data: data as unknown as object },
  })
}

/** One dynasty book's pick equations and why the rest were not used. */
type PickGather = { observations: PickObservation[]; skipped: Record<string, number> }

/** `TRADE_PICK_LEARNER=off` stops the pick market being computed or stored. */
export const TRADE_PICK_LEARNER_ENV = 'TRADE_PICK_LEARNER'
export function pickLearnerOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[TRADE_PICK_LEARNER_ENV] ?? '').trim().toLowerCase() !== 'off'
}

export const PICK_MARKET_CACHE_KEY = 'af-trade-market:pick-values:NFL'

/** Store the learned pick values, per dynasty book, for 21 days. Shadow: nothing reads this key yet. */
export async function writePickMarketTable(prisma: PrismaClient, markets: readonly PickBookResult[], generatedAt: Date): Promise<void> {
  const expiresAt = new Date(generatedAt.getTime() + 21 * 24 * 60 * 60 * 1000)
  const data = { generatedAt: generatedAt.toISOString(), books: markets.map((m) => ({ ...m, book: bookKey(m.book) })) }
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: PICK_MARKET_CACHE_KEY },
    create: { cacheKey: PICK_MARKET_CACHE_KEY, expiresAt, data: data as unknown as object },
    update: { expiresAt, data: data as unknown as object },
  })
}

/** Store the lineup factor table for 21 days — the same horizon the per-player market is trusted for. */
export async function writeLineupFactorTable(prisma: PrismaClient, table: LineupFactorTable): Promise<void> {
  const expiresAt = new Date(Date.parse(table.generatedAt) + 21 * 24 * 60 * 60 * 1000)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: LINEUP_FACTORS_CACHE_KEY },
    create: { cacheKey: LINEUP_FACTORS_CACHE_KEY, expiresAt, data: table as unknown as object },
    update: { expiresAt, data: table as unknown as object },
  })
}
