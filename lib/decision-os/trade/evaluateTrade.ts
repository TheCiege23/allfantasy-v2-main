import 'server-only'

import { createHash } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { evaluateCanonicalTrade, type CanonicalTradeEvaluation } from './canonicalEvaluator'
import type { TradeAssetSummary } from './dco'
import { createLeagueTradeGrader, gradeDeal, type LeagueTradeGrader } from './leagueTradeGrader'
import { mirrorTradeGrade, type TradeGradeView } from './tradeGrade'
import type { GradeInputs } from './tradeGradeInputs'

/**
 * THE trade engine's one entry point (2026-09-26). Every surface that evaluates a deal calls
 * `evaluateTrade()` and gets back one receipt; nothing else in the app turns a trade into a letter.
 *
 * It joins the two halves that already existed, without picking a winner between them:
 *   - the LETTER is the one grade — `leagueTradeGrader` (league value, one scale, exact mirror for
 *     the other side). See `./tradeGrade.ts` for why there is only one.
 *   - the LINEUP EFFECT, confidence and coverage are the canonical evaluation's
 *     (`./canonicalEvaluator.ts`), run per participant roster when the caller knows the rosters.
 * `lib/league-trade-engine/serverTradeDecision.ts` paired them this way first; this is that pairing
 * made the only door.
 *
 * 🛑 AN ASSET THE ENGINE CANNOT PRICE WITHHOLDS THE GRADE. There is no default value for a player
 * nobody could find — the flat 200 that `calculateTradeBalance` used to hand an unknown player is
 * exactly what this replaced. The receipt says which assets, by name.
 *
 * ⚠ THE RECEIPT IS APPEND-ONLY. A new evaluation is a new row in `trade_evaluation_receipts`; an old
 * receipt is never rewritten with today's data. Persisting is best-effort and CONTAINED: a missing
 * table or a write failure comes back as `persisted: false` with the grade intact, because losing a
 * grade to a bookkeeping error is worse than an unsaved receipt.
 *
 * ⚠ THE CALLER HAS ALREADY PROVEN MEMBERSHIP, as for `createLeagueTradeGrader` — the grader reads
 * the viewer's roster in the league it is handed.
 */

export const TRADE_EVALUATION_MODEL_VERSION = 'trade-eval-v1'

/** Which surface asked: `proposal`, `trade-evaluator`, `legacy-trade-analyze`, … */
export type TradeEvaluationSurface = string

export type TradeEvaluationAsset = {
  side: 'give' | 'get'
  name: string
  kind: 'player' | 'pick' | 'faab'
  marketValue: number | null
  leagueValue: number | null
  source: string | null
  /** Why this league prices it differently from the market, when it does. */
  adjustments: string[]
}

export type TradeEvaluationParticipant = {
  rosterId: string
  action: CanonicalTradeEvaluation['action']
  recommendation: string
  fairnessScore: number | null
  confidenceScore: number
  coverageStatus: CanonicalTradeEvaluation['coverageStatus']
  coveragePct: number
  rosterImpact: CanonicalTradeEvaluation['rosterImpact'] | null
  memoVersion: string | null
}

export type TradeEvaluationReceipt = {
  /** The saved row's id. Null when the receipt could not be saved (see `persisted`). */
  receiptId: string | null
  persisted: boolean
  /** Why it was not saved, when it was asked to be and was not. */
  persistError: string | null
  modelVersion: string
  surface: TradeEvaluationSurface
  evaluatedAt: string
  inputHash: string
  leagueId: string | null
  userId: string | null
  /** THE grade, for the side that sends `give`. */
  grade: TradeGradeView
  /** The same grade from the other side — the exact mirror, never a second computation. */
  partnerGrade: TradeGradeView
  assets: TradeEvaluationAsset[]
  /** Assets the surface could not even turn into an input (a pick with no year, …). */
  unpriceable: string[]
  /**
   * The canonical evaluation per participant roster. Null when the caller gave no rosters (an ad-hoc
   * evaluation by name), which is "not asked", not "failed" — `canonicalError` says when it failed.
   */
  canonical: { proposerRosterId: string; receiverRosterId: string; participants: TradeEvaluationParticipant[] } | null
  canonicalError: string | null
}

