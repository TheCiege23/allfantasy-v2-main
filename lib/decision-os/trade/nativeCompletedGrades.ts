import 'server-only'

import { prisma } from '@/lib/prisma'
import { PUBLIC_RECEIPT_SELECT, publicTradeDecisionReceipt } from '@/lib/league-trade-engine/tradeDecisionReceipt'
import { gradeInputsOf } from './evaluateStoredTrade'
import { loadTrade } from './loadTrade'
import { gradeMoment } from './gradeMoment'
import type { LoadedTrade } from './tradeRecord'
import type { TradeGradeView } from './tradeGrade'
import { gradeCompletedTradesWithOriginals, type CompletedDeal } from './completedTradeOriginals'

/**
 * THE GRADE FOR A COMPLETED TRADE MADE IN ALLFANTASY (`AfLeagueTrade`, status `processed`) — one letter per
 * team, the same on every surface (Trade OS, 2026-11-16).
 *
 * 🛑 "WHO WON THAT TRADE?" HAD NO GRADE IN CHIMMY FOR A NATIVE LEAGUE: its history block listed native trades
 * with "no values or grades are listed here".
 *
 * 🛑 AND A NATIVE TRADE ALREADY HAS AN ORIGINAL — DO NOT GIVE IT A SECOND ONE. A trade made here was graded when
 * it was PROPOSED, and that grade is an immutable decision receipt (`TradeDecisionSnapshot`), the "Then" letter
 * the Trade Center shows on every completed native row. Freezing another original at completion would hand one
 * trade two "original" letters, priced days apart. So:
 *
 *   1. the proposal receipt, when it carries a letter for every team — the Trade Center's own "Then";
 *   2. otherwise (a trade older than receipts) the frozen completed original, taken the first time it is read
 *      (`completedTradeOriginals.ts`), exactly as a Sleeper trade's is.
 *
 * ⚠ ONE READER OF A NATIVE TRADE. A trade that needs (2) is loaded by `loadTrade` — the loader the pending grade,
 * the Trade Center and the commissioner review use — so its players are matched exactly as they were as an offer.
 */

export type NativeCompletedGrade =
  | {
      graded: true
      /** `Roster.id` → that team's letter. */
      lettersByRoster: Record<string, string>
      /** How to say when the letters were taken, e.g. "when it was proposed (Oct 12)". */
      moment: string
      basis: 'proposal_receipt' | 'completed_original'
    }
  | { graded: false; reason: string }

export type ProposalReceiptLetters = { capturedAt: string; lettersByRoster: Record<string, string> }

export type NativeCompletedDeps = {
  receipts: (tradeIds: string[]) => Promise<Map<string, ProposalReceiptLetters>>
  load: typeof loadTrade
  gradeAll: typeof gradeCompletedTradesWithOriginals
}

async function defaultReceipts(tradeIds: string[]): Promise<Map<string, ProposalReceiptLetters>> {
  const out = new Map<string, ProposalReceiptLetters>()
  if (tradeIds.length === 0) return out
  const rows = await prisma.tradeDecisionSnapshot.findMany({ where: { tradeId: { in: tradeIds } }, select: PUBLIC_RECEIPT_SELECT })
  for (const row of rows) {
    if (typeof row.tradeId !== 'string') continue
    const receipt = publicTradeDecisionReceipt(row)
    const lettersByRoster: Record<string, string> = {}
    for (const p of receipt.participantDecisions) if (p.grade) lettersByRoster[p.rosterId] = p.grade
    out.set(row.tradeId, { capturedAt: receipt.capturedAt, lettersByRoster })
  }
  return out
}

const defaultDeps: NativeCompletedDeps = { receipts: defaultReceipts, load: loadTrade, gradeAll: gradeCompletedTradesWithOriginals }

/** "Oct 12", in UTC — the day a proposal receipt was taken. */
function dayLabel(iso: string): string | null {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null
}

/** Two-sided, completed, and loaded: the deal the grader prices. */
export function nativeDealOf(trade: LoadedTrade): CompletedDeal | null {
  if (trade.status !== 'completed') return null
  return {
    tradeId: trade.id,
    inputs: { give: gradeInputsOf(trade.sideA.gives), get: gradeInputsOf(trade.sideB.gives) },
    completedAt: trade.completedAt,
  }
}

/**
 * The one grade for each of these completed native trades, as seen by `userId` (a league member), keyed by trade
 * id. `teamsOf` names each trade's two teams (`Roster.id`s) so a receipt counts only when it grades both. A trade
 * that cannot be graded is absent, or present with the reason — never given a guessed letter.
 */
export async function gradeNativeCompletedTrades(
  args: { leagueId: string; userId: string; tradeIds: ReadonlyArray<string>; teamsOf?: (tradeId: string) => readonly string[] | null },
  deps: Partial<NativeCompletedDeps> = {},
): Promise<Map<string, NativeCompletedGrade>> {
  const d: NativeCompletedDeps = { ...defaultDeps, ...deps }
  const out = new Map<string, NativeCompletedGrade>()
  const ids = [...new Set(args.tradeIds)].filter(Boolean)
  if (!args.leagueId || !args.userId || ids.length === 0) return out

  // 1. The proposal receipt, where it graded every team.
  const receipts = await d.receipts(ids).catch(() => new Map<string, ProposalReceiptLetters>())
  const needOriginal: string[] = []
  for (const id of ids) {
    const r = receipts.get(id)
    const teams = args.teamsOf?.(id) ?? null
    const letters = r ? Object.keys(r.lettersByRoster) : []
    const covers = r && (teams ? teams.every((t) => r.lettersByRoster[t]) : letters.length >= 2)
    if (r && covers) {
      const day = dayLabel(r.capturedAt)
      out.set(id, { graded: true, lettersByRoster: r.lettersByRoster, moment: day ? `when it was proposed (${day})` : 'when it was proposed', basis: 'proposal_receipt' })
    } else {
      needOriginal.push(id)
    }
  }
  if (needOriginal.length === 0) return out

  // 2. The frozen completed original, for a trade older than receipts.
  const loaded = await Promise.all(
    needOriginal.map((tradeId) => d.load({ leagueId: args.leagueId, ref: { kind: 'af', tradeId }, userId: args.userId }).catch(() => null)),
  )
  const sides = new Map<string, { a: string; b: string }>()
  const deals: CompletedDeal[] = []
  for (const r of loaded) {
    if (!r?.ok) continue
    const deal = nativeDealOf(r.trade)
    if (!deal) continue
    deals.push(deal)
    sides.set(r.trade.id, { a: r.trade.sideA.teamId, b: r.trade.sideB.teamId })
  }
  if (deals.length === 0) return out

  const grades = await d.gradeAll({ afLeagueId: args.leagueId, deals }).catch(() => new Map<string, TradeGradeView>())
  for (const [tradeId, grade] of grades) {
    const s = sides.get(tradeId)
    if (!s) continue
    out.set(
      tradeId,
      grade.graded
        ? { graded: true, lettersByRoster: { [s.a]: grade.letter, [s.b]: grade.partnerLetter }, moment: gradeMoment(grade), basis: 'completed_original' }
        : { graded: false, reason: grade.reason },
    )
  }
  return out
}
