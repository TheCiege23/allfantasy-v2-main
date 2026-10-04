import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { mirrorTradeGrade, type TradeGradeView } from './tradeGrade'
import type { GradeInputs } from './tradeGradeInputs'

/**
 * THE ORIGINAL GRADE OF A COMPLETED PROVIDER TRADE, FROZEN THE FIRST TIME ANY SURFACE GRADES IT.
 *
 * Until 2026-09-28 a completed Sleeper trade had no original at all: the grade email, the Trade
 * Center timeline, /core history, the dashboard band, League Buzz and the trades board all re-priced
 * it on TODAY's values at read time. So the letter in the email a manager was sent could be a
 * different letter on every screen they opened afterwards — the D.K. Metcalf report, for imported
 * leagues. Guap's ruling (2026-09-28): freeze it in the table that already exists, no migration.
 *
 * 🛑 AND SINCE 2026-10-03 THE ORIGINAL IS PRICED AT THE TIME OF THE TRADE (Guap's ruling). v1 froze
 * whatever today's values said the first time a surface read the deal — for an imported trade that
 * could be weeks after it happened. A NEW original is now written as `completed_trade_grade_v2`:
 *
 *   - `basis: 'trade_date'` — priced on the stored market capture from the trade's own date
 *     (`completedTradeGrade.gradeAtTradeTime`), `pricedAsOf` = that capture's day;
 *   - `basis: 'first_graded'` — no same-scale market record covers the trade date, so it keeps the
 *     grade AllFantasy gave when it first saw it (today's values, as v1 did), `pricedAsOf` = then.
 *     Every surface says so (`gradeMoment`): never withheld, and never priced on the historical JSON.
 *
 * Same table, same namespace, a new `snapshotType` string — no migration (`snapshotType` is
 * VARCHAR(32); `completed_trade_grade_v2` is 24).
 *
 * - WRITE-ONCE, APPEND-ONLY. Nothing here updates or deletes. Two first reads racing can each write
 *   a row; the EARLIEST row wins on every read, so the answer is still one letter.
 * - 🛑 v1 ROWS ARE NEVER UPDATED OR DELETED — they are the audit trail of what was shown. A reader
 *   prefers the v2 row for a trade and falls back to v1 only when there is no v2 (or the v2 row is a
 *   different deal). A v1-only original reads as first-graded with the old wording, because nothing
 *   has yet checked whether its trade date is covered (`scripts/reprice-frozen-trade-grades-at-trade-time.ts`
 *   does, and writes the v2 row).
 * - KEYED ON THE AllFantasy LEAGUE ROW + the Sleeper transaction id. One Sleeper league is N AF rows
 *   (one per importer) and each row prices on its own settings, so each row freezes its own original.
 * - ORIENTED BY ASSETS, NOT BY ROSTER. A frozen grade is stored from one side; a reader re-orients it
 *   by matching its own asset sets against the stored ones (mirror when they are swapped). A reader
 *   whose assets match NEITHER way is reading a different deal — it gets today's grade, never a
 *   borrowed letter.
 * - ONLY A LETTER IS FROZEN. A withheld grade (an asset with no value yet) is not an original — the
 *   gap may close tomorrow — so it keeps recomputing until the deal can be graded, then freezes.
 * - The letter every surface shows becomes the frozen ORIGINAL; today's re-evaluation rides beside it
 *   as `current`, and `frozenAt` says when the original was taken. The two are never merged.
 *
 * Failure-contained: a read or write failure returns today's grade exactly as before this existed.
 */

const SNAPSHOT_TYPE_V1 = 'completed_trade_grade_v1'
export const COMPLETED_GRADE_SNAPSHOT_TYPE = 'completed_trade_grade_v2'
/** `sleeperUsername` is an owner namespace on this table (see evaluationReceiptStore); this one is the system's. */
export const COMPLETED_GRADE_NAMESPACE = 'system:completed-trade-grade'

type Graded = Extract<TradeGradeView, { graded: true }>

/** How a frozen original was priced: on the trade's own date, or on the values of the day it was first read. */
export type FrozenGradeBasis = 'trade_date' | 'first_graded'

/**
 * WHICH BOARD priced a `trade_date` original — for audit; no surface reads it, and the label does not
 * change with it:
 *   - `league_live` — the league's own live chart (graded within a day of the trade);
 *   - `league_profile` — the league's own FantasyCalc profile, captured daily (from 2026-10-04);
 *   - `standard_12_ppr1` — FantasyCalc's 12-team PPR-1 book (`PlayerValueSnapshot`), the fallback.
 * Absent on rows written before 2026-10-04 (all of which are `league_live` or `standard_12_ppr1`).
 */
