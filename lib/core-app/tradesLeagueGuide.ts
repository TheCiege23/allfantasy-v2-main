/**
 * The top of one league's Trades tab (/core/trades?league=…) in plain words (2026-11-13).
 *
 * The owner's ask, for every /core page: users should know what the page is for and what to do. The tab
 * opened on "Trade Center" and two sentences of explanation, then said the trade deadline three times —
 * a chip in the league line, a "Trade deadline Week 11" row under the builder, and a "Deadline · week 11"
 * line on each of 82 league tiles. The deadline is the one fact about trading in a league that changes
 * what you should do this week, so it leads, once, in the headline.
 *
 * Pure, so the rules are testable and the screen stays a renderer. Reads the server's countdown verdict
 * (lib/trade-deadline/tradeDeadlineCountdown.ts) — the same one the chip read — never the settings.
 */
import type { TradeDeadlineCountdown } from '@/lib/trade-deadline/tradeDeadlineCountdown'

type TradesLeagueHeadline =
  /** A week-only deadline in season. `weeksLeft` 0 = this is the last week to trade. */
  | { kind: 'weeks'; week: number; weeksLeft: number }
  /** A close time ahead — the screen says it with the live countdown text. */
  | { kind: 'counting' }
  /** The deadline has passed. */
  | { kind: 'closed'; week: number | null }
  /** A deadline exists but the season has not started. */
  | { kind: 'scheduled'; week: number | null }
  /** Only the deadline week is known — not whether the season has reached it. */
  | { kind: 'deadline'; week: number }
  /** The league has no deadline: trades stay open all season. */
  | { kind: 'open' }
  /** Nothing known about the deadline — the headline says what the page is for instead. */
  | { kind: 'build' }

export function tradesLeagueHeadline(
  countdown: TradeDeadlineCountdown | null | undefined,
  /** The import snapshot's deadline week, when the server had no countdown verdict. */
  fallbackWeek?: number | null,
): TradesLeagueHeadline {
  switch (countdown?.state) {
    case 'weeks':
      return { kind: 'weeks', week: countdown.deadlineWeek, weeksLeft: Math.max(0, countdown.weeksLeft) }
    case 'counting':
      return { kind: 'counting' }
    case 'closed':
      return { kind: 'closed', week: countdown.deadlineWeek }
    case 'scheduled':
      return { kind: 'scheduled', week: countdown.deadlineWeek }
    case 'none':
      return { kind: 'open' }
    default:
      return fallbackWeek != null ? { kind: 'deadline', week: fallbackWeek } : { kind: 'build' }
  }
}

/**
 * ⚠ THE SERVER WRITES THIS SENTENCE WITH A RAW ISO TIMESTAMP IN IT, and it is shared with every surface
 * that reads the completed-trade history (lib/core-app/sleeperTradeHistory.ts). Rather than change a
 * shared string, the Trades screen reads the time back out of it and says it in the viewer's own clock.
 * Anything that does not match — the "refresh is incomplete" notice, a future rewording — comes back
 * null and is shown as it was written.
 */
export function readHistoryNotice(notice: string | null | undefined): { refreshed: boolean; updatedAt: string } | null {
  const m = String(notice ?? '').match(/^Trade history checked with Sleeper( and refreshed)?\. Grades updated (\S+)\.$/)
  if (!m) return null
  const at = m[2]!
  if (!Number.isFinite(Date.parse(at))) return null
  return { refreshed: Boolean(m[1]), updatedAt: at }
}

/**
 * The realized grade's note, as its one number. The server sentence ("Realized under this league's
 * scoring: net 113.9 fantasy points while the assets were held. This result grade does not claim a
 * team-needs or playoff-probability adjustment.") was printed on every side of every card; the number is
 * the news, and the caveat is said once in the card's fold. Null when the note is anything else.
 */
export function realizedNet(note: string | null | undefined): number | null {
  const m = String(note ?? '').match(/^Realized under this league's scoring: net (-?\d+(?:\.\d+)?) fantasy points while the assets were held\./)
  return m ? Number(m[1]) : null
}
