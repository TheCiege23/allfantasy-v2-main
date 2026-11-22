/**
 * WHICH MEASURED EVIDENCE A GRADE USED, by kind (owner's call, 2026-11-22: the outcome check).
 *
 * A grade's reasons are text (`TradeGradeView.moves[].reasons`, and `rosterFit.moves` on a your-team letter). Each
 * source of measured evidence writes a reason with a fixed opening, so the kind can be read back from the saved
 * receipt — which is how the trade ledger splits its held-up record by what the grade rested on. PURE.
 */
export const EVIDENCE_KINDS = ['trade_market', 'pick_market', 'posture', 'need', 'lineup'] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

const PATTERNS: Array<[EvidenceKind, RegExp]> = [
  ['trade_market', /AllFantasy trade market [+-−]?\d/],
  ['pick_market', /AllFantasy pick market [+-−]?\d/],
  ['posture', /over middle-of-the-table teams across \d[\d,]* completed trades/],
  ['need', /teams short at [A-Z]+(?: this week \([^)]*\))? paid .* across \d[\d,]* completed trades/],
  ['lineup', /\bLineup [+-−]?\d.*measured across \d[\d,]* trades/],
]

type Moves = ReadonlyArray<{ reasons?: readonly unknown[] }> | undefined
type GradeLike = { moves?: Moves; rosterFit?: { moves?: Moves } | null }

/** The kinds of measured evidence anywhere in a grade's reasons, in a fixed order, each once. PURE. */
export function evidenceKindsOf(grade: unknown): EvidenceKind[] {
  const g = (grade && typeof grade === 'object' ? grade : {}) as GradeLike
  const reasons = [...(g.moves ?? []), ...(g.rosterFit?.moves ?? [])]
    .flatMap((m) => (Array.isArray(m?.reasons) ? m.reasons : []))
    .filter((r): r is string => typeof r === 'string')
  const found = new Set<EvidenceKind>()
  // Patterns match anywhere in a reason, so a combined one ("you cannot fill 1 TE slot; teams short at TE paid…") counts.
  for (const r of reasons) for (const [kind, re] of PATTERNS) if (re.test(r)) found.add(kind)
  return EVIDENCE_KINDS.filter((k) => found.has(k))
}
