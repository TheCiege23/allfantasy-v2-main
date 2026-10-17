import type { MyTeamRow } from './myTeamPulse'
import type { WaiverSchedule } from './waiverRunClock'

/**
 * The wire shape of /api/league/this-week — the league page's "This week" strip
 * (components/decide/ThisWeekStrip). Pure, so the route and the card share it without the card
 * importing server code.
 */

export type ThisWeekLineup = {
  week: number | null
  lockAt: string | null
  locked: boolean
  automatic: boolean
  starters: number
  /** Empty slots plus starters ruled out — the ones that need a change. */
  toFix: number
  questionable: number
  /** Starters we could not identify; the triage is incomplete when this is above zero. */
  unresolved: number
}

export type ThisWeekWaivers = { schedule: WaiverSchedule; observed: boolean }

export type ThisWeekTradeDeadline = { at: string | null; week: number | null }

export type ThisWeekPayload = {
  lineup: ThisWeekLineup | null
  waivers: ThisWeekWaivers | null
  tradeDeadline: ThisWeekTradeDeadline | null
}

/**
 * The My Team board's row for this league, as the strip's lineup tile. Null when the board itself
 * would not vouch for it: a prior-season roster, or a sync that failed (its counts are zeros that
 * would read as "lineup set").
 */
export function lineupFrom(row: MyTeamRow | undefined): ThisWeekLineup | null {
  if (!row || row.archived || row.syncFailed) return null
  return {
    week: row.week,
    lockAt: row.lockAt,
    locked: row.locked,
    automatic: Boolean(row.automatic || row.bestBall),
    starters: row.starters,
    toFix: row.empty + row.out,
    questionable: row.questionable,
    unresolved: row.unresolved,
  }
}
