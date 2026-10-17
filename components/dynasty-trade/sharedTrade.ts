import { winnerFromLeagueGrade, type DynastyTradeGrade } from './leagueGradeWinner'

/**
 * 🛑 A SHARED TRADE (/trade/[id]) SHOWS THE ONE GRADE OR NO VERDICT AT ALL (2026-09-29).
 *
 * A share link stores what the dynasty analyzer showed. Until now that was the dual-brain engine's own
 * `winner`, `valueDelta` ("Side A total=…, delta=…"), `confidence`, `dynastyVerdict` and `vetoRisk` —
 * numbers and verdicts on a private scale no other trade screen uses, printed under AllFantasy's name
 * to whoever opened the link. New shares store THE grade (`leagueGrade`, the one trade engine's letters
 * for each team); the page names a winner only from it. A share stored before that carries no grade,
 * so it shows no winner, no delta and no confidence — never the private scale.
 */

/** The grade as a share stores it: the six fields `DynastyLeagueGrade` draws, nothing else. */
export function shareableLeagueGrade(tradeGrade: DynastyTradeGrade | null): DynastyTradeGrade | null {
  if (!tradeGrade) return null
  return {
    grade: tradeGrade.grade,
    partnerGrade: tradeGrade.partnerGrade,
    gradeLabel: tradeGrade.gradeLabel,
    gradeWithheld: tradeGrade.gradeWithheld,
    giveValue: tradeGrade.giveValue,
    getValue: tradeGrade.getValue,
  }
}

export type SharedTradeView = {
  teamAName: string
  teamBName: string
  leagueContext: string | null
  /** The stored one grade; null on a share made before shares carried it. */
  leagueGrade: DynastyTradeGrade | null
  /** Read off the stored letter — null when there is none. Never the stored `winner`. */
  winner: string | null
  factors: string[]
  agingConcerns: string[]
  recommendations: string[]
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function storedGrade(raw: unknown): DynastyTradeGrade | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  return {
    grade: str(g.grade),
    partnerGrade: str(g.partnerGrade),
    gradeLabel: str(g.gradeLabel),
    gradeWithheld: str(g.gradeWithheld),
    giveValue: num(g.giveValue),
    getValue: num(g.getValue),
  }
}

/**
 * What /trade/[id] may print from a stored share (PURE). Reads only the grade and the analysis's
 * explanatory lists; the stored `winner`, `valueDelta`, `confidence`, `dynastyVerdict` and `vetoRisk`
 * are not read at all, whatever an old share holds.
 *
 * ⚠ An old share's `factors` are not read either: when the AI was unavailable they were the
 * deterministic engine's reasons, whose first line IS its verdict on the private scale ("Side A has a
 * 12% value edge: 5,000 (A) vs 4,400 (B)"). A share that carries the grade was made by the analyzer
 * that no longer sends those (app/api/dynasty-trade-analyzer/route.ts, the same change).
 */
export function readSharedTrade(analysis: unknown): SharedTradeView {
  const a = (analysis && typeof analysis === 'object' ? analysis : {}) as Record<string, unknown>
  const teamAName = str(a.teamAName)?.trim() || 'Team A'
  const teamBName = str(a.teamBName)?.trim() || 'Team B'
  const leagueGrade = storedGrade(a.leagueGrade)
  return {
    teamAName,
    teamBName,
    leagueContext: str(a.leagueContext),
    leagueGrade,
    winner: winnerFromLeagueGrade(leagueGrade, teamAName, teamBName),
    factors: leagueGrade ? strings(a.factors) : [],
    agingConcerns: strings(a.agingConcerns),
    recommendations: strings(a.recommendations),
  }
}
