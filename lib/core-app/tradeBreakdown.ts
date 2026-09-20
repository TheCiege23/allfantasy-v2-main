import { rankToValue } from '@/lib/projections/tradeGrading'

/**
 * Why a trade graded the way it did, in sentences — the per-trade breakdown on the
 * cross-league board.
 *
 * The card already showed the letter and the value split. Both answer "who won" and
 * neither answers "why", which is what a manager actually reads a trade card for. The
 * `reasoning` line underneath is about the league's DEADLINE ("3 weeks until the week 11
 * deadline. 14 trades on file here.") and says nothing about the trade at all.
 *
 * 🛑 TEMPLATED FROM THE COMPUTED NUMBERS. NO GENERATED PROSE. This is the same rule
 * `lib/trade-value/grader.ts` states in its own header, and it is not a style preference:
 * a sentence a model writes about a trade can disagree with the letter printed beside it,
 * and the reader has no way to tell which one is lying.
 */

export type BreakdownAsset = {
  name: string
  kind: 'player' | 'pick'
  /** Null for a pick, and for a player the book has no position for. */
  position: string | null
  /**
   * The GRADING rank, not a market value.
   *
   * 🛑 THE MODULE CONVERTS THIS ITSELF, AND THAT IS THE WHOLE REASON THE FIELD IS A RANK.
   * `TradeAsset.value` is a market price carried for display and is documented as
   * "display only — NEVER summed"; the grade is computed in rank space by pushing each
   * rank through `rankToValue`. Taking a `value` here would let a caller hand over the
   * display number and get a breakdown that contradicts the letter beside it, with
   * nothing to catch it — both are plausible positive numbers. Taking a RANK makes that
   * mistake unrepresentable.
   */
  rank: number
}

export type TradeBreakdownArgs = {
  /** What `receiverLabel` received. */
  received: readonly BreakdownAsset[]
  /** What `receiverLabel` gave up. */
  gave: readonly BreakdownAsset[]
  /**
   * The letter as rendered on the card.
   *
   * ⚠ TAKEN AS AN INPUT RATHER THAN RE-DERIVED FROM `sharePct`, SO THE SENTENCE CANNOT
   * CONTRADICT THE BADGE. Re-deriving would duplicate `tradeGrading`'s band thresholds
   * here, and the day one of the two copies moves is the day the card reads "an even
   * deal" beside a D.
   */
  letter: 'A' | 'B' | 'C' | 'D' | 'F'
  /** Share of traded value that went to `receiverLabel`, as the grader computed it. */
  sharePct: number
  /** The manager whose history this is — often the literal string "You". */
  receiverLabel: string
  /** The other side. */
  partnerLabel: string
}

function uniq(xs: readonly string[]): string[] {
  return [...new Set(xs)]
}

function plural(n: number, one: string): string {
  return `${n} ${n === 1 ? one : `${one}s`}`
}

/**
 * "2 players (RB, WR) plus a 2027 1st" — what one side of the deal actually consisted of.
 *
 * Picks are named and players are counted by position on purpose: a pick's identity IS its
 * season and round, while "WR" plus a name adds nothing the asset rows above do not already
 * show.
 */
function describeSide(assets: readonly BreakdownAsset[]): string {
  const players = assets.filter((a) => a.kind === 'player')
  const picks = assets.filter((a) => a.kind === 'pick')
  const parts: string[] = []

  if (players.length > 0) {
    const pos = uniq(players.map((p) => p.position).filter((p): p is string => !!p))
    parts.push(pos.length > 0 ? `${plural(players.length, 'player')} (${pos.join(', ')})` : plural(players.length, 'player'))
  }
  if (picks.length > 0) parts.push(picks.map((p) => p.name).join(', '))

  return parts.join(' plus ')
}

/**
 * The single most valuable asset across both sides, and which side it landed on.
 *
 * ⚠ TIES RESOLVE TO THE FIRST ASSET IN A FIXED ORDER — received, then gave, each in the
 * order the caller supplied. Two identically-ranked assets are genuinely common (two
 * 2028 2nds), and a tie-break that depends on sort stability would let the sentence flip
 * between two renders of the same cached payload.
 */
function bestAsset(
  received: readonly BreakdownAsset[],
  gave: readonly BreakdownAsset[],
): { asset: BreakdownAsset; toReceiver: boolean } | null {
  let best: { asset: BreakdownAsset; toReceiver: boolean; value: number } | null = null
  for (const [assets, toReceiver] of [
    [received, true],
    [gave, false],
  ] as const) {
    for (const asset of assets) {
      const value = rankToValue(asset.rank)
      if (best === null || value > best.value) best = { asset, toReceiver, value }
    }
  }
  return best ? { asset: best.asset, toReceiver: best.toReceiver } : null
}

/**
 * Two to three sentences explaining a GRADED trade.
 *
 * 🛑 GRADED ONLY. An ungraded trade already renders `withheldTradeReason` where the letter
 * would be, and that sentence is the honest one — a breakdown of a trade we could not price
 * would be narrating assets the grader refused to count.
 */
export function buildTradeBreakdown(args: TradeBreakdownArgs): string[] {
  const { received, gave, letter, sharePct, receiverLabel: recv, partnerLabel: partner } = args

  // Both guarded by `gradeTrade`'s NO_ASSETS branch, which refuses the letter outright.
  // Repeated here because this function is exported and a caller need not have gone
  // through that path.
  if (received.length === 0 || gave.length === 0) return []

  const share = Math.round(Math.max(0, Math.min(100, sharePct)))
  const out: string[] = []

  switch (letter) {
    case 'A':
      out.push(`${recv} came out well ahead — ${share}% of the value in this deal.`)
      break
    case 'B':
      out.push(`${recv} got the better end of it, with ${share}% of the value.`)
      break
    case 'C':
      out.push(`A near-even deal — ${share}% to ${recv}, ${100 - share}% to ${partner}.`)
      break
    case 'D':
      out.push(`${partner} got the better end — ${recv} took ${share}%.`)
      break
    case 'F':
      out.push(`${partner} came out well ahead — ${recv} took only ${share}%.`)
      break
  }

  const best = bestAsset(received, gave)
  if (best) {
    const holder = best.toReceiver ? recv : partner
    const pronoun = best.asset.kind === 'player' ? 'him' : 'it'
    /*
     * ⚠ THE DIVERGENCE IS THE INFORMATIVE CASE, AND IT IS WHY THIS BULLET EXISTS AT ALL.
     * Winning on total value while giving up the best player in the deal is a real and
     * common shape — depth for a star — and the letter alone hides it completely. Where
     * the two agree the sentence is merely confirmatory, which is fine; where they
     * disagree it is the only place on the card that says so.
     */
    const totalWentToReceiver = letter === 'A' || letter === 'B'
    const totalWentToPartner = letter === 'D' || letter === 'F'
    const split =
      (totalWentToReceiver && !best.toReceiver) || (totalWentToPartner && best.toReceiver)

    out.push(
      split
        ? `Quality and quantity pulled apart: the best single asset was ${best.asset.name}, and ${holder} got ${pronoun} — the other side won on the rest of the deal.`
        : `The most valuable asset was ${best.asset.name}, and ${holder} got ${pronoun}.`,
    )
  }

  out.push(`${recv} sent ${describeSide(gave)} and got back ${describeSide(received)}.`)

  return out
}