export type EvaluateTradeInput = {
  surface: TradeEvaluationSurface
  /** Null when no league is selected: the grade is then withheld, and says so. */
  leagueId: string | null
  /** The viewer, when there is one. Roster need is priced only for them, and only on their side. */
  userId?: string | null
  /** What the graded side sends and receives. */
  give: GradeInputs
  get: GradeInputs
  /** The `give` side is the viewer's own roster — the only case where roster need counts. */
  viewerSide: boolean
  /** Rosters, when the caller knows them: turns on the canonical lineup effect and confidence. */
  canonical?: {
    proposerRosterId: string
    receiverRosterId: string
    participantRosterIds: string[]
    assets: TradeAssetSummary[]
    currentSeason: number | null
    includeRosterImpact?: boolean
  } | null
  evaluatedAt?: string
  /** Save the receipt. Default true. */
  persist?: boolean
  /** A grader already loaded for this league, to grade a batch on one chart. */
  grader?: LeagueTradeGrader | null
}

export type EvaluateTradeDeps = {
  /** Produce the one grade. Default: load the league's grader and `gradeDeal`. */
  grade: (input: EvaluateTradeInput) => Promise<TradeGradeView>
  evaluateCanonical: typeof evaluateCanonicalTrade
  saveReceipt: (row: TradeEvaluationReceiptRow) => Promise<{ id: string }>
}

export type TradeEvaluationReceiptRow = {
  surface: string
  modelVersion: string
  leagueId: string | null
  userId: string | null
  graded: boolean
  letter: string | null
  percentDiff: number | null
  withheldReason: string | null
  inputHash: string
  receipt: TradeEvaluationReceipt
  evaluatedAt: Date
}

export const NO_LEAGUE_REASON = 'No league is selected — a grade is taken on a league’s own values and rules.'

async function defaultGrade(input: EvaluateTradeInput): Promise<TradeGradeView> {
  if (!input.leagueId) return { graded: false, reason: NO_LEAGUE_REASON, basis: null }
  const grader =
    input.grader !== undefined
      ? input.grader
      : await createLeagueTradeGrader({ leagueId: input.leagueId, userId: input.userId ?? null }).catch(() => null)
  return gradeDeal(grader, { give: input.give, get: input.get, viewerSide: input.viewerSide })
}

type ReceiptDelegate = { create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }> }

/*
 * ⚠ THE DELEGATE IS LOOKED UP, NOT ASSUMED. The generated client in a checkout can predate the
 * `TradeEvaluationReceipt` model, and production can run this code before its migration is applied —
 * the second raises P2021 on write. Both must end as `persisted: false`, never as a lost grade.
 */
async function defaultSaveReceipt(row: TradeEvaluationReceiptRow): Promise<{ id: string }> {
  const store = (prisma as unknown as { tradeEvaluationReceipt?: ReceiptDelegate }).tradeEvaluationReceipt
  if (!store || typeof store.create !== 'function') throw new Error('trade_evaluation_receipts is not in the generated client')
  return store.create({
    data: {
      ...row,
      receipt: JSON.parse(JSON.stringify(row.receipt)) as Record<string, unknown>,
    },
    select: { id: true },
  })
}

export const defaultEvaluateTradeDeps: EvaluateTradeDeps = {
  grade: defaultGrade,
  evaluateCanonical: evaluateCanonicalTrade,
  saveReceipt: defaultSaveReceipt,
}

function assetName(a: TradeAssetInput): string {
  if (a.kind === 'player') return a.name?.trim() || a.playerId || 'Unknown player'
  if (a.kind === 'pick') return a.label?.trim() || `${a.year} round ${a.round} pick`
  return `$${a.amount} FAAB`
}

/**
 * Stable across key order and whitespace, so the same deal hashes the same whichever surface built it.
 * Sides are NOT sorted: `give` and `get` are the deal's direction, and swapping them is another deal.
 */
export function tradeInputHash(input: Pick<EvaluateTradeInput, 'leagueId' | 'give' | 'get' | 'viewerSide'>): string {
  const norm = (a: TradeAssetInput) =>
    a.kind === 'player'
      ? ['player', (a.name ?? '').trim().toLowerCase(), a.playerId ?? '']
      : a.kind === 'pick'
        ? ['pick', a.year, a.round, a.tier ?? '']
        : ['faab', a.amount]
  const side = (g: GradeInputs) => ({
    assets: g.assets.map(norm).map((x) => JSON.stringify(x)).sort(),
    unpriceable: [...g.unpriceable].sort(),
  })
  const payload = JSON.stringify({
    leagueId: input.leagueId ?? null,
    give: side(input.give),
    get: side(input.get),
    viewerSide: input.viewerSide,
  })
  return createHash('sha256').update(payload).digest('hex')
}

