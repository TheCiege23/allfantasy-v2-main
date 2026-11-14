/**
 * A grade for EACH team on a trade card (2026-11-14). The owner's ruling: "make sure the grade is explicit
 * for each team … it only shows 1 grade and doesn't show which team that grade is for. Everything has to be
 * simple and clear."
 *
 * The Trades board showed `letter` alone, labelled "Latest grade" — `fromName`'s grade — while the grade it
 * came from already held the other team's (`partnerLetter`, the mirror on league value: A↔F, B↔D, C↔C).
 * This turns the pair into what a reader needs first: who won, or that it was fair.
 *
 * Pure, so the rule is testable and the card stays a renderer.
 */

export type Letter = 'A' | 'B' | 'C' | 'D' | 'F'

const RANK: Record<Letter, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 }

export type TeamGrades = {
  /** `fromName`'s grade — the side listed first on the card. */
  first: Letter
  /** `toName`'s grade. */
  second: Letter
}

/** Both letters, or null when the trade was not graded (either letter missing). */
export function teamGrades(letter: Letter | null | undefined, partnerLetter: Letter | null | undefined): TeamGrades | null {
  if (!letter || !partnerLetter) return null
  return { first: letter, second: partnerLetter }
}

export type TradeVerdict = { kind: 'won'; winner: 'first' | 'second' } | { kind: 'fair' }

/**
 * Who won, read off the two letters — never off a separate number, so the headline cannot disagree with
 * the grades beside each side. Equal letters (C and C) are a fair trade.
 */
export function tradeVerdict(g: TeamGrades): TradeVerdict {
  if (RANK[g.first] === RANK[g.second]) return { kind: 'fair' }
  return { kind: 'won', winner: RANK[g.first] > RANK[g.second] ? 'first' : 'second' }
}

/** The tone a letter is drawn in: good (A, B), even (C), bad (D, F). */
export function letterTone(l: Letter): 'good' | 'warn' | 'bad' {
  return l === 'A' || l === 'B' ? 'good' : l === 'C' ? 'warn' : 'bad'
}
