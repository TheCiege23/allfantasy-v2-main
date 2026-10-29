/**
 * THE TRADE REVIEW WINDOW — and the sentence each manager reads about it.
 *
 * When the receiver accepts a trade in a league with review (commissioner or league vote), the review
 * window opens: `League.tradeReviewHours` (48 by default). The trade GOES THROUGH when the
 * window ends unless it was vetoed first — what ESPN, Sleeper and Yahoo do. Before this, an accepted
 * trade simply died at the offer's original deadline if nobody had approved it, which nobody was told.
 *
 *   commissioner review  the commissioner may approve early or veto until the window ends
 *   league vote          `vetoThreshold` veto votes kill it; that many approvals push it through early
 *
 * The window end is stored in the proposal's `expiresAt`, rewritten at acceptance: before acceptance it
 * is the offer's deadline, after it the review's. `acceptedAt` says which. The hourly sweep
 * (./tradeReviewWindowSweep.ts) processes due reviews, so "ends" means "within the hour after".
 *
 * Pure.
 */

/** `League.tradeReviewHours` when unset — the column's own default. */
export const DEFAULT_TRADE_REVIEW_HOURS = 48
/** The settings field allows 0–168; anything outside is clamped rather than trusted. */
export const MAX_TRADE_REVIEW_HOURS = 168

const HOUR_MS = 60 * 60 * 1000

/**
 * The league's window, from `League.tradeReviewHours` (League settings → Trades → "Review window
 * (hours)"). That field was saved, shown and audited, and no redraft trade ever read it until this.
 * 0 means no waiting: the trade goes through at the next hourly run unless it is vetoed first.
 */
export function tradeReviewWindowHours(raw: number | null | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_TRADE_REVIEW_HOURS
  return Math.min(MAX_TRADE_REVIEW_HOURS, Math.max(0, Math.floor(raw)))
}

export function reviewWindowEndsAt(acceptedAt: Date, hours: number): Date {
  return new Date(acceptedAt.getTime() + hours * HOUR_MS)
}

/** True once an accepted trade's review window has closed. */
export function reviewWindowEnded(p: { acceptedAt: Date | null; expiresAt: Date | null }, now: number): boolean {
  return Boolean(p.acceptedAt && p.expiresAt && p.expiresAt.getTime() <= now)
}

export type TradeReviewProposal = {
  status: string
  vetoMode: string | null
  vetoThreshold: number | null
  acceptedAt: Date | string | null
  expiresAt: Date | string | null
  votes?: ReadonlyArray<{ vote: string }> | null
}

export type TradeReviewExplainer = {
  phase: 'awaiting_receiver' | 'in_review' | 'review_ended' | 'settled' | 'none'
  reviewer: 'commissioner' | 'league_vote' | 'none'
  /** When the offer lapses (awaiting the receiver) or the review ends (in review). ISO. */
  endsAt: string | null
  votes: { approve: number; veto: number; needed: number } | null
  en: string
  es: string
}

const toDate = (v: Date | string | null): Date | null => (v == null ? null : v instanceof Date ? v : new Date(v))

function when(d: Date, lang: 'en' | 'es'): string {
  return d.toLocaleString(lang === 'es' ? 'es' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * What a manager should be told about a trade's review, in one or two sentences. `formatWhen` is
 * injectable so a test does not depend on the machine's time zone.
 */
export function explainTradeReview(
  p: TradeReviewProposal,
  now: number,
  formatWhen: (d: Date, lang: 'en' | 'es') => string = when,
): TradeReviewExplainer {
  const reviewer = p.vetoMode === 'league_vote' ? 'league_vote' : p.vetoMode === 'no_veto' ? 'none' : 'commissioner'
  const ends = toDate(p.expiresAt)
  const accepted = toDate(p.acceptedAt)
  const endsAt = ends ? ends.toISOString() : null

  if (p.status !== 'pending') {
    return { phase: 'settled', reviewer, endsAt: null, votes: null, en: '', es: '' }
  }
  if (!accepted) {
    const lapse = ends ? { en: ` The offer lapses ${formatWhen(ends, 'en')}.`, es: ` La oferta vence el ${formatWhen(ends, 'es')}.` } : { en: '', es: '' }
    const next =
      reviewer === 'none'
        ? { en: 'If accepted, it goes through right away.', es: 'Si se acepta, se procesa al instante.' }
        : reviewer === 'league_vote'
          ? { en: 'If accepted, the league can vote on it before it goes through.', es: 'Si se acepta, la liga puede votarlo antes de procesarse.' }
          : { en: 'If accepted, the commissioner reviews it before it goes through.', es: 'Si se acepta, el comisionado lo revisa antes de procesarse.' }
    return { phase: 'awaiting_receiver', reviewer, endsAt, votes: null, en: `Waiting on the other manager. ${next.en}${lapse.en}`, es: `Esperando al otro mánager. ${next.es}${lapse.es}` }
  }

  const needed = p.vetoThreshold ?? 4
  const votes =
    reviewer === 'league_vote'
      ? {
          approve: (p.votes ?? []).filter((v) => v.vote === 'approve').length,
          veto: (p.votes ?? []).filter((v) => v.vote === 'veto').length,
          needed,
        }
      : null

  if (ends && ends.getTime() <= now) {
    return {
      phase: 'review_ended',
      reviewer,
      endsAt,
      votes,
      en: 'The review window has ended with no veto. The trade is going through within the hour.',
      es: 'La ventana de revisión terminó sin veto. El traspaso se procesa en menos de una hora.',
    }
  }

  const by = ends ? { en: formatWhen(ends, 'en'), es: formatWhen(ends, 'es') } : null
  if (reviewer === 'league_vote' && votes) {
    const tally = `${votes.veto} of ${needed} veto votes`
    return {
      phase: 'in_review',
      reviewer,
      endsAt,
      votes,
      en: `Under league review: ${tally} so far. It goes through ${by ? `on ${by.en}` : 'when the review ends'} unless ${needed} managers veto it${votes.approve ? `, or sooner if ${needed} approve (${votes.approve} have)` : ''}.`,
      es: `En revisión de la liga: ${votes.veto} de ${needed} votos de veto. Se procesa ${by ? `el ${by.es}` : 'al terminar la revisión'} salvo que ${needed} mánagers lo veten${votes.approve ? `, o antes si ${needed} lo aprueban (van ${votes.approve})` : ''}.`,
    }
  }
  return {
    phase: 'in_review',
    reviewer,
    endsAt,
    votes: null,
    en: `Under commissioner review. It goes through ${by ? `on ${by.en}` : 'when the review ends'} unless the commissioner vetoes it; the commissioner can also approve it sooner.`,
    es: `En revisión del comisionado. Se procesa ${by ? `el ${by.es}` : 'al terminar la revisión'} salvo que el comisionado lo vete; también puede aprobarlo antes.`,
  }
}