export type TradeDateBook = 'league_live' | 'league_profile' | 'standard_12_ppr1'

/** A v1 original: frozen on today's values the first time a surface read the trade. Read-only now. */
export type FrozenCompletedGradeV1 = {
  v: 1
  /** The Sleeper transaction id (`sleeperTradeKey`). */
  tradeId: string
  /** Sorted asset identities on the side the grade is written from, and the other. */
  give: string[]
  get: string[]
  grade: Graded
  frozenAt: string
}

/** A v2 original — what every new freeze writes. */
export type FrozenCompletedGradeV2 = {
  v: 2
  tradeId: string
  give: string[]
  get: string[]
  grade: Graded
  /** When this row was written. */
  frozenAt: string
  basis: FrozenGradeBasis
  /**
   * `trade_date`: the capture day (YYYY-MM-DD) it was priced on, or — graded within a day of the trade
   * on the league's own live chart — that moment (ISO). `first_graded`: when it was first graded (ISO).
   */
  pricedAsOf: string
  /** When the trade happened (ISO), or null when it could not be told. */
  tradeAt: string | null
  /** `trade_date` only: which board priced it (`TradeDateBook`). */
  pricedBook?: TradeDateBook
  /**
   * NOT STORED. Set on read: the v1 original for the same trade, consulted only when this v2 row does
   * not match the reader's deal.
   */
  prior?: FrozenCompletedGradeV1
}

export type FrozenCompletedGrade = FrozenCompletedGradeV1 | FrozenCompletedGradeV2

/**
 * The provider's own transaction id. The ledger names a trade `<seasonLeagueId>:<transaction_id>`,
 * the band `<platform>:<league>:<transaction_id>`, a raw Sleeper transaction and `LeagueTrade` the bare
 * id — every form ends in the one id Sleeper issued, which is what one trade is keyed on.
 */
export function sleeperTradeKey(id: string): string {
  return String(id).split(':').pop()!.trim()
}

/** One asset's identity: a player by Sleeper id when he has one — the same identity the grader prices. */
function assetKey(a: TradeAssetInput): string {
  if (a.kind === 'pick') return `pick:${a.year}:${a.round}`
  if (a.kind === 'faab') return `faab:${a.amount}`
  if (a.providerIdentity) return `${a.providerIdentity.provider}:${a.providerIdentity.id}`
  return `name:${(a.name ?? a.playerId ?? '').trim().toLowerCase()}`
}

/** The sorted asset identities of one side — what a frozen row is oriented by. */
export const frozenAssetKeys = (inputs: GradeInputs) => inputs.assets.map(assetKey).sort()
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

type SnapshotRow = { contextKey: string | null; payloadJson: unknown }

function readV1(p: Partial<FrozenCompletedGradeV1> | null): FrozenCompletedGradeV1 | null {
  if (p?.v !== 1 || !p.grade?.graded || !Array.isArray(p.give) || !Array.isArray(p.get) || typeof p.frozenAt !== 'string') return null
  return p as FrozenCompletedGradeV1
}

function readV2(p: Partial<FrozenCompletedGradeV2> | null): FrozenCompletedGradeV2 | null {
  if (p?.v !== 2 || !p.grade?.graded || !Array.isArray(p.give) || !Array.isArray(p.get) || typeof p.frozenAt !== 'string') return null
  if ((p.basis !== 'trade_date' && p.basis !== 'first_graded') || typeof p.pricedAsOf !== 'string') return null
  const { prior: _ignored, ...row } = p as FrozenCompletedGradeV2
  return { ...row, tradeAt: typeof p.tradeAt === 'string' ? p.tradeAt : null }
}

/**
 * The frozen originals for these trades on one league row: per trade, the earliest v2 row (carrying
 * the earliest v1 row as `prior`), else the earliest v1 row. Never throws.
 */
