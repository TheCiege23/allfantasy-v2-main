/**
 * WHEN a trade letter was taken, in a manager's words. PURE and client-safe.
 *
 * A completed provider trade's letter is its FROZEN ORIGINAL (`frozenCompletedGrade.ts`) — and every
 * surface that used to say "on this league's values today" was, from 2026-09-28, printing a claim
 * about the wrong moment. A live grade is still today's.
 *
 * 🛑 SINCE 2026-10-03 THE ORIGINAL SAYS HOW IT WAS PRICED (Guap's ruling: priced at the time of the
 * trade). Every phrase below completes "on this league's values …":
 *
 *   trade_date    "at the time of the trade (Sep 14)"
 *   first_graded  "from Sep 30, 2026, 16 days after the trade (no market record from the trade date)"
 *   (v1 / legacy) "when first graded Sep 30" — an original nothing has yet checked against the
 *                 stored market, so it must not claim there is no record from the trade date.
 *   live          "today"
 *
 * Spanish is produced here too (`language: 'es'`), and `gradeMomentToSpanish` translates an English
 * phrase already embedded in a sentence (`tradeUiCopy`), so a surface never pairs a Spanish sentence
 * with an English moment.
 */

export type GradeMomentInput = {
  frozenAt?: string | null
  frozenBasis?: 'trade_date' | 'first_graded' | null
  pricedAsOf?: string | null
  tradeAt?: string | null
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const ES_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const

type Day = { y: number; m: number; d: number }

/** A calendar day: a bare YYYY-MM-DD is that day; a moment is its day in New York (the app's clock). */
function dayOf(value: string | null | undefined): Day | null {
  if (!value) return null
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (bare) return { y: Number(bare[1]), m: Number(bare[2]), d: Number(bare[3]) }
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return null
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(at))
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const day = { y: n('year'), m: n('month'), d: n('day') }
  return Number.isFinite(day.y) && Number.isFinite(day.m) && Number.isFinite(day.d) ? day : null
}

const serial = (x: Day) => Date.UTC(x.y, x.m - 1, x.d) / 86_400_000

function fmt(x: Day, es: boolean, year: boolean): string {
  if (es) return `${x.d} ${ES_MONTHS[x.m - 1]}${year ? ` ${x.y}` : ''}`
  return `${EN_MONTHS[x.m - 1]} ${x.d}${year ? `, ${x.y}` : ''}`
}

function afterTrade(gap: number, es: boolean): string {
  if (es) return gap === 0 ? 'el mismo día del traspaso' : `${gap} ${gap === 1 ? 'día' : 'días'} después del traspaso`
  return gap === 0 ? 'the day of the trade' : `${gap} ${gap === 1 ? 'day' : 'days'} after the trade`
}

export function gradeMoment(grade: GradeMomentInput | null | undefined, language: string = 'en'): string {
  const es = language === 'es'
  const frozen = dayOf(grade?.frozenAt)
  if (!frozen) return es ? 'de hoy' : 'today'
  const traded = dayOf(grade?.tradeAt)

  if (grade?.frozenBasis === 'trade_date') {
    const when = traded ?? dayOf(grade.pricedAsOf) ?? frozen
    return es ? `en la fecha del traspaso (${fmt(when, true, false)})` : `at the time of the trade (${fmt(when, false, false)})`
  }

  if (grade?.frozenBasis === 'first_graded' && traded) {
    const priced = dayOf(grade.pricedAsOf) ?? frozen
    const after = afterTrade(Math.max(0, Math.round(serial(priced) - serial(traded))), es)
    return es
      ? `del ${fmt(priced, true, true)}, ${after} (no hay registro del mercado de la fecha del traspaso)`
      : `from ${fmt(priced, false, true)}, ${after} (no market record from the trade date)`
  }

  // A v1 original, or one whose trade time is unknown: when it was first graded, and nothing more.
  return es ? `cuando se calificó por primera vez el ${fmt(frozen, true, false)}` : `when first graded ${fmt(frozen, false, false)}`
}

/** The fields `gradeMoment` reads, picked off a grade — for a surface that carries a compact copy. */
export function gradeMomentOf(grade: GradeMomentInput | null | undefined): Required<GradeMomentInput> {
  return {
    frozenAt: grade?.frozenAt ?? null,
    frozenBasis: grade?.frozenBasis ?? null,
    pricedAsOf: grade?.pricedAsOf ?? null,
    tradeAt: grade?.tradeAt ?? null,
  }
}

const esDate = (month: string, day: string, year?: string): string | null => {
  const i = (EN_MONTHS as readonly string[]).indexOf(month)
  return i < 0 ? null : `${Number(day)} ${ES_MONTHS[i]}${year ? ` ${year}` : ''}`
}

/**
 * The Spanish for an English `gradeMoment` phrase, or null when `english` is not one. For a sentence
 * that embedded the English phrase before it reached the language switch (`tradeUiCopy`).
 */
export function gradeMomentToSpanish(english: string): string | null {
  if (english === 'today') return 'de hoy'
  const atTrade = /^at the time of the trade \(([A-Z][a-z]{2}) (\d{1,2})\)$/.exec(english)
  if (atTrade) {
    const d = esDate(atTrade[1]!, atTrade[2]!)
    return d ? `en la fecha del traspaso (${d})` : null
  }
  const from = /^from ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (?:the day of the trade|(\d+) days? after the trade) \(no market record from the trade date\)$/.exec(english)
  if (from) {
    const d = esDate(from[1]!, from[2]!, from[3]!)
    return d ? `del ${d}, ${afterTrade(from[4] ? Number(from[4]) : 0, true)} (no hay registro del mercado de la fecha del traspaso)` : null
  }
  const first = /^when first graded ([A-Z][a-z]{2}) (\d{1,2})$/.exec(english)
  if (first) {
    const d = esDate(first[1]!, first[2]!)
    return d ? `cuando se calificó por primera vez el ${d}` : null
  }
  return null
}

/** Today's letter for the side that sends `give`, when a frozen original has since moved — else null. */
export function movedLetter(
  grade: { letter?: string; current?: { letter: string } | null } | null | undefined,
): string | null {
  const now = grade?.current?.letter
  return now && now !== grade?.letter ? now : null
}
