/**
 * Server- and library-written text in the native redraft Trade Center, in the reader's language.
 *
 * Each producer keeps the English it always sent and now also sends a stable CODE with its values: a
 * review check's `explanationParts`, a partner match's `matchReasonCodes`, a format's `reasonCode`, a
 * route's `code`, a reversal refusal's `messageCode`. These helpers turn the code into
 * `tradeCenter.*` copy.
 *
 * 🛑 ENGLISH NEVER GOES THROUGH HERE. Outside Spanish every helper returns the server's own English,
 * byte for byte, so the English screen cannot change. In Spanish, a code with no copy, or no code at
 * all (an older server, a stored review), falls back to that same English: never to a raw key.
 *
 * Reasons that arrive as English sentences from deeper modules (a withheld grade, a fact the review
 * could not read) go through `tradeVisualCopy`, the one English→Spanish catalog for trade text, so a
 * sentence is translated in one place for every screen that shows it.
 *
 * Client-safe: type imports only from the server modules, no Prisma.
 */
import type { ReviewCheck, ReviewTextPart, TradeReview } from '@/lib/decision-os/trade/tradeReview'
import { tradeVisualCopy } from '@/lib/core-app/tradeVisualCopy'
import { interpolateTemplate } from './interpolate'

type Translate = (key: string) => string
type Params = Record<string, string | number | undefined>

/** `t(key)`, or null when the dictionary has no copy for it (`t` returns the key itself then). */
function copy(t: Translate, key: string): string | null {
  const value = t(key)
  return value && value !== key ? value : null
}

/** A reason sentence a library wrote in English: in Spanish when the trade catalog knows it, else as written. */
export function localizeTradeReason(text: string, language: string): string {
  if (language !== 'es' || !text) return text
  return tradeVisualCopy(text, language)
}

/** Every `reason` value is itself a sentence to localize; the rest (names, numbers) pass through. */
function localizedParams(params: Params | undefined, language: string): Params {
  const out: Params = { ...(params ?? {}) }
  if (typeof out.reason === 'string') out.reason = localizeTradeReason(out.reason, language)
  return out
}

/**
 * A review check's explanation parts as one text (`tradeCenter.reviewText.<code>`, joined with a
 * space — the way `tradeReview.ts` joins the English). Null when any part has no copy. Exported for the
 * test that renders the English parts back into `explanation`, word for word.
 */
export function reviewPartsText(parts: readonly ReviewTextPart[], t: Translate, language: string): string | null {
  const out: string[] = []
  for (const p of parts) {
    if (p.code === 'reason') {
      const reason = p.params?.reason
      if (typeof reason !== 'string') return null
      out.push(localizeTradeReason(reason, language))
      continue
    }
    const template = copy(t, `tradeCenter.reviewText.${p.code}`)
    if (template == null) return null
    out.push(interpolateTemplate(template, localizedParams(p.params, language)))
  }
  return out.length ? out.join(' ') : null
}

/** What a check says, in the reader's language. */
export function reviewCheckExplanation(check: Pick<ReviewCheck, 'explanation' | 'explanationParts'>, t: Translate, language: string): string {
  if (language !== 'es' || !check.explanationParts?.length) return check.explanation
  return reviewPartsText(check.explanationParts, t, language) ?? check.explanation
}

const TEMPLATE_NONE = 'No review flags were raised for this trade.'
const TEMPLATE_FLAGGED = 'Flagged for the commissioner: '

/**
 * The note to the league. The deterministic template (`templateVerdict.ts`'s `commissionerBlock`) is
 * rebuilt from the review it was written from; an AI-written note is free-form and stays as written.
 * The rebuild only runs when the note has the template's shape, so a drifted template shows its English.
 */
export function commissionerNoteText(
  args: { note: string | null; source: 'ai' | 'template'; review: Pick<TradeReview, 'flags' | 'checks'> },
  t: Translate,
  language: string,
): string | null {
  const { note, source, review } = args
  if (!note || language !== 'es' || source !== 'template') return note
  const codes = review.flags.map((f) => f.code)
  const expectsFlags = codes.length > 0
  if (expectsFlags ? !note.startsWith(TEMPLATE_FLAGGED) : !note.startsWith(TEMPLATE_NONE)) return note
  const words: string[] = []
  for (const code of codes) {
    const w = copy(t, `tradeCenter.reviewText.flag.${code}`)
    if (w == null) return note
    words.push(w)
  }
  const head = expectsFlags
    ? copy(t, 'tradeCenter.reviewText.note.flagged')?.replace('{{flags}}', words.join('; '))
    : copy(t, 'tradeCenter.reviewText.note.none')
  if (!head) return note
  const gaps = review.checks.some((c) => c.status === 'not_computed') ? copy(t, 'tradeCenter.reviewText.note.gaps') : ''
  if (gaps == null) return note
  return gaps ? `${head} ${gaps}` : head
}

