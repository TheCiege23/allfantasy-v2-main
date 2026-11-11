import type { TradeGradeView } from './tradeGrade'
import { gradeMoment } from './gradeMoment'

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
 *
 * ── Rewritten 2026-11-11 from a manager's phone ──────────────────────────────────────────────────
 * "It only gives 1 grade, doesn't say for which team, and the summary isn't clear that it's even for
 * that league and not a general trade eval." The old sentences said who came out ahead, named the
 * best asset, and then pasted the chart label — with the roster-spot sentence the grader appends to
 * that label inside the same parentheses. Nothing tied the league's settings to THIS trade.
 *
 * Now, in order: who won and by how much; the letter EACH team got, by name; the biggest piece; what
 * about THIS league moved these values (Superflex with a QB in the deal, TE premium with a TE in it,
 * a player re-priced for this league, the open-roster-spot credit); and which settings and which
 * day's values the grade used. Every league sentence is gated on a fact the grade or the caller holds
 * — a format effect is stated only when a player at that position is in the trade.
 */

export type BreakdownParts = {
  /** Who won, by how much, in this league's values. */
  verdict: string
  /** Each team's letter, by name. */
  grades: string
  /** The biggest single piece, and who got it. */
  best: string | null
  /** What about this league's settings moves these values — only for positions in the trade. */
  league: string[]
  /** Players this league values differently from a typical league, with the reason. */
  moves: string[]
  /** The open-roster-spot credit, and who earned it. */
  rosterSpot: string | null
  /** Which settings and which day's values the grade used. */
  basis: string
}

const ARTICLE: Record<string, string> = { A: 'an', B: 'a', C: 'a', D: 'a', F: 'an' }

const isYou = (label: string) => label === 'You'

/** "You get an A" / "LeoMan gets an A". */
function getsLetter(label: string, letter: string): string {
  return `${isYou(label) ? 'you get' : `${label} gets`} ${ARTICLE[letter] ?? 'a'} ${letter}`
}

/**
 * The chart label without the roster-spot sentence `leagueTradeGrader` appends to it
 * ("… TE premium +0.5 Includes 178 for an open roster spot: …"). That sentence is restated on its
 * own line from `grade.rosterSpot`, so it must not also sit inside the settings parentheses.
 */
export function leagueFormatLabel(basis: string): string {
  return basis.replace(/\s+Includes [\d,]+ for (?:an open roster spot|\d+ open roster spots):[\s\S]*$/, '').trim()
}

function leagueSentences(format: string, positions: ReadonlySet<string>): string[] {
  const out: string[] = []
  if (positions.has('QB') && /\bsuperflex\b|\b2\s?qb\b/i.test(format)) {
    out.push('This league is Superflex (teams can start two QBs), so quarterbacks are worth more here than in a one-QB league.')
  }
  const tep = format.match(/TE premium \+?([\d.]+)/i)
  if (positions.has('TE') && tep) {
    out.push(`This league gives tight ends an extra ${tep[1]} points per catch, so tight ends are worth more here.`)
  }
  return out
}

export function oneGradeBreakdownParts(args: {
  grade: Graded
  receiverLabel: string
  partnerLabel: string
  /**
   * Positions of the players in the trade (QB, TE, …). Optional: without it the format sentences,
   * which only apply when a player at that position moved, are left out rather than guessed.
   */
  positions?: Iterable<string | null | undefined>
}): BreakdownParts {
  const { grade: g, receiverLabel: recv, partnerLabel: partner } = args
  const get = g.getValue.toLocaleString('en-US')
  const give = g.giveValue.toLocaleString('en-US')
  const pct = Math.abs(g.percentDiff)
  const recvWon = g.letter === 'A' || g.letter === 'B'
  const partnerWon = g.letter === 'D' || g.letter === 'F'

  // "% apart" is the gap as a share of the bigger side — the grade's own measure. Not "% more": 9,000
  // for 3,000 is 67% apart, and calling that "67% more" would understate a 200% difference.
  const verdict = recvWon
    ? `${recv} won this trade${g.letter === 'A' ? ' clearly' : ''}, getting ${get} in this league’s values for ${give} (${pct}% apart).`
    : partnerWon
      ? `${partner} won this trade${g.letter === 'F' ? ' clearly' : ''}, getting ${give} in this league’s values for ${get} (${pct}% apart).`
      : `This trade was about even in this league’s values: ${recv} got ${get} and ${partner} got ${give} (${pct}% apart).`

  const grades = `So ${getsLetter(recv, g.letter)} and ${partner} ${ARTICLE[g.partnerLetter] ?? 'a'} ${g.partnerLetter}.`

  const priced = g.lines.filter((l): l is typeof l & { leagueValue: number } => l.leagueValue != null)
  const top = [...priced].sort((a, b) => b.leagueValue - a.leagueValue)[0]
  let best: string | null = null
  if (top) {
    const toReceiver = top.side === 'get'
    const holder = toReceiver ? recv : partner
    const pronoun = top.assetKind === 'pick' || /^\d{4}\b/.test(top.name) ? 'it' : 'him'
    const value = top.leagueValue.toLocaleString('en-US')
    const holderLost = (recvWon && !toReceiver) || (partnerWon && toReceiver)
    best = holderLost
      ? `${holder} got the biggest piece, ${top.name} (${value}), but the other side got more value overall.`
      : `The biggest piece was ${top.name} (${value}), and ${isYou(holder) ? 'you' : holder} got ${pronoun}.`
  }

  const format = leagueFormatLabel(g.basis)
  const positions = new Set([...(args.positions ?? [])].filter((p): p is string => !!p).map((p) => p.toUpperCase()))
  const league = leagueSentences(format, positions)

  const moves = g.moves.map(
    (m) => `In this league ${m.name} is worth ${m.leagueValue.toLocaleString('en-US')} instead of ${m.base.toLocaleString('en-US')}: ${m.reasons.join('; ')}.`,
  )

  let rosterSpot: string | null = null
  if (g.rosterSpot) {
    // `side` names the total the credit joined: 'get' is the receiver's, 'give' the partner's.
    const who = g.rosterSpot.side === 'get' ? recv : partner
    const spots = g.rosterSpot.spots === 1 ? 'an open roster spot' : `${g.rosterSpot.spots} open roster spots`
    rosterSpot = `${who} got fewer players back, so ${isYou(who) ? 'your' : 'their'} total includes ${g.rosterSpot.value.toLocaleString('en-US')} for ${spots} to fill.`
  }

  const basis = `These grades use this league’s settings (${format}) and values ${gradeMoment(g)}.`
  return { verdict, grades, best, league, moves, rosterSpot, basis }
}

export function oneGradeBreakdown(args: Parameters<typeof oneGradeBreakdownParts>[0]): string[] {
  const p = oneGradeBreakdownParts(args)
  return [p.verdict, p.grades, ...(p.best ? [p.best] : []), ...p.league, ...p.moves, ...(p.rosterSpot ? [p.rosterSpot] : []), p.basis]
}
