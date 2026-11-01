/**
 * Commissioner schedule regeneration: which weeks may be rewritten, and when it is refused.
 *
 * Pure — no prisma, no server imports — so the rules are tested directly and the commissioner panel
 * can import the wire constants below without pulling the server graph into the client bundle.
 *
 * 🛑 REGENERATION ONLY REWRITES WEEKS THAT HAVE NOT STARTED. The earlier write path deleted every
 * `RedraftMatchup` of the season, and with `commissionerOverride` it did so even over scored and
 * final weeks — results, standings inputs and all. Now everything up to and including the last
 * started week is kept exactly as it is, and only the weeks after it are rebuilt.
 *
 * A week has started when any of these is true:
 *   - it is before the season's `currentWeek` (the roller or the commissioner already moved past it);
 *   - any of its matchups has left `scheduled` (scoring writes `active`, the finalizer `final`,
 *     a lock `locked`) or carries a non-zero score;
 *   - for a daily sport (NBA, NHL, MLB, NCAAB, SOCCER), its calendar window has opened — the week
 *     roller can lag the calendar by up to an hour, and a game played in that hour already counts.
 *
 * ⚠ `currentWeek` ALONE IS NOT "IN PROGRESS". Draft finalization writes `status: 'active'` and
 * `currentWeek: 1` the moment the draft ends, weeks before the real season starts; treating the
 * current week as started would make the one window a commissioner most wants (after the draft,
 * before kickoff) the one window regeneration is refused.
 */

import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { seasonSportToLeagueSport } from '@/lib/season-week/standardSeasonScope'

/**
 * Mid-season confirmation wire contract — the same code and flag the scoring/roster editors use,
 * so one client helper can answer both: a 409 with this code, re-sent with `{ [flag]: true }`.
 */
export const SCHEDULE_REGEN_CONFIRMATION_CODE = 'mid_season_confirmation_required'
export const SCHEDULE_REGEN_CONFIRM_FLAG = 'confirmMidSeasonChange'
export const SCHEDULE_REGEN_CONFIRMATION_MESSAGE =
  "This league's season has started. Regenerating keeps every week that has started and rebuilds only the weeks after it. Confirm to continue."

/** Lifecycle states in which a schedule rewrite is never allowed. */
export const SCHEDULE_REGEN_REFUSED_LIFECYCLE_STATES: ReadonlySet<string> = new Set(['drafting', 'archived'])

export type ScheduleRegenerationRefusal = {
  code: 'DRAFT_IN_PROGRESS' | 'LEAGUE_ARCHIVED'
  message: string
}

/**
 * Refused while a draft is live (the lifecycle says `drafting`, or a draft session — a dynasty
 * rookie draft included — is in progress or paused) and on an archived league.
 */
export function scheduleRegenerationLifecycleRefusal(input: {
  lifecycleState: string | null | undefined
  liveDraft: boolean
}): ScheduleRegenerationRefusal | null {
  const state = String(input.lifecycleState ?? '').trim().toLowerCase()
  if (state === 'archived') {
    return { code: 'LEAGUE_ARCHIVED', message: "The schedule can't be regenerated on an archived league." }
  }
  if (state === 'drafting' || input.liveDraft) {
    return {
      code: 'DRAFT_IN_PROGRESS',
      message: "The schedule can't be regenerated while a draft is in progress. Try again once it finishes.",
    }
  }
  return null
}

export type PersistedScheduleRow = {
  week: number
  status?: string | null
  homeScore?: number | null
  awayScore?: number | null
}

function rowStarted(row: PersistedScheduleRow): boolean {
  const status = String(row.status ?? '').trim().toLowerCase()
  if (status && status !== 'scheduled') return true
  return Number(row.homeScore ?? 0) !== 0 || Number(row.awayScore ?? 0) !== 0
}

export type WeekStartInput = {
  currentWeek: number
  /** `RedraftSeason.sport` (config key, e.g. `NCAABB`) or a league sport. */
  sport: string | null | undefined
  /** `RedraftSeason.season`, the year a daily sport's week windows are anchored to. */
  seasonYear: number | null | undefined
  now: Date
  persisted: PersistedScheduleRow[]
}

export function weekHasStarted(week: number, input: WeekStartInput): boolean {
  if (week < Math.max(0, Math.floor(Number(input.currentWeek) || 0))) return true
  if (input.persisted.some((row) => row.week === week && rowStarted(row))) return true
  const window = resolveDailySportWeekWindow(seasonSportToLeagueSport(input.sport), input.seasonYear, week)
  return Boolean(window && window.start.getTime() <= input.now.getTime())
}

/**
 * The first week regeneration may rewrite: one past the LAST started week, so a started week is
 * never rewritten even when an earlier one is not (a re-opened or corrected week). Weeks are checked
 * through `max(regularSeasonWeeks, last persisted week)` so a stale row past a moved playoff start
 * is accounted for too.
 */
export function firstRegenerableWeek(input: WeekStartInput & { regularSeasonWeeks: number }): number {
  const lastPersisted = input.persisted.reduce((max, row) => Math.max(max, row.week), 0)
  const horizon = Math.max(input.regularSeasonWeeks, lastPersisted)
  let lastStarted = 0
  for (let week = 1; week <= horizon; week += 1) {
    if (weekHasStarted(week, input)) lastStarted = week
  }
  return lastStarted + 1
}

export function hasScheduleRegenConfirmation(body: unknown): boolean {
  return Boolean(
    body && typeof body === 'object' && (body as Record<string, unknown>)[SCHEDULE_REGEN_CONFIRM_FLAG] === true,
  )
}
