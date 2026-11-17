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
  opts: { sinceSeason: number },
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

  const meta = new Map<string, { name: string; position: string | null }>()
  for (const part of chunk([...ids])) {
    const players = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: part } },
      select: { sleeperId: true, name: true, position: true, source: true, fetchedAt: true },
      orderBy: { fetchedAt: 'desc' },
    })
    const authoritative = authoritativeRowsBySleeperId(players)
    for (const id of part) {
      const r = authoritative.get(id.trim().toLowerCase())
      if (r) meta.set(id, { name: r.name, position: r.position ?? null })
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

  return { byBook, lineupObservations, formatStamps, skipped, tradesConsidered: unique.size, tradesUsed }
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
}

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

async function writeBook(
  prisma: PrismaClient,
  concept: string,
  values: readonly CompletedTradeMarketValue[],
  generatedAt: Date,
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
      calculationVersion: FORMAT_CALCULATION_VERSION,
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
            calculationVersion: FORMAT_CALCULATION_VERSION,
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
  },
): Promise<{ books: BookResult[]; lineup: LineupFactorTable; lineupWritten: boolean; tradesUsed: number; tradesStamped: number; skipped: Record<string, number> }> {
  const dryRun = opts.dryRun !== false
  const generatedAt = opts.now ?? new Date()
  const gathered = await gatherFormatObservations(prisma, { sinceSeason: opts.sinceSeason })

  const books: BookResult[] = []
  const baselines = new Map<string, (v: number) => number>()
  for (const book of MARKET_BOOKS) {
    const key = bookKey(book)
    const gather = gathered.byBook.get(key)!
    baselines.set(key, tierBaselines(gather))
    const concept = bookConcept(book)
    if (opts.skipBooks?.has(key)) continue
    const { values, medianAdjustment } = computeBookValues(gather)
    const published = values.filter((v) => v.published).length
    const refused = !dryRun && opts.requireCentred === true && published > 0 && !isCentred(medianAdjustment) ? ('not_centred' as const) : null
    const written = !dryRun && refused === null ? await writeBook(prisma, concept, values, generatedAt) : 0
    books.push({ book, concept, evaluated: values.length, published, written, tradesUsed: gather.tradesUsed, medianAdjustment, refused })
  }

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
  return { books, lineup, lineupWritten, tradesUsed: gathered.tradesUsed, tradesStamped, skipped: gathered.skipped }
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
