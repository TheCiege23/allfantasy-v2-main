/**
 * THE grade on the live draft's pick-trade builder (2026-09-28). PURE — the route builds the inputs
 * here and grades them with the league's own grader; the panel reads the result shape.
 *
 * The builder judged a pick swap by draft position alone — an accept/reject/counter chip, a fairness
 * chip ("strong value" … "overpay") and a "good/risky move" chip, three private scales no other trade
 * screen uses. Now a swap that the league's value chart CAN price carries the one grade instead.
 *
 * 🛑 ONLY A ROOKIE DRAFT IS GRADED. The grader prices a pick as a rookie-draft asset (year, round,
 * early/mid/late). In a startup or redraft draft a pick is worth the PLAYER taken there, which that
 * chart does not price — grading it anyway would hand out a confident letter about the wrong thing.
 * Those swaps say why they are not graded and keep the draft-position read, which is a fact.
 */

import { ANNUAL_C2C_DRAFT } from './annualC2CDraft'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import type { TradeGradeAction } from '@/lib/decision-os/trade/tradeGrade'
import { LARGE_LEAGUE_PICK_THRESHOLD } from '@/lib/fantasycalc-profile-capture'

export type DraftPickTradeGrade =
  | {
      graded: true
      /** The viewer's letter — the viewer is the side giving `give`. */
      letter: string
      partnerLetter: string
      label: string
      /** League value the viewer sends / receives — the totals the letter was taken on. */
      giveValue: number
      getValue: number
      recommendation: string
      /** The grade's own action for the viewer (`TradeGradeView.action`) — what a draft-room verdict is read from. */
      action?: TradeGradeAction
    }
  | { graded: false; reason: string }

export const NOT_A_ROOKIE_DRAFT_REASON =
  "Only rookie-draft picks are graded. In this draft a pick is worth the player taken there, which the league's value chart doesn't price — the draft-position read below still applies."

/** A rookie draft: labelled one, or drawing only on rookies. */
export function isRookieDraft(session: { draftModeLabel?: string | null; playerPool?: string | null }): boolean {
  const label = String(session.draftModeLabel ?? '').trim().toLowerCase()
  const pool = String(session.playerPool ?? '').trim().toLowerCase()
  return label === 'rookie' || label === ANNUAL_C2C_DRAFT || pool === 'rookies_only'
}

/**
 * Where a pick sits in its round, as the grader's pick chart reads it. From the OVERALL number, not
 * the slot: in a snake draft slot 1 picks LAST in round 2, and the chart prices when you pick, not
 * which slot you hold.
 */
export function pickTierInRound(input: {
  round: number
  overall: number | null
  slot: number
  teamCount: number
}): 'early' | 'mid' | 'late' {
  const tc = Math.max(2, Math.floor(input.teamCount) || 12)
  const inRound =
    input.overall != null && Number.isFinite(input.overall)
      ? input.overall - (input.round - 1) * tc
      : input.slot
  const pos = Math.min(tc, Math.max(1, inRound))
  if (pos <= Math.ceil(tc / 3)) return 'early'
  if (pos <= Math.ceil((2 * tc) / 3)) return 'mid'
  return 'late'
}

/**
 * The pick's position WITHIN its round (1 = the round's first selection), from the overall number —
 * the N in the market's "2026 Pick 1.04" rows. Null when the overall is unknown or outside the round.
 */
export function pickInRound(input: { round: number; overall: number | null; teamCount: number }): number | null {
  const tc = Math.max(2, Math.floor(input.teamCount) || 12)
  if (input.overall == null || !Number.isInteger(input.overall)) return null
  const inRound = input.overall - (input.round - 1) * tc
  return inRound >= 1 && inRound <= tc ? inRound : null
}

/**
 * One pick as the grader's input. A live draft's pick has an EXACT slot, so it carries `roundPick`
 * and is priced from the market's row for that slot when the league's chart has one; the tier stays
 * as the market's coarser fallback (`priceLeagueTradePick`).
 */
export function draftPickGradeAsset(input: {
  season: number
  round: number
  overall: number | null
  slot: number
  teamCount: number
  combined?: boolean
}): Extract<TradeAssetInput, { kind: 'pick' }> {
  const tier = pickTierInRound(input)
  const roundPick = input.combined ? null : pickInRound(input)
  return {
    kind: 'pick',
    year: input.season,
    round: input.round,
    tier,
    ...(roundPick != null ? { roundPick } : {}),
    ...(input.combined ? { draftSide: 'combined' as const } : {}),
    ...((input.combined || input.teamCount > LARGE_LEAGUE_PICK_THRESHOLD) && input.overall != null ? { overall: input.overall } : {}),
    label: `${input.season} ${input.combined ? 'Combined ' : ''}${tier} round ${input.round}${input.overall != null ? ` (#${input.overall})` : ''}`,
  }
}

/** The grader's view, reduced to what the builder shows. */
export function draftPickTradeGradeFrom(view: {
  graded: boolean
  letter?: string
  partnerLetter?: string
  label?: string
  giveValue?: number
  getValue?: number
  recommendation?: string
  action?: TradeGradeAction
  reason?: string
}): DraftPickTradeGrade {
  if (view.graded && view.letter && view.partnerLetter) {
    return {
      graded: true,
      letter: view.letter,
      partnerLetter: view.partnerLetter,
      label: view.label ?? '',
      giveValue: view.giveValue ?? 0,
      getValue: view.getValue ?? 0,
      recommendation: view.recommendation ?? '',
      ...(view.action ? { action: view.action } : {}),
    }
  }
  return { graded: false, reason: view.reason || 'This trade could not be graded just now.' }
}
