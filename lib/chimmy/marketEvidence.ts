/**
 * THE MARKET EVIDENCE BEHIND A TRADE GRADE, FOR CHIMMY TO CITE (owner's call, 2026-11-22).
 *
 * The grade already carries a reason on every line whose value moved (`TradeGradeView.moves` and, on a your-team letter,
 * `rosterFit.moves`). Some of those reasons were MEASURED from completed trades on AllFantasy — the trade market, the
 * learned pick / contend-rebuild / need tables, a lineup factor — and those are the evidence a manager can check: "teams
 * at .600 or better paid +8% for players 27 or older across 210 completed trades". This picks them out, verbatim, so
 * Chimmy can say WHY the letter is what it is without inventing a number. PURE; shared by the trade scenario and the
 * pending-offers block.
 */

/** A reason measured from completed trades — the trade market, the learned pick/posture/need tables, a lineup factor. */
// ⚠ "completed … trades" with words between: the trade market writes "41 completed Dynasty · 1QB trades".
const MEASURED = /\bcompleted\b[^;]*?\btrades\b|measured across \d[\d,]* trades/i
/** At most this many evidence lines reach the prompt; the strongest-evidenced first is not knowable here, so grade order. */
export const MAX_MARKET_EVIDENCE = 6

/**
 * The market evidence behind a grade, for Chimmy to cite (owner's call, 2026-11-22): every reason on a line whose value
 * moved that was MEASURED from completed trades, verbatim, prefixed with the asset. Reasons from the scoring settings
 * or the hand-set roster-need rule are left out — they are not trade evidence. A combined need reason ("you cannot fill
 * 1 TE slot…; teams short at TE paid +11%…") is split so only the measured half is quoted. PURE.
 */
export function marketEvidenceOf(grade: { moves?: ReadonlyArray<{ name: string; reasons: readonly string[] }>; rosterFit?: { moves: ReadonlyArray<{ name: string; reasons: readonly string[] }> } | null }): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of [...(grade.moves ?? []), ...(grade.rosterFit?.moves ?? [])]) {
    for (const reason of m.reasons) {
      for (const part of reason.split(/;\s+/)) {
        const text = part.trim().replace(/\.$/, '')
        if (!MEASURED.test(text)) continue
        const line = `${m.name}: ${text}`
        if (seen.has(line)) continue
        seen.add(line)
        out.push(line)
      }
    }
  }
  return out.slice(0, MAX_MARKET_EVIDENCE)
}

