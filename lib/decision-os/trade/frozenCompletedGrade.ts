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
 * - WRITE-ONCE, APPEND-ONLY. Nothing here updates or deletes. Two first reads racing can each write
 *   a row; the EARLIEST row wins on every read, so the answer is still one letter.
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

const SNAPSHOT_TYPE = 'completed_trade_grade_v1'
/** `sleeperUsername` is an owner namespace on this table (see evaluationReceiptStore); this one is the system's. */
const NAMESPACE = 'system:completed-trade-grade'

type Graded = Extract<TradeGradeView, { graded: true }>

export type FrozenCompletedGrade = {
  v: 1
  /** The Sleeper transaction id (`sleeperTradeKey`). */
  tradeId: string
  /** Sorted asset identities on the side the grade is written from, and the other. */
  give: string[]
  get: string[]
  grade: Graded
  frozenAt: string
}

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

const keysOf = (inputs: GradeInputs) => inputs.assets.map(assetKey).sort()
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** The frozen originals for these trades on one league row: the earliest row per trade. Never throws. */
export async function loadFrozenCompletedGrades(
  afLeagueId: string,
  tradeIds: ReadonlyArray<string>,
): Promise<Map<string, FrozenCompletedGrade>> {
  const out = new Map<string, FrozenCompletedGrade>()
  const keys = [...new Set(tradeIds.map(sleeperTradeKey).filter(Boolean))]
  if (!afLeagueId || keys.length === 0) return out
  // `async` wrapper: a synchronous throw from the client must fail closed to "nothing frozen" too.
  const rows = await (async () =>
    prisma.tradeAnalysisSnapshot.findMany({
      where: { leagueId: afLeagueId, sleeperUsername: NAMESPACE, snapshotType: SNAPSHOT_TYPE, contextKey: { in: keys } },
      orderBy: { createdAt: 'asc' },
      select: { contextKey: true, payloadJson: true },
    }))().catch(() => [] as Array<{ contextKey: string | null; payloadJson: unknown }>)
  for (const row of rows) {
    const p = row.payloadJson as Partial<FrozenCompletedGrade> | null
    if (!row.contextKey || out.has(row.contextKey)) continue // earliest wins
    if (p?.v !== 1 || !p.grade?.graded || !Array.isArray(p.give) || !Array.isArray(p.get) || typeof p.frozenAt !== 'string') continue
    out.set(row.contextKey, p as FrozenCompletedGrade)
  }
  return out
}

/**
 * Append the originals just taken. Failure-contained: a lost write only means the next read freezes.
 * Resolves true when the rows were written.
 */
export async function saveFrozenCompletedGrades(afLeagueId: string, frozen: ReadonlyArray<FrozenCompletedGrade>): Promise<boolean> {
  if (!afLeagueId || frozen.length === 0) return true
  return (async () =>
    prisma.tradeAnalysisSnapshot.createMany({
      data: frozen.map((f) => ({
        leagueId: afLeagueId,
        sleeperUsername: NAMESPACE,
        snapshotType: SNAPSHOT_TYPE,
        contextKey: f.tradeId,
        payloadJson: f as unknown as Prisma.InputJsonValue,
        expiresAt: null,
      })),
    }))().then(() => true, () => false)
}

/**
 * PURE. The grade a surface shows for one completed trade: the frozen original, oriented to this
 * surface's `inputs`, with today's grade as `current` — or, when nothing is frozen yet, today's grade
 * as the original plus the row to freeze.
 */
export function withFrozenOriginal(args: {
  tradeId: string
  inputs: { give: GradeInputs; get: GradeInputs }
  current: TradeGradeView
  frozen: FrozenCompletedGrade | undefined
  now: Date
}): { view: TradeGradeView; toFreeze: FrozenCompletedGrade | null } {
  const give = keysOf(args.inputs.give)
  const get = keysOf(args.inputs.get)
  const { frozen, current } = args
  const today = current.graded
    ? { letter: current.letter, partnerLetter: current.partnerLetter, giveValue: current.giveValue, getValue: current.getValue }
    : null

  if (frozen) {
    const original = same(frozen.give, give) && same(frozen.get, get)
      ? frozen.grade
      : same(frozen.give, get) && same(frozen.get, give)
        ? (mirrorTradeGrade(frozen.grade) as Graded)
        : null
    // Assets that match neither way are a different deal — never lend it this trade's letter.
    if (!original) return { view: current, toFreeze: null }
    return { view: { ...original, frozenAt: frozen.frozenAt, current: today }, toFreeze: null }
  }

  if (!current.graded) return { view: current, toFreeze: null }
  const frozenAt = args.now.toISOString()
  // The stored grade carries no `current`/`frozenAt` of its own: those describe a READ, not the original.
  const { current: _c, frozenAt: _f, ...grade } = current
  return {
    view: { ...current, frozenAt, current: null },
    toFreeze: { v: 1, tradeId: sleeperTradeKey(args.tradeId), give, get, grade: grade as Graded, frozenAt },
  }
}

/**
 * One trade, read and (first time only) frozen — for the surfaces that grade one deal at a time. Batch
 * surfaces call `loadFrozenCompletedGrades` once and `withFrozenOriginal` per trade instead.
 */
export async function frozenOriginalFor(args: {
  afLeagueId: string
  tradeId: string
  inputs: { give: GradeInputs; get: GradeInputs }
  current: TradeGradeView
  now?: Date
}): Promise<TradeGradeView> {
  try {
    const frozen = (await loadFrozenCompletedGrades(args.afLeagueId, [args.tradeId])).get(sleeperTradeKey(args.tradeId))
    const { view, toFreeze } = withFrozenOriginal({ ...args, frozen, now: args.now ?? new Date() })
    // Not written, not frozen: the letter is today's, and must not claim to be an original.
    if (toFreeze && !(await saveFrozenCompletedGrades(args.afLeagueId, [toFreeze]))) return args.current
    return view
  } catch {
    return args.current
  }
}
