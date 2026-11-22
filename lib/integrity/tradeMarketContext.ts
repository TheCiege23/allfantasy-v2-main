import type { AuditRow } from './tradeAudit'
import { bookKey } from '@/lib/trade-market/formatMarkets'
import { learnedPickAdjustment, loadLearnedTables, type LearnedTables } from '@/lib/trade-market/learnedInGrades'
import { parsePicks, type ParsedPick } from '@/lib/trade-market/pickMarketLearner'

/**
 * THE MARKET BESIDE A REVIEWED TRADE (owner's call, 2026-11-22: "commissioner trade review against the market").
 *
 * The commissioner's trade history review already says what each side sent, what it was worth when it happened, and
 * whether that sat inside the fair range (`tradeAudit.ts`). This adds the context a commissioner needs to read a wide
 * gap, as FACTS — never a verdict, never a label on a manager:
 *
 *   HOW UNUSUAL   the share of audited trades across AllFantasy whose value gap was at least this wide.
 *   THE RECORDS   each side's record at the trade, from the context the live sync saved — a 7-2 team paying up for a
 *                 veteran is a different trade from a 2-7 team doing it, and the review should say which it was.
 *   THE PICKS     for a dynasty trade, what the AllFantasy pick market says picks like the ones sent cost, against the
 *                 curve the audit priced them on (`learnedInGrades.learnedPickAdjustment`, published entries only).
 *
 * Anything that cannot be read is left out, not guessed: a trade with no saved context has no records line, and a
 * redraft trade has no pick line. Read-only.
 */

/** Below this many audited trades, a share is not worth stating. */
export const RARITY_MIN_TRADES = 50
/** Gaps are counted in buckets this wide, so "at least N%" is stated at the bucket's floor. */
export const RARITY_BUCKET_PCT = 5

export type GapDistribution = { total: number; atLeast: (pct: number) => number }

/** A distribution from `{ bucket, count }` rows (bucket = floor(|gap| / RARITY_BUCKET_PCT)). PURE. */
export function gapDistribution(rows: ReadonlyArray<{ bucket: number; count: number }>): GapDistribution {
  const clean = rows.filter((r) => Number.isFinite(r.bucket) && r.bucket >= 0 && r.count > 0)
  const total = clean.reduce((n, r) => n + r.count, 0)
  return {
    total,
    atLeast: (pct) => {
      const b = Math.floor(Math.abs(pct) / RARITY_BUCKET_PCT)
      return clean.filter((r) => r.bucket >= b).reduce((n, r) => n + r.count, 0)
    },
  }
}

export type SideFacts = {
  record: { wins: number; losses: number; ties: number } | null
  /** Picks this side SENT in the trade. */
  picksSent: ParsedPick[]
}

export type TradeFacts = {
  tradeDate: Date | null
  /** The market book the trade was in ("DYNASTY:SUPERFLEX"), or null when its format was never resolved. */
  book: string | null
  dynasty: boolean
  teams: number | null
  a: SideFacts | null
  b: SideFacts | null
}

const recordText = (r: { wins: number; losses: number; ties: number }) => {
  const games = r.wins + r.losses + r.ties
  const pct = games > 0 ? (r.wins + 0.5 * r.ties) / games : null
  return `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}${pct == null ? '' : ` (${pct.toFixed(3).replace(/^0/, '')})`}`
}
const ORD = ['', '1st', '2nd', '3rd', '4th']
const pickText = (p: ParsedPick) => `${p.season} ${ORD[p.round] ?? `round ${p.round}`}`

/** The market-context lines for one reviewed trade. PURE. */
export function marketContextLines(args: {
  row: Pick<AuditRow, 'sideAName' | 'sideBName' | 'gapPct'>
  facts: TradeFacts | null
  distribution: GapDistribution | null
  tables: LearnedTables | null
}): string[] {
  const { row, facts, distribution: d, tables } = args
  const out: string[] = []
  const gap = Math.abs(row.gapPct)
  if (d && d.total >= RARITY_MIN_TRADES && gap >= RARITY_BUCKET_PCT) {
    const floor = Math.floor(gap / RARITY_BUCKET_PCT) * RARITY_BUCKET_PCT
    const n = d.atLeast(gap)
    const share = Math.round((n / d.total) * 1000) / 10
    out.push(`${share}% of ${d.total.toLocaleString('en-US')} audited trades on AllFantasy had a value gap of ${floor}% or more.`)
  }
  if (facts?.a?.record && facts.b?.record) {
    out.push(`At the trade, ${row.sideAName} was ${recordText(facts.a.record)} and ${row.sideBName} was ${recordText(facts.b.record)}.`)
  }
  if (facts?.dynasty && facts.book && facts.tradeDate && tables) {
    for (const [name, side] of [[row.sideAName, facts.a], [row.sideBName, facts.b]] as const) {
      for (const p of side?.picksSent ?? []) {
        const adj = learnedPickAdjustment(tables, facts.book, pickText(p), facts.teams, facts.tradeDate)
        if (adj) out.push(`${name} sent a ${pickText(p)}: ${adj.reason}.`)
      }
    }
  }
  return out
}

type TradeRowLite = {
  transactionId: string
  tradeDate: Date | null
  partnerRosterId: number | null
  picksGiven: unknown
  picksReceived: unknown
  contextSnapshot: unknown
  leagueFormat: string | null
  isSuperFlex: boolean | null
}

