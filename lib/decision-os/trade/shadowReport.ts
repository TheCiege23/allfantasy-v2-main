/**
 * How often the design's 60/40 letter disagrees with the one grade, over saved receipts. PURE — the
 * rows come from `scripts/report-trade-grade-shadow.ts`, which reads `trade_decision_snapshots`.
 *
 * This is the evidence the letter switch waits on (Guap, 2026-09-27: shadow first). Rows with no
 * comparison are counted apart and never folded into "agree": a comparison that did not happen is not
 * an agreement.
 */

export type ShadowRow = { currentLetter: string | null; designLetter: string | null; agree: boolean | null }

export type ShadowTally = {
  receipts: number
  /** Both letters present. */
  compared: number
  agree: number
  disagree: number
  /** One or both letters missing — no comparison. */
  noComparison: number
  /** Agreement over compared receipts, in percent. Null with nothing compared. */
  agreementPct: number | null
  /** current letter → design letter → count, over compared receipts. */
  matrix: Record<string, Record<string, number>>
  /** Compared receipts where the letters sit two or more steps apart (e.g. A vs C). */
  farApart: number
}

const ORDER = ['A', 'B', 'C', 'D', 'F']

export function tallyShadow(rows: readonly (ShadowRow | null | undefined)[]): ShadowTally {
  const t: ShadowTally = { receipts: 0, compared: 0, agree: 0, disagree: 0, noComparison: 0, agreementPct: null, matrix: {}, farApart: 0 }
  for (const r of rows) {
    t.receipts++
    if (!r || !r.currentLetter || !r.designLetter) {
      t.noComparison++
      continue
    }
    t.compared++
    if (r.currentLetter === r.designLetter) t.agree++
    else t.disagree++
    const row = (t.matrix[r.currentLetter] ??= {})
    row[r.designLetter] = (row[r.designLetter] ?? 0) + 1
    const a = ORDER.indexOf(r.currentLetter)
    const b = ORDER.indexOf(r.designLetter)
    if (a >= 0 && b >= 0 && Math.abs(a - b) >= 2) t.farApart++
  }
  t.agreementPct = t.compared ? Math.round((t.agree / t.compared) * 1000) / 10 : null
  return t
}