function assetsOf(input: EvaluateTradeInput, grade: TradeGradeView): TradeEvaluationAsset[] {
  const kindOf = (side: 'give' | 'get', i: number): TradeEvaluationAsset['kind'] =>
    (side === 'give' ? input.give : input.get).assets[i]?.kind ?? 'player'
  if (grade.graded) {
    const adjustments = new Map(grade.moves.map((m) => [`${m.side}:${m.name}`, m.reasons]))
    const seen = { give: 0, get: 0 }
    return grade.lines.map((l) => ({
      side: l.side,
      name: l.name,
      kind: kindOf(l.side, seen[l.side]++),
      marketValue: l.marketValue,
      leagueValue: l.leagueValue,
      source: l.source ?? null,
      adjustments: adjustments.get(`${l.side}:${l.name}`) ?? [],
    }))
  }
  const unpriced = (side: 'give' | 'get') => (a: TradeAssetInput): TradeEvaluationAsset => ({
    side,
    name: assetName(a),
    kind: a.kind,
    marketValue: null,
    leagueValue: null,
    source: null,
    adjustments: [],
  })
  return [...input.give.assets.map(unpriced('give')), ...input.get.assets.map(unpriced('get'))]
}

/** Evaluate one trade and return its receipt. Never throws: every failure is a withheld grade or a named gap. */
export async function evaluateTrade(
  input: EvaluateTradeInput,
  deps: Partial<EvaluateTradeDeps> = {},
): Promise<TradeEvaluationReceipt> {
  const d: EvaluateTradeDeps = { ...defaultEvaluateTradeDeps, ...deps }
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString()

  // Through `.then`, so a grader that throws SYNCHRONOUSLY is a withheld grade too, not a thrown call.
  const gradePromise = Promise.resolve().then(() => d.grade(input)).catch(
    (): TradeGradeView => ({ graded: false, reason: 'This deal could not be priced just now.', basis: null }),
  )

  let canonical: TradeEvaluationReceipt['canonical'] = null
  let canonicalError: string | null = null
  const c = input.canonical
  if (c && input.leagueId) {
    if (c.participantRosterIds.length !== 2) {
      canonicalError = `The canonical evaluator does not yet support ${c.participantRosterIds.length}-team trades.`
    } else {
      try {
        const evaluations = await Promise.all(
          c.participantRosterIds.map((rosterId) =>
            d.evaluateCanonical({
              leagueId: input.leagueId!,
              proposalId: `proposal:${input.leagueId}:${evaluatedAt}`,
              proposerRosterId: c.proposerRosterId,
              receiverRosterId: c.receiverRosterId,
              viewerRosterId: rosterId,
              assets: c.assets,
              currentSeason: c.currentSeason,
              evaluatedAt,
              includeRosterImpact: c.includeRosterImpact ?? false,
            }),
          ),
        )
        canonical = {
          proposerRosterId: c.proposerRosterId,
          receiverRosterId: c.receiverRosterId,
          participants: evaluations.map((e, i) => ({
            rosterId: c.participantRosterIds[i]!,
            action: e.action,
            recommendation: e.recommendation,
            fairnessScore: e.fairnessScore,
            confidenceScore: e.confidenceScore,
            coverageStatus: e.coverageStatus,
            coveragePct: e.coveragePct,
            rosterImpact: e.rosterImpact ?? null,
            memoVersion: e.memo?.snapshot?.version ?? null,
          })),
        }
      } catch (error) {
        canonicalError = error instanceof Error ? error.message : 'Canonical trade evaluation unavailable.'
      }
    }
  }

  const grade = await gradePromise
  const inputHash = tradeInputHash(input)
  const receipt: TradeEvaluationReceipt = {
    receiptId: null,
    persisted: false,
    persistError: null,
    modelVersion: TRADE_EVALUATION_MODEL_VERSION,
    surface: input.surface,
    evaluatedAt,
    inputHash,
    leagueId: input.leagueId ?? null,
    userId: input.userId ?? null,
    grade,
    partnerGrade: mirrorTradeGrade(grade),
    assets: assetsOf(input, grade),
    unpriceable: [...input.give.unpriceable, ...input.get.unpriceable],
    canonical,
    canonicalError,
  }

  if (input.persist === false) return receipt
  try {
    const row = await d.saveReceipt({
      surface: input.surface,
      modelVersion: TRADE_EVALUATION_MODEL_VERSION,
      leagueId: receipt.leagueId,
      userId: receipt.userId,
      graded: grade.graded,
      letter: grade.graded ? grade.letter : null,
      percentDiff: grade.graded ? grade.percentDiff : null,
      withheldReason: grade.graded ? null : grade.reason,
      inputHash,
      receipt,
      evaluatedAt: new Date(evaluatedAt),
    })
    return { ...receipt, receiptId: row.id, persisted: true }
  } catch {
    /*
     * ⚠ A FIXED STRING, NOT THE ERROR'S MESSAGE. A Prisma connection error names the database host,
     * and this receipt is returned to clients.
     */
    return { ...receipt, persistError: 'The evaluation receipt could not be saved.' }
  }
}
