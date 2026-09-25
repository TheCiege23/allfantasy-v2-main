import type { TradeGradeView } from './tradeGrade'

type Graded = Extract<TradeGradeView, { graded: true }>

/**
 * Why a trade graded the way it did, in sentences — read off THE grade's own lines, so no number in
 * the explanation can disagree with the letter beside it. PURE.
 *
 * Replaces the rank-space breakdown (`lib/core-app/tradeBreakdown.ts`) on the surfaces that moved to
 * the one grade (2026-09-25). That module took RANKS so a display price could never be handed in by
 * mistake and contradict the letter; the same guarantee holds here by construction, because the only
 * numbers available are the ones the grade was taken on.
 *
 * `give` is what the receiver ("You", or the row's manager) SENT; `get` is what they received.
 */
export function oneGradeBreakdown(args: { grade: Graded; receiverLabel: string; partnerLabel: string }): string[] {
  const { grade: g, receiverLabel: recv, partnerLabel: partner } = args
  const get = g.getValue.toLocaleString()
  const give = g.giveValue.toLocaleString()
  const out: string[] = []

  switch (g.letter) {
    case 'A':
      out.push(`${recv} came out well ahead — ${get} in league value for ${give}.`)
      break
    case 'B':
      out.push(`${recv} got the better end of it — ${get} in league value for ${give}.`)
      break
    case 'C':
      out.push(`A near-even deal on league value — ${recv} got ${get} for ${give}.`)
      break
    case 'D':
      out.push(`${partner} got the better end — ${recv} got ${get} in league value for ${give}.`)
      break
    case 'F':
      out.push(`${partner} came out well ahead — ${recv} got only ${get} in league value for ${give}.`)
      break
  }

  const priced = g.lines.filter((l): l is typeof l & { leagueValue: number } => l.leagueValue != null)
  const best = [...priced].sort((a, b) => b.leagueValue - a.leagueValue)[0]
  if (best) {
    const toReceiver = best.side === 'get'
    const holder = toReceiver ? recv : partner
    const pronoun = /^\d{4}\b/.test(best.name) ? 'it' : 'him'
    const split = (g.percentDiff > 0 && !toReceiver) || (g.percentDiff < 0 && toReceiver)
    out.push(
      split && g.letter !== 'C'
        ? `Quality and quantity pulled apart: the best single asset was ${best.name}, and ${holder} got ${pronoun} — the other side won on the rest of the deal.`
        : `The most valuable asset was ${best.name}, and ${holder} got ${pronoun}.`,
    )
  }

  for (const m of g.moves) {
    out.push(`${m.name} is worth ${m.leagueValue.toLocaleString()} in this league against ${m.base.toLocaleString()} on the chart — ${m.reasons.join('; ')}.`)
  }
  out.push(`Graded on this league's values today (${g.basis}).`)
  return out
}