type SnapSide = { rosterId?: unknown; record?: { wins?: unknown; losses?: unknown; ties?: unknown } | null }

/** One trade's facts, oriented to the audit's side A (its roster id), from the trade's stored rows. PURE. */
export function tradeFactsFrom(rows: readonly TradeRowLite[], sideARosterId: string, sideBRosterId: string, teams: number | null): TradeFacts | null {
  if (rows.length === 0) return null
  const first = rows[0]!
  // Each trade is stored once per side: the row whose PARTNER is side B is side A's own row.
  const aRow = rows.find((r) => String(r.partnerRosterId) === sideBRosterId) ?? null
  const bRow = rows.find((r) => String(r.partnerRosterId) === sideARosterId) ?? null
  const snap = rows.map((r) => r.contextSnapshot).find((s) => s && typeof s === 'object' && Array.isArray((s as { sides?: unknown }).sides)) as
    | { sides: SnapSide[]; unavailable?: unknown }
    | undefined
  const recordOf = (rosterId: string) => {
    const s = snap && !snap.unavailable ? snap.sides.find((x) => String(x.rosterId) === rosterId) : null
    const r = s?.record
    return r ? { wins: Number(r.wins) || 0, losses: Number(r.losses) || 0, ties: Number(r.ties) || 0 } : null
  }
  // What a side sent is its own row's picksGiven — or, when only the other side's row was stored, that row's picksReceived.
  const picksSentBy = (own: TradeRowLite | null, other: TradeRowLite | null) =>
    (own ? parsePicks(own.picksGiven) : other ? parsePicks(other.picksReceived) : []) ?? []
  const format = rows.map((r) => r.leagueFormat).find(Boolean) ?? null
  const superflex = rows.map((r) => r.isSuperFlex).find((v) => v != null) ?? null
  const dynasty = format === 'dynasty' || format === 'keeper'
  const book = format && superflex != null ? bookKey({ format: dynasty ? 'DYNASTY' : 'REDRAFT', qbFormat: superflex ? 'SUPERFLEX' : 'ONE_QB' }) : null
  return {
    tradeDate: first.tradeDate,
    book,
    dynasty,
    teams,
    a: { record: recordOf(sideARosterId), picksSent: picksSentBy(aRow, bRow) },
    b: { record: recordOf(sideBRosterId), picksSent: picksSentBy(bRow, aRow) },
  }
}

type Db = {
  leagueTrade: { findMany: (args: unknown) => Promise<unknown[]> }
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>
  sportsDataCache: { findUnique: (args: { where: { cacheKey: string } }) => PromiseLike<unknown> }
}

let distMemo: { at: number; d: GapDistribution } | null = null
const DIST_MEMO_MS = 60 * 60 * 1000

async function loadGapDistribution(db: Db, now: Date): Promise<GapDistribution | null> {
  if (distMemo && now.getTime() - distMemo.at < DIST_MEMO_MS) return distMemo.d
  const rows = (await db.$queryRaw`
    SELECT floor(abs(gap_pct) / ${RARITY_BUCKET_PCT})::int AS bucket, count(*)::int AS count
    FROM trade_value_audits GROUP BY 1`) as Array<{ bucket: number; count: number }>
  const d = gapDistribution(rows.map((r) => ({ bucket: Number(r.bucket), count: Number(r.count) })))
  distMemo = { at: now.getTime(), d }
  return d
}

/** Test hook. */
export function resetGapDistributionMemo(): void {
  distMemo = null
}

/**
 * Market context for every reviewed trade, by trade key. Only Sleeper-keyed trades carry stored context today; the
 * rest get the rarity line alone. Every read is best-effort: a failure leaves that part out, never the review.
 */
export async function loadTradeMarketContext(
  db: Db,
  rows: readonly AuditRow[],
  opts: { teams: number | null; now?: Date },
): Promise<Record<string, string[]>> {
  const now = opts.now ?? new Date()
  const [distribution, tables] = await Promise.all([
    loadGapDistribution(db, now).catch(() => null),
    loadLearnedTables(db).catch(() => null),
  ])
  const ids = rows.filter((r) => r.tradeKey.startsWith('sleeper:')).map((r) => r.tradeKey.slice('sleeper:'.length))
  const byTx = new Map<string, TradeRowLite[]>()
  if (ids.length) {
    const found = (await db.leagueTrade
      .findMany({
        where: { transactionId: { in: ids } },
        select: { transactionId: true, tradeDate: true, partnerRosterId: true, picksGiven: true, picksReceived: true, contextSnapshot: true, leagueFormat: true, isSuperFlex: true },
      })
      .catch(() => [])) as TradeRowLite[]
    for (const t of found) byTx.set(t.transactionId, [...(byTx.get(t.transactionId) ?? []), t])
  }
  const out: Record<string, string[]> = {}
  for (const row of rows) {
    const tx = row.tradeKey.startsWith('sleeper:') ? row.tradeKey.slice('sleeper:'.length) : null
    const facts = tx ? tradeFactsFrom(byTx.get(tx) ?? [], row.sideATeamId, row.sideBTeamId, opts.teams) : null
    const lines = marketContextLines({ row, facts, distribution, tables })
    if (lines.length) out[row.tradeKey] = lines
  }
  return out
}
