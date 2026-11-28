/**
 * /core/decisions, the pure half (2026-11-26): the shape `GET /api/legacy/decision-log` answers, and how
 * one row reads — its headline, its TRADE GRADE and its OUTCOME grade, each kept apart. No server
 * imports, so the client screen, the harness and the tests read the same rules.
 *
 * 🛑 THE TRADE GRADE COMES ONLY FROM THE SERVER-WRITTEN STAMP the route already resolved
 * (`tradeGrade` / `tradeGradeWithheld`, from lib/decision-log-trade-grade.ts `decisionTradeGrade`). This
 * file never reads `aiRecommendation.grade`: before 2026-11-08 that field held the AI model's own
 * letter, and nothing on the row says which. A trade row without a stamp reads "not recorded", never a
 * borrowed letter. Rows that are not one deal (`trade_proposal`, waivers, start/sit) show no trade grade.
 */

export type DecisionLogOutcome = {
  outcomeGrade?: string | null
  evaluationWeeks?: number | null
  rosterValueDelta?: number | null
} | null

/** One row of the route's list view. */
export type DecisionLogRow = {
  id: string
  leagueId: string
  decisionType: string
  aiRecommendation: unknown
  createdAt: string
  userFollowed: boolean | null
  outcome: DecisionLogOutcome
  tradeGrade: string | null
  tradeGradeWithheld: string | null
  gradeLine?: string
}

/** The route's summary view (lib/decision-log.ts `DecisionSummary`). */
export type DecisionLogSummary = {
  total: number
  followed: number
  ignored: number
  pending: number
  followedWinRate: number
  ignoredWinRate: number
  avgConfidence: number
  byType: Record<string, { total: number; followed: number; avgOutcome: number | null }>
  tradeGradeCoverage?: { tradeDecisions: number; linked: number; graded: number }
}

export type TradeGradeView =
  | { kind: 'graded'; letter: string }
  | { kind: 'withheld'; reason: string }
  /** A trade row logged before the stamp existed. */
  | { kind: 'not_recorded' }
  /** Not one deal — no trade grade line at all. */
  | { kind: 'none' }

export type OutcomeView = { kind: 'graded'; grade: string; weeks: number | null } | { kind: 'awaiting' }

/** The decision types a trade grade belongs to: one deal per row (lib/decision-log-trade-grade.ts). */
const ONE_DEAL_TYPES = new Set(['trade'])

export function tradeGradeView(row: Pick<DecisionLogRow, 'decisionType' | 'tradeGrade' | 'tradeGradeWithheld'>): TradeGradeView {
  if (!ONE_DEAL_TYPES.has(row.decisionType)) return { kind: 'none' }
  const letter = typeof row.tradeGrade === 'string' ? row.tradeGrade.trim() : ''
  if (letter) return { kind: 'graded', letter }
  const reason = typeof row.tradeGradeWithheld === 'string' ? row.tradeGradeWithheld.trim() : ''
  if (reason) return { kind: 'withheld', reason }
  return { kind: 'not_recorded' }
}

export function outcomeView(outcome: DecisionLogOutcome): OutcomeView {
  const grade = outcome?.outcomeGrade && outcome.outcomeGrade !== 'N/A' ? outcome.outcomeGrade.trim() : ''
  if (!grade) return { kind: 'awaiting' }
  const weeks = typeof outcome?.evaluationWeeks === 'number' && outcome.evaluationWeeks > 0 ? outcome.evaluationWeeks : null
  return { kind: 'graded', grade, weeks }
}

/** What was decided: the analyzer's own one-line summary, when the row has one. */
export function decisionHeadline(row: Pick<DecisionLogRow, 'aiRecommendation'>): string | null {
  const rec = row.aiRecommendation
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null
  const summary = (rec as Record<string, unknown>).summary
  return typeof summary === 'string' && summary.trim() ? summary.trim() : null
}

/** A short second line from the row's own fields: the waiver's top pick. */
export function decisionDetail(row: Pick<DecisionLogRow, 'aiRecommendation'>): string | null {
  const rec = row.aiRecommendation
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null
  const r = rec as Record<string, unknown>
  const topPick = typeof r.topPick === 'string' && r.topPick.trim() ? r.topPick.trim() : null
  // Not `verdict`: the trade headline ("Trade: accept") already says it.
  return topPick
}

export type DecisionFilters = { type: string; leagueId: string }

/** Rows of one type (or all, for ''). League filtering is the route's (`leagueId`), so the summary agrees. */
export function filterDecisions<T extends Pick<DecisionLogRow, 'decisionType' | 'leagueId'>>(rows: readonly T[], f: DecisionFilters): T[] {
  return rows.filter((r) => (!f.type || r.decisionType === f.type) && (!f.leagueId || r.leagueId === f.leagueId))
}

/** The types present, in a fixed order, so the filter offers only what exists. */
const TYPE_ORDER = ['trade', 'trade_proposal', 'trade_finder', 'waiver', 'sit_start']
export function decisionTypesPresent(rows: ReadonlyArray<Pick<DecisionLogRow, 'decisionType'>>): string[] {
  const present = new Set(rows.map((r) => r.decisionType))
  return [...TYPE_ORDER.filter((t) => present.has(t)), ...[...present].filter((t) => !TYPE_ORDER.includes(t)).sort()]
}

/** How many outcomes landed on each letter, best first — the outcome record. */
export function outcomeRecord(rows: ReadonlyArray<Pick<DecisionLogRow, 'outcome'>>): Array<{ grade: string; count: number }> {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const o = outcomeView(r.outcome)
    if (o.kind === 'graded') counts.set(o.grade, (counts.get(o.grade) ?? 0) + 1)
  }
  return [...counts.entries()].map(([grade, count]) => ({ grade, count })).sort((a, b) => a.grade.localeCompare(b.grade))
}

/**
 * League names for the rows. A decision row keys its league on the PROVIDER league id (the analyzers log
 * the Sleeper league id), so both the provider id and the AllFantasy id map to the name.
 */
export function decisionLeagueNames(
  leagues: ReadonlyArray<{ id: string; name?: string | null; platformLeagueId?: string | null } | object>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of leagues) {
    const l = raw as { id?: unknown; name?: unknown; platformLeagueId?: unknown }
    const name = typeof l.name === 'string' && l.name.trim() ? l.name.trim() : null
    if (!name) continue
    if (typeof l.platformLeagueId === 'string' && l.platformLeagueId) out[l.platformLeagueId] = name
    if (typeof l.id === 'string' && l.id) out[l.id] = out[l.id] ?? name
  }
  return out
}
