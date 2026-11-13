/**
 * The top of /core/trades in plain words (2026-11-13). The owner's ask: users should know what the trades
 * page is for. Everything here is read from the TradesBoard data the page already loads
 * (lib/core-app/tradesBoard.ts): AllFantasy-native offers waiting, each league's trade window, and the
 * most recent real trade in each league.
 *
 * Pure functions only, so the hub stays a renderer and the rules are testable.
 */
import type { TradesBoardData } from '@/lib/core-app/tradesBoard'

export type TradesSummary = {
  /** Offers someone sent you that you have not answered (AllFantasy-native; Sleeper never shares these). */
  offersWaiting: number
  /** Leagues whose newest trade landed this week or last (the loader's `freshTrade`). */
  newTrades: number
  /** Leagues whose trade deadline is this week or next — the window that is about to shut. */
  deadlinesSoon: number
  /** Leagues whose window is still open (a known deadline not yet passed). */
  openLeagues: number
}

/** "Soon" is this week or next: weeksLeft 0 or 1. Matches the board's own "THIS WEEK" / "1W LEFT" tags. */
export const DEADLINE_SOON_WEEKS = 1

export function summarizeTrades(board: Pick<TradesBoardData, 'pending' | 'windows'> | null | undefined): TradesSummary | null {
  if (!board) return null
  return {
    offersWaiting: board.pending.filter((p) => !p.youProposed).length,
    newTrades: board.windows.filter((w) => w.freshTrade === true).length,
    deadlinesSoon: board.windows.filter((w) => w.weeksLeft != null && w.weeksLeft >= 0 && w.weeksLeft <= DEADLINE_SOON_WEEKS).length,
    openLeagues: board.windows.filter((w) => w.weeksLeft != null && w.weeksLeft >= 0).length,
  }
}

/** Which sentence leads: an offer to answer beats news, news beats a quiet week, and no data says so. */
export type TradesHeadline =
  | { kind: 'offers'; n: number }
  | { kind: 'new'; n: number }
  | { kind: 'quiet' }
  | { kind: 'unknown' }

export function tradesHeadline(s: TradesSummary | null): TradesHeadline {
  if (!s) return { kind: 'unknown' }
  if (s.offersWaiting > 0) return { kind: 'offers', n: s.offersWaiting }
  if (s.newTrades > 0) return { kind: 'new', n: s.newTrades }
  return { kind: 'quiet' }
}

export type TradesChip = {
  key: 'offers' | 'new' | 'deadlines' | 'open'
  value: number
  /** Null when there is nothing to go to — a zero is a fact, not a link. */
  href: string | null
  tone: 'bad' | 'warn' | 'info' | 'plain'
}

/**
 * Up to four numbers, each said once on the page. Offers appear only when there is one — the section
 * they would link to exists only then (AllFantasy-native offers are almost always zero; see the
 * "Waiting on you" note in TradesBoard).
 */
export function tradesChips(s: TradesSummary | null): TradesChip[] {
  if (!s) return []
  const chips: TradesChip[] = []
  if (s.offersWaiting > 0) chips.push({ key: 'offers', value: s.offersWaiting, href: '#af-tr-pending', tone: 'bad' })
  chips.push({ key: 'new', value: s.newTrades, href: s.newTrades > 0 ? '#af-tg-trades' : null, tone: s.newTrades > 0 ? 'info' : 'plain' })
  chips.push({ key: 'deadlines', value: s.deadlinesSoon, href: s.deadlinesSoon > 0 ? '#af-tg-trades' : null, tone: s.deadlinesSoon > 0 ? 'warn' : 'plain' })
  chips.push({ key: 'open', value: s.openLeagues, href: s.openLeagues > 0 ? '#af-tg-trades' : null, tone: 'plain' })
  return chips
}
