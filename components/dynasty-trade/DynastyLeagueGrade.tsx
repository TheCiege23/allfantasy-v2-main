"use client"

import { noLeagueGradeHint } from "@/components/trade-evaluator/GradeLeaguePicker"

/**
 * THE grade on the dynasty trade analyzer (2026-09-27): the one trade engine's letter for each team,
 * the league values it was taken on, and why there is none when there is none.
 *
 * It replaces the page's two private "Fairness" letters (the deterministic verdict's and the AI
 * section's), which were on scales no other surface uses and could disagree with each other.
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
  const a = teamAName.trim() || "Team A"
  const b = teamBName.trim() || "Team B"
  switch (tradeGrade?.grade) {
    case "A":
      return `${a} — major win`
    case "B":
      return `Slight edge to ${a}`
    case "C":
      return "Even"
    case "D":
      return `Slight edge to ${b}`
    case "F":
      return `${b} — major win`
    default:
      return null
  }
}

export const NOT_GRADED_WINNER = "Not graded"

function letterTone(letter: string): string {
  if (letter.startsWith("A")) return "text-green-400"
  if (letter.startsWith("B")) return "text-cyan-400"
  if (letter.startsWith("C")) return "text-amber-400"
  return "text-red-400"
}

export function DynastyLeagueGrade({
  tradeGrade,
  teamAName,
  teamBName,
  leagueChosen,
  leagueOptionCount,
}: {
  tradeGrade: DynastyTradeGrade | null
  teamAName: string
  teamBName: string
  /** Whether a league was chosen for the grade when the analysis ran. */
  leagueChosen: boolean
  leagueOptionCount: number
}) {
  if (!tradeGrade) return null
  const a = teamAName.trim() || "Team A"
  const b = teamBName.trim() || "Team B"

  if (!tradeGrade.grade || !tradeGrade.partnerGrade) {
    return (
      <div data-testid="dynasty-grade-withheld" className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200">
        Not graded: {tradeGrade.gradeWithheld ?? "this trade could not be graded just now."}
        {!leagueChosen ? (
          <span data-testid="dynasty-grade-no-league-hint" className="mt-1 block text-gray-300">
            {noLeagueGradeHint(leagueOptionCount)}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <div data-testid="dynasty-grade" className="rounded-xl border border-cyan-500/30 bg-gradient-to-r from-cyan-950/30 to-purple-950/30 p-5">
      <div className="text-[11px] uppercase tracking-wider text-gray-400">League grade</div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="text-center">
          <div className={`text-5xl font-bold font-mono ${letterTone(tradeGrade.grade)}`}>{tradeGrade.grade}</div>
          <div className="mt-1 text-xs text-gray-300">{a}</div>
        </div>
        <div className="text-center">
          <div className={`text-5xl font-bold font-mono ${letterTone(tradeGrade.partnerGrade)}`}>{tradeGrade.partnerGrade}</div>
          <div className="mt-1 text-xs text-gray-300">{b}</div>
        </div>
      </div>
      {tradeGrade.gradeLabel ? <div className="mt-3 text-center text-sm font-semibold text-white">{tradeGrade.gradeLabel}</div> : null}
      {tradeGrade.getValue != null && tradeGrade.giveValue != null ? (
        <div className="mt-1 text-center text-xs text-gray-400">
          {a} gets {tradeGrade.getValue.toLocaleString()} for {tradeGrade.giveValue.toLocaleString()} in league value
        </div>
      ) : null}
    </div>
  )
}
