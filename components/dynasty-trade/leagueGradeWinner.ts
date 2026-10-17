/**
 * THE grade on the dynasty trade analyzer, as data — no React, no "use client", so a server page (the
 * /trade/[id] share page) can read it as well as the form. `DynastyLeagueGrade.tsx` re-exports all of it.
 *
 * Orientation matches the route: each team's list is what that team GETS, so the receipt — taken from
 * Team A's side — sends B's list (`giveValue`) and receives A's (`getValue`).
 */
export type DynastyTradeGrade = {
  grade: string | null
  partnerGrade: string | null
  gradeLabel: string | null
  gradeWithheld: string | null
  giveValue: number | null
  getValue: number | null
}

/**
 * Who comes out ahead, read off THE letter (Team A's) and nothing else (2026-09-29). The page used to
 * name a winner from the dual-brain engine's own value totals, which could crown Team A beside a
 * league grade of D for Team A. Null when there is no letter: no grade, no winner.
 */
export function winnerFromLeagueGrade(tradeGrade: DynastyTradeGrade | null, teamAName: string, teamBName: string): string | null {
  const a = teamAName.trim() || 'Team A'
  const b = teamBName.trim() || 'Team B'
  switch (tradeGrade?.grade) {
    case 'A':
      return `${a} — major win`
    case 'B':
      return `Slight edge to ${a}`
    case 'C':
      return 'Even'
    case 'D':
      return `Slight edge to ${b}`
    case 'F':
      return `${b} — major win`
    default:
      return null
  }
}

export const NOT_GRADED_WINNER = 'Not graded'
