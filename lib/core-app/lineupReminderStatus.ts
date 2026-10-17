import 'server-only'

import { categoryOn, proactiveDeliveryDeps, type ProactiveUserSettings } from '@/lib/chimmy-alerts/proactiveDelivery'
import {
  LINEUP_CHECK_CLOSES_BEFORE_MS,
  LINEUP_CHECK_OPENS_BEFORE_MS,
  lineupCheckMutedBy,
} from '@/lib/chimmy-alerts/lineupCheck'

/**
 * Whether Chimmy's pre-lock lineup check will reach this user — for the cross-league board.
 *
 * ⚠ THE REMINDER ALREADY EXISTS; THIS ONLY SAYS SO. `runLineupCheck` runs from the alert sweep every
 * 15 minutes, once a week per user, inside a window before the NFL main slate, and messages only
 * when a lineup needs fixing (production, week 3 2026: 36 users, 24 messaged, 11 clean). A second
 * sender from this board would double-notify the same people about the same holes. What the board
 * lacked was any line saying the check exists, whether it is on, and when it fires.
 *
 * ⚠ THE SENDER'S OWN GATES, NOT A COPY OF THEM. Settings are read through
 * `proactiveDeliveryDeps.loadSettings` and judged by `categoryOn` and `lineupCheckMutedBy` — the
 * exact calls `runLineupCheck` makes before it computes anything. A board that re-derived "on" from
 * the raw preferences row could say "on" to someone the sender skips.
 *
 * Per-league mutes are not reflected: a manager who muted two of twenty leagues is still "on".
 * Channel, quiet hours and contact availability are the dispatcher's, as for every notification.
 */

export type LineupReminderStatus = {
  /** `muted` = category on, but Chimmy's Lineup alerts are silenced in Chimmy's own controls. */
  state: 'on' | 'off' | 'muted'
  /** The window, in hours before the main slate — from the sender's constants, never restated. */
  opensHoursBefore: number
  closesHoursBefore: number
}

const HOUR_MS = 3_600_000

export function lineupReminderStateOf(settings: ProactiveUserSettings): LineupReminderStatus['state'] {
  if (!categoryOn(settings)) return 'off'
  return lineupCheckMutedBy(settings.chimmy) ? 'muted' : 'on'
}

/** Null when there is no settings profile — the sender skips such a user (`no_profile`), so say nothing. */
export async function getLineupReminderStatus(
  userId: string,
  loadSettings: (userId: string) => Promise<ProactiveUserSettings | null> = proactiveDeliveryDeps.loadSettings,
): Promise<LineupReminderStatus | null> {
  const settings = await loadSettings(userId)
  if (!settings) return null
  return {
    state: lineupReminderStateOf(settings),
    opensHoursBefore: LINEUP_CHECK_OPENS_BEFORE_MS / HOUR_MS,
    closesHoursBefore: LINEUP_CHECK_CLOSES_BEFORE_MS / HOUR_MS,
  }
}