export async function loadFrozenCompletedGrades(
  afLeagueId: string,
  tradeIds: ReadonlyArray<string>,
): Promise<Map<string, FrozenCompletedGrade>> {
  const out = new Map<string, FrozenCompletedGrade>()
  const keys = [...new Set(tradeIds.map(sleeperTradeKey).filter(Boolean))]
  if (!afLeagueId || keys.length === 0) return out
  // One read per type, each by equality — the indexed (leagueId, sleeperUsername, snapshotType) path.
  // `async` wrapper: a synchronous throw from the client must fail closed to "nothing frozen" too.
  const read = (snapshotType: string) =>
    (async () =>
      prisma.tradeAnalysisSnapshot.findMany({
        where: { leagueId: afLeagueId, sleeperUsername: COMPLETED_GRADE_NAMESPACE, snapshotType, contextKey: { in: keys } },
        orderBy: { createdAt: 'asc' },
        select: { contextKey: true, payloadJson: true },
      }))().catch(() => [] as SnapshotRow[])
  const [v1Rows, v2Rows] = await Promise.all([read(SNAPSHOT_TYPE_V1), read(COMPLETED_GRADE_SNAPSHOT_TYPE)])
  const v1 = new Map<string, FrozenCompletedGradeV1>()
  for (const row of v1Rows as SnapshotRow[]) {
    const p = readV1(row.payloadJson as Partial<FrozenCompletedGradeV1> | null)
    if (row.contextKey && p && !v1.has(row.contextKey)) v1.set(row.contextKey, p) // earliest wins
  }
  for (const row of v2Rows as SnapshotRow[]) {
    const p = readV2(row.payloadJson as Partial<FrozenCompletedGradeV2> | null)
    if (!row.contextKey || !p || out.has(row.contextKey)) continue // earliest wins
    const prior = v1.get(row.contextKey)
    out.set(row.contextKey, prior ? { ...p, prior } : p)
  }
  for (const [key, p] of v1) if (!out.has(key)) out.set(key, p)
  return out
}

/** The stored payload: never the read-time `prior`. */
function storedPayload(f: FrozenCompletedGrade): FrozenCompletedGrade {
  if (f.v === 1) return f
  const { prior: _prior, ...row } = f
  return row
}

/**
 * Append the originals just taken. Failure-contained: a lost write only means the next read freezes.
 * Resolves true when the rows were written. New originals are always v2.
 */
export async function saveFrozenCompletedGrades(afLeagueId: string, frozen: ReadonlyArray<FrozenCompletedGrade>): Promise<boolean> {
  if (!afLeagueId || frozen.length === 0) return true
  return (async () =>
    prisma.tradeAnalysisSnapshot.createMany({
      data: frozen.map((f) => ({
        leagueId: afLeagueId,
        sleeperUsername: COMPLETED_GRADE_NAMESPACE,
        snapshotType: f.v === 1 ? SNAPSHOT_TYPE_V1 : COMPLETED_GRADE_SNAPSHOT_TYPE,
        contextKey: f.tradeId,
        payloadJson: storedPayload(f) as unknown as Prisma.InputJsonValue,
        expiresAt: null,
      })),
    }))().then(() => true, () => false)
}

/** A trade priced on its own date (`completedTradeGrade.gradeAtTradeTime`). */
export type TradeDatePrice = {
  grade: Graded
  /** The capture day (YYYY-MM-DD) every asset was priced on, or the live-chart moment (ISO). */
  pricedAsOf: string
  /** Which board priced it. Recorded on the frozen row. */
  pricedBook?: TradeDateBook
}

/** The fields a surface needs to SAY when and how a frozen letter was priced (`gradeMoment`). */
export type FrozenMoment = {
  frozenAt: string
  /** Null for a v1 original: its basis was never determined. */
  frozenBasis: FrozenGradeBasis | null
  pricedAsOf: string
  tradeAt: string | null
}

function orient(frozen: { give: string[]; get: string[]; grade: Graded }, give: string[], get: string[]): Graded | null {
  if (same(frozen.give, give) && same(frozen.get, get)) return frozen.grade
  if (same(frozen.give, get) && same(frozen.get, give)) return mirrorTradeGrade(frozen.grade) as Graded
  return null
}

/**
 * How a frozen row says when it was priced. A v1 row was priced the day it was frozen — but carries NO
 * basis: nothing has checked whether a market record covers its trade date, so it must not be
 * labelled "no market record from the trade date" (`gradeMoment` keeps the old "when first graded").
 */
function momentOf(f: FrozenCompletedGrade, tradeAt: string | null): FrozenMoment {
  return f.v === 2
    ? { frozenAt: f.frozenAt, frozenBasis: f.basis, pricedAsOf: f.pricedAsOf, tradeAt: f.tradeAt ?? tradeAt }
    : { frozenAt: f.frozenAt, frozenBasis: null, pricedAsOf: f.frozenAt, tradeAt }
}

