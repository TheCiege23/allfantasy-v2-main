/**
 * THE draft-room verdict on a pick swap (2026-11-26). Every surface that judges a live-draft pick trade —
 * the builder preview, the receiver's private review, the offer DM and notification, the league trade
 * feed, the trade suggestions and the AI managers that answer offers for AI/orphan rosters — reads it
 * from here, and here reads it from the ONE canonical grade (`createLeagueTradeGrader` → `gradeDeal`).
 *
 * 🛑 THIS REPLACES `DraftTradeAiReviewService`, which judged a swap by overall-pick distance alone
 * ("Pick downgrade is too large…", "Pick values are close…") — a private scale no other trade screen
 * used, that could call a swap ACCEPT while the league grade said D. Nothing here prices anything: the
 * accept/counter/reject verdict is the grade's own `action`, and every number is the grade's.
 *
 * 🛑 NO GRADE, NO VERDICT. A swap the chart cannot price — a startup or redraft draft, where a pick is
 * worth the player taken there (`NOT_A_ROOKIE_DRAFT_REASON`), or a pick with no market row — comes back
 * `not_graded` with the grade's reason. The draft-position move is still stated, because it is a fact;
 * it is never turned back into an accept/reject.
 */

import { createLeagueTradeGrader, gradeDeal, type LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { ANNUAL_C2C_DRAFT, annualC2CDraftSeason } from './annualC2CDraft'
import { resolveOverallForRoundSlot } from './draftPickTradeInventory'
import {
  NOT_A_ROOKIE_DRAFT_REASON,
  draftPickGradeAsset,
  draftPickTradeGradeFrom,
  isRookieDraft,
  type DraftPickTradeGrade,
} from './draftPickTradeGrade'

/** The draft session fields a swap's grade depends on. */
export type DraftPickSwapSession = {
  teamCount: number
  draftType?: string | null
  thirdRoundReversal?: boolean | null
  draftModeLabel?: string | null
  playerPool?: string | null
  c2cConfig?: unknown
  startedAt?: Date | string | null
  createdAt?: Date | string | null
}

export type DraftPickRef = { round: number; slot: number }

/** accept / counter / reject come from the grade's action; `even` is its C band; `not_graded` is a withheld grade. */
export type DraftPickTradeVerdict = 'accept' | 'counter' | 'reject' | 'even' | 'not_graded'

/** The shape the draft room, the private DM and the AI managers have always read. */
export type DraftPickTradeReview = {
  verdict: DraftPickTradeVerdict
  reasons: string[]
  declineReasons: string[]
  counterReasons: string[]
  summary: string
  suggestedCounterPackage: string | null
}

export type DraftPickSwap = {
  /** The side being judged gives this pick… */
  give: DraftPickRef
  /** …and gets this one. */
  get: DraftPickRef
}

/** Lazily-built grader, so a draft the chart cannot grade never loads one, and a list loads it once. */
export type DraftPickGraderSource = () => Promise<LeagueTradeGrader | null>

/**
 * ⚠ THE CALLER HAS ALREADY PROVEN MEMBERSHIP (or commissioner access), exactly as
 * `createLeagueTradeGrader` requires. `userId` may be omitted where there is no viewer (an AI manager
 * answering for its roster): a pick swap is priced on league value, never on a viewer's roster need.
 */
export function draftPickTradeGraderSource(args: { leagueId: string; userId?: string | null }): DraftPickGraderSource {
  let pending: Promise<LeagueTradeGrader | null> | null = null
  return () => {
    pending ??= createLeagueTradeGrader({ leagueId: args.leagueId, userId: args.userId ?? null }).catch(() => null)
    return pending
  }
}

function draftTypeOf(session: DraftPickSwapSession): 'snake' | 'linear' | 'auction' {
  const t = String(session.draftType ?? 'snake')
  return t === 'linear' || t === 'auction' ? t : 'snake'
}

/** The overall selection number of a round/slot on this draft's board (snake / linear / 3RR). */
export function draftPickOverall(session: DraftPickSwapSession, pick: DraftPickRef): number | null {
  return resolveOverallForRoundSlot({
    round: pick.round,
    slot: pick.slot,
    teamCount: session.teamCount,
    draftType: draftTypeOf(session),
    thirdRoundReversal: Boolean(session.thirdRoundReversal),
  })
}

/** The season the draft's picks belong to: a combined draft's verified season, else the year it started. */
export function draftPickSwapSeason(session: DraftPickSwapSession): number | null {
  if (session.draftModeLabel === ANNUAL_C2C_DRAFT) return annualC2CDraftSeason(session)
  const at = session.startedAt ?? session.createdAt
  const year = at ? new Date(at).getUTCFullYear() : NaN
  return Number.isInteger(year) ? year : null
}

/**
 * THE grade of one swap, for the side that gives `give`. League value only (`viewerSide: false`): need
 * never changes the letter, and roster reads stay off a live-draft request path.
 */
export async function gradeDraftPickSwap(
  grader: DraftPickGraderSource,
  session: DraftPickSwapSession,
  swap: DraftPickSwap,
): Promise<DraftPickTradeGrade> {
  const combined = session.draftModeLabel === ANNUAL_C2C_DRAFT
  const season = draftPickSwapSeason(session)
  if (season == null) {
    return { graded: false, reason: combined ? 'This combined draft has no verified season.' : 'This draft has no season to price its picks in.' }
  }
  if (!isRookieDraft(session)) return { graded: false, reason: NOT_A_ROOKIE_DRAFT_REASON }
  const asset = (pick: DraftPickRef) =>
    draftPickGradeAsset({
      season,
      round: pick.round,
      overall: draftPickOverall(session, pick),
      slot: pick.slot,
      teamCount: session.teamCount,
      combined,
    })
  try {
    const view = await gradeDeal(await grader(), {
      give: { assets: [asset(swap.give)], unpriceable: [] },
      get: { assets: [asset(swap.get)], unpriceable: [] },
      viewerSide: false,
    })
    return draftPickTradeGradeFrom(view)
  } catch {
    return { graded: false, reason: 'This trade could not be graded just now.' }
  }
}

export function draftPickLabel(pick: DraftPickRef): string {
  return `${pick.round}.${String(pick.slot).padStart(2, '0')}`
}

/** The draft-position move — a fact about the board, never a verdict. */
export function draftPositionFact(session: DraftPickSwapSession, swap: DraftPickSwap): string {
  const g = draftPickOverall(session, swap.give)
  const r = draftPickOverall(session, swap.get)
  const gl = draftPickLabel(swap.give)
  const rl = draftPickLabel(swap.get)
  if (g == null || r == null) return `You send ${gl} and get ${rl}.`
  if (r === g) return `You send ${gl} (#${g}) and get ${rl} (#${r}).`
  const n = Math.abs(r - g)
  return `You send ${gl} (#${g}) and get ${rl} (#${r}) — ${r < g ? 'up' : 'back'} ${n} pick${n === 1 ? '' : 's'}.`
}

function verdictFor(grade: DraftPickTradeGrade): DraftPickTradeVerdict {
  if (!grade.graded) return 'not_graded'
  switch (grade.action) {
    case 'accept':
      return 'accept'
    case 'counter':
      return 'counter'
    case 'decline':
      return 'reject'
    case 'review':
      return 'even'
    default:
      return 'not_graded'
  }
}

/**
 * The review the draft room shows, drawn entirely from the grade. `partnerName` only labels their letter.
 */
export function draftPickTradeReviewFromGrade(
  grade: DraftPickTradeGrade,
  ctx: { session: DraftPickSwapSession; swap: DraftPickSwap; partnerName?: string | null },
): DraftPickTradeReview {
  const fact = draftPositionFact(ctx.session, ctx.swap)
  const verdict = verdictFor(grade)
  if (!grade.graded || verdict === 'not_graded') {
    const reason = grade.graded ? 'This trade could not be graded just now.' : grade.reason
    return { verdict: 'not_graded', reasons: [reason, fact], declineReasons: [], counterReasons: [], summary: reason, suggestedCounterPackage: null }
  }
  const them = ctx.partnerName?.trim() || 'them'
  const reasons = [
    `League grade: you ${grade.letter}, ${them} ${grade.partnerLetter}${grade.label ? ` — ${grade.label}` : ''}.`,
    `League value: you send ${Math.round(grade.giveValue).toLocaleString()} and get ${Math.round(grade.getValue).toLocaleString()}.`,
    fact,
  ]
  return {
    verdict,
    reasons,
    declineReasons: verdict === 'reject' ? [grade.recommendation] : [],
    counterReasons: verdict === 'counter' ? [grade.recommendation] : [],
    summary: grade.recommendation || reasons[0],
    suggestedCounterPackage: null,
  }
}

/** Grade and review in one call — what every per-swap surface wants. */
export async function reviewDraftPickSwap(
  grader: DraftPickGraderSource,
  session: DraftPickSwapSession,
  swap: DraftPickSwap,
  partnerName?: string | null,
): Promise<{ tradeGrade: DraftPickTradeGrade; review: DraftPickTradeReview }> {
  const tradeGrade = await gradeDraftPickSwap(grader, session, swap)
  return { tradeGrade, review: draftPickTradeReviewFromGrade(tradeGrade, { session, swap, partnerName }) }
}