/** The imported trade's "act on" note (the review route's `actOn.note`). */
export function actOnNoteText(actOn: { platform: string; note: string }, t: Translate, language: string): string {
  if (language !== 'es') return actOn.note
  const template = copy(t, 'tradeCenter.review.actOnNote')
  return template ? interpolateTemplate(template, { platform: actOn.platform }) : actOn.note
}

/**
 * A failed request's message: the route's `code` as copy, else the English it sent.
 * The panels duck-type the error (`RedraftRequestError`) because tests mock `@/lib/redraft/client`.
 */
export function serverErrorText(
  error: { message?: string | null; code?: string | null } | null | undefined,
  fallback: string,
  t: Translate,
  language: string,
  /** `request`: the redraft trade routes (`tradeCenter.serverError.*`); `review`: the review route (`tradeCenter.review.error.*`). */
  scope: 'request' | 'review' = 'request',
): string {
  const prefix = scope === 'review' ? 'tradeCenter.review.error' : 'tradeCenter.serverError'
  const english = error?.message || fallback
  if (language !== 'es') return english
  const code = typeof error?.code === 'string' ? error.code : null
  const coded = code ? copy(t, `${prefix}.${code}`) : null
  if (coded) return coded
  // `parseJson`'s own message when the server sent no error at all.
  const status = /^Request failed \((\d{3})\)$/.exec(english)?.[1]
  const generic = status ? copy(t, 'tradeCenter.serverError.requestFailed') : null
  return generic ? interpolateTemplate(generic, { status: status! }) : english
}

/** A partner match's reasons, in order. The English list unless every code has copy. */
export function matchReasonsText(
  match: { matchReasons: string[]; matchReasonCodes?: Array<{ code: string; params?: Record<string, string> }> },
  t: Translate,
  language: string,
): string[] {
  const codes = match.matchReasonCodes
  if (language !== 'es' || !codes || codes.length !== match.matchReasons.length) return match.matchReasons
  const out: string[] = []
  for (const c of codes) {
    const template = copy(t, `tradeCenter.discovery.reason.${c.code}`)
    if (template == null) return match.matchReasons
    out.push(interpolateTemplate(template, c.params ?? {}))
  }
  return out
}

/** A format model's reason (`FormatAdjustment` / `TradeLegality`), by its `reasonCode`. */
export function formatReasonText(
  r: { reason?: string; reasonCode?: string; reasonParams?: Record<string, string | number> } | null | undefined,
  t: Translate,
  language: string,
): string | null {
  if (!r?.reason) return null
  if (language !== 'es' || !r.reasonCode) return r.reason
  const template = copy(t, `tradeCenter.value.formatReason.${r.reasonCode}`)
  return template ? interpolateTemplate(template, r.reasonParams ?? {}) : r.reason
}

/** A format model's label, by its id; a brand name with no Spanish of its own (Guilly, Keeper) stays. */
export function formatLabelText(formatId: string | null | undefined, label: string | null | undefined, t: Translate, language: string): string | null {
  if (!label) return null
  if (language !== 'es' || !formatId) return label
  return copy(t, `tradeCenter.value.formatLabel.${formatId}`) ?? label
}

/**
 * A reversal refusal (`lib/trade-reversal/client.ts`). A server `error` is said by its `code` when the
 * dictionary has one (`tradeCenter.reverseDialog.server.<CODE>`); one it does not know keeps its English
 * and still gets the Spanish «Nothing was changed» after a refused reversal.
 */
export function reversalMessageText(
  r: { message: string; messageCode?: string; serverError?: string | null; serverCode?: string | null; status?: number },
  phase: 'preflight' | 'outcome',
  t: Translate,
  language: string,
): string {
  if (language !== 'es' || !r.messageCode) return r.message
  if (r.messageCode !== 'server') return copy(t, `tradeCenter.reverseDialog.message.${phase}.${r.messageCode}`) ?? r.message
  const server =
    (r.serverCode && copy(t, `tradeCenter.reverseDialog.server.${r.serverCode}`)) ||
    (r.status === 404 ? copy(t, 'tradeCenter.reverseDialog.server.not_found') : null) ||
    r.serverError ||
    null
  if (!server) return r.message
  if (phase === 'preflight') return server
  const unchanged = copy(t, 'tradeCenter.reverseDialog.message.outcome.unchanged')
  return unchanged ? interpolateTemplate(unchanged, { error: server.replace(/\.$/, '') }) : r.message
}