/**
 * PURE. The grade a surface shows for one completed trade: the frozen original, oriented to this
 * surface's `inputs`, with today's grade as `current` — or, when nothing is frozen yet, the original
 * to freeze now:
 *
 *   - `dated` (the trade priced on its own date) → a `trade_date` original, today's grade beside it;
 *   - otherwise today's grade becomes a `first_graded` original, exactly as v1 froze it.
 */
export function withFrozenOriginal(args: {
  tradeId: string
  inputs: { give: GradeInputs; get: GradeInputs }
  current: TradeGradeView
  frozen: FrozenCompletedGrade | undefined
  now: Date
  /** The same deal priced at the time of the trade, from `inputs.give`'s side — or null when it cannot be. */
  dated?: TradeDatePrice | null
  /** When the trade happened (ISO), for the label and the row. */
  tradeAt?: string | null
}): { view: TradeGradeView; toFreeze: FrozenCompletedGrade | null } {
  const give = frozenAssetKeys(args.inputs.give)
  const get = frozenAssetKeys(args.inputs.get)
  const { frozen, current } = args
  const tradeAt = args.tradeAt ?? null
  const today = current.graded
    ? { letter: current.letter, partnerLetter: current.partnerLetter, giveValue: current.giveValue, getValue: current.getValue }
    : null

  if (frozen) {
    // The v2 row first; its v1 predecessor only when the v2 row is a different deal to this reader.
    for (const row of [frozen, ...(frozen.v === 2 && frozen.prior ? [frozen.prior] : [])]) {
      const original = orient(row, give, get)
      if (original) return { view: { ...original, ...momentOf(row, tradeAt), current: today }, toFreeze: null }
    }
    // Assets that match neither way are a different deal — never lend it this trade's letter.
    return { view: current, toFreeze: null }
  }

  const frozenAt = args.now.toISOString()
  const tradeId = sleeperTradeKey(args.tradeId)
  if (args.dated) {
    // The stored grade carries no read-time fields of its own: those describe a READ, not the original.
    const { current: _c, frozenAt: _f, frozenBasis: _b, pricedAsOf: _p, tradeAt: _t, ...grade } = args.dated.grade
    const row: FrozenCompletedGradeV2 = {
      v: 2, tradeId, give, get, grade: grade as Graded, frozenAt, basis: 'trade_date', pricedAsOf: args.dated.pricedAsOf, tradeAt,
      ...(args.dated.pricedBook ? { pricedBook: args.dated.pricedBook } : {}),
    }
    return { view: { ...row.grade, ...momentOf(row, tradeAt), current: today }, toFreeze: row }
  }
  if (!current.graded) return { view: current, toFreeze: null }
  const { current: _c, frozenAt: _f, frozenBasis: _b, pricedAsOf: _p, tradeAt: _t, ...grade } = current
  const row: FrozenCompletedGradeV2 = {
    v: 2, tradeId, give, get, grade: grade as Graded, frozenAt, basis: 'first_graded', pricedAsOf: frozenAt, tradeAt,
  }
  return { view: { ...current, ...momentOf(row, tradeAt), current: null }, toFreeze: row }
}

/**
 * One trade, read and (first time only) frozen — for the surfaces that grade one deal at a time. Batch
 * surfaces call `loadFrozenCompletedGrades` once and `withFrozenOriginal` per trade instead.
 *
 * `priceAtTradeTime` is asked only when nothing is frozen yet — pricing a deal on its date costs a
 * capture read, and a frozen original never needs one.
 */
export async function frozenOriginalFor(args: {
  afLeagueId: string
  tradeId: string
  inputs: { give: GradeInputs; get: GradeInputs }
  current: TradeGradeView
  now?: Date
  tradeAt?: string | null
  priceAtTradeTime?: () => Promise<TradeDatePrice | null>
}): Promise<TradeGradeView> {
  try {
    const frozen = (await loadFrozenCompletedGrades(args.afLeagueId, [args.tradeId])).get(sleeperTradeKey(args.tradeId))
    const dated = !frozen && args.priceAtTradeTime ? await args.priceAtTradeTime().catch(() => null) : null
    const { view, toFreeze } = withFrozenOriginal({ ...args, frozen, dated, now: args.now ?? new Date() })
    // Not written, not frozen: the letter is today's, and must not claim to be an original.
    if (toFreeze && !(await saveFrozenCompletedGrades(args.afLeagueId, [toFreeze]))) return args.current
    return view
  } catch {
    return args.current
  }
}
