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
 * 🛑 NO GRADE, NO VERDICT. A swap the chart cannot price — a pick with no market row, or a startup or
 * redraft draft whose board cannot be read (`NOT_A_ROOKIE_DRAFT_REASON`) — comes back `not_graded` with the
 * grade's reason. The draft-position move is still stated, because it is a fact; it is never turned back
 * into an accept/reject.
 *
 * STARTUP AND REDRAFT DRAFTS (owner's call, 2026-11-26). There a pick is worth the player taken with it,
 * so each pick is priced from THIS draft's remaining board — the league value of the players the draft
 * expects at that slot (`lib/trade-value-console/draftBoardPickPricing.ts`), through the same grader. Only
 * where that grader prices players on the NFL market chart (`pricesDraftBoard`); anywhere else, and when
 * the board cannot be read, the swap is withheld with `NOT_A_ROOKIE_DRAFT_REASON` exactly as before.
 */

import { createLeagueTradeGrader, gradeDeal, type LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { ANNUAL_C2C_DRAFT, annualC2CDraftSeason } from './annualC2CDraft'
import { resolveOverallForRoundSlot } from './draftPickTradeInventory'
import { loadLiveDraftBoard } from './draftBoardProjection'
import type { LiveDraftBoard } from '@/lib/trade-value-console/draftBoardPickPricing'
import {
  NOT_A_ROOKIE_DRAFT_REASON,
  draftPickBoardAsset,
  draftPickGradeAsset,
  isBoardPricedDraft,
  draftPickTradeGradeFrom,
  isRookieDraft,
  type DraftPickTradeGrade,
} from './draftPickTradeGrade'

/** The draft session fields a swap's grade depends on. */
export type DraftPickSwapSession = {
  /** The draft session's id — which draft's board a startup/redraft pick is priced from. Absent: the league's current draft. */
  id?: string | null
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

/**
 * Lazily-built grader, so a draft the chart cannot grade never loads one, and a list loads it once.
 * `board` reads a startup/redraft draft's remaining board (memoised the same way); a source without it
 * cannot price such a draft's picks, and they stay withheld.
 */
export type DraftPickGraderSource = (() => Promise<LeagueTradeGrader | null>) & {
  board?: (session: DraftPickSwapSession) => Promise<LiveDraftBoard | null>
}

/**
 * ⚠ THE CALLER HAS ALREADY PROVEN MEMBERSHIP (or commissioner access), exactly as
 * `createLeagueTradeGrader` requires. `userId` may be omitted where there is no viewer (an AI manager
 * answering for its roster): a pick swap is priced on league value, never on a viewer's roster need.
 */
export function draftPickTradeGraderSource(args: {
  leagueId: string
  userId?: string | null
  /** Injectable for tests; defaults to the DB read (`loadLiveDraftBoard`). */
  loadBoard?: (a: { leagueId: string; sessionId?: string | null }) => Promise<LiveDraftBoard | null>
}): DraftPickGraderSource {
  let pending: Promise<LeagueTradeGrader | null> | null = null
  const boards = new Map<string, Promise<LiveDraftBoard | null>>()
  const loadBoard = args.loadBoard ?? loadLiveDraftBoard
  const source: DraftPickGraderSource = () => {
    pending ??= createLeagueTradeGrader({ leagueId: args.leagueId, userId: args.userId ?? null }).catch(() => null)
    return pending
  }
  source.board = (session) => {
    const key = session.id ?? ''
    let hit = boards.get(key)
    if (!hit) {
      hit = loadBoard({ leagueId: args.leagueId, sessionId: session.id ?? null }).catch(() => null)
      boards.set(key, hit)
    }
    return hit
  }
  return source
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
export async function leagueGradeForDraftPickSwap(
  grader: DraftPickGraderSource,
  session: DraftPickSwapSession,
  swap: DraftPickSwap,
): Promise<DraftPickTradeGrade> {
  const combined = session.draftModeLabel === ANNUAL_C2C_DRAFT
  const season = draftPickSwapSeason(session)
  if (season == null) {
    return { graded: false, reason: combined ? 'This combined draft has no verified season.' : 'This draft has no season to price its picks in.' }
  }
  if (!isRookieDraft(session)) return leagueGradeForBoardPickSwap(grader, session, swap, season)
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

/**
 * A startup/redraft swap, priced from the draft's own remaining board. The board is read first, so a
 * draft with no readable board never loads the grader; every refusal is the pre-existing reason.
 */
async function leagueGradeForBoardPickSwap(
  grader: DraftPickGraderSource,
  session: DraftPickSwapSession,
  swap: DraftPickSwap,
  season: number,
): Promise<DraftPickTradeGrade> {
  const withheld: DraftPickTradeGrade = { graded: false, reason: NOT_A_ROOKIE_DRAFT_REASON }
  if (!isBoardPricedDraft(session) || !grader.board) return withheld
  const giveOverall = draftPickOverall(session, swap.give)
  const getOverall = draftPickOverall(session, swap.get)
  if (giveOverall == null || getOverall == null) return withheld
  try {
    const board = await grader.board(session)
    if (!board) return withheld
    const g = await grader()
    if (!g?.pricesDraftBoard) return withheld
    const asset = (pick: DraftPickRef, overall: number) =>
      draftPickBoardAsset({ season, round: pick.round, overall, slot: pick.slot, teamCount: session.teamCount })
    const view = await gradeDeal(g, {
      give: { assets: [asset(swap.give, giveOverall)], unpriceable: [] },
      get: { assets: [asset(swap.get, getOverall)], unpriceable: [] },
      viewerSide: false,
      draftBoard: board,
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
  const tradeGrade = await leagueGradeForDraftPickSwap(grader, session, swap)
  return { tradeGrade, review: draftPickTradeReviewFromGrade(tradeGrade, { session, swap, partnerName }) }
}
