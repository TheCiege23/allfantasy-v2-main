/**
 * THE CHOP LANDS BEFORE THE WAIVER RUN THAT FOLLOWS IT — ENFORCED, NOT ASSUMED.
 *
 * The chop (score-sync → ./nativeGuillotineWeek.ts) and the waiver run are two independent crons. The
 * calendar puts the chop a day ahead of the run, but the chop fires when the week SEALS: missing box
 * scores hold it up to three days, the stat-correction window holds it further, and a stalled
 * score-sync holds it indefinitely. When the run fired first, measured against the engines:
 *
 *   - the team about to be chopped still counts as alive, so its claims were AWARDED: it took players
 *     (and spent FAAB a `split` league would have shared out) away from teams that survive, and those
 *     players then went straight back out with the chop;
 *   - claims on the doomed team's players FAILED ("no longer available") — terminal, not pending — so
 *     the bidders had to find out and bid again;
 *   - the blind-window hold does not cover it: a late chop opens its own 24h hold AFTER the run.
 *
 * So a waiver run for a native Guilly league defers the whole league while a finished week's chop is
 * due and not yet applied. Claims stay pending, untouched, and the first run after the chop settles
 * them — with the chopped team refused by its eliminated flag and its players in the pool.
 *
 * The week rule is the native runner's own (and ./chopPreviewLoad.ts's): one past the later of the
 * last chop and the season's scoring period, never before the first chop week. "Finished" is the same
 * week signal score-sync hands the runner (`resolveSeasonWeekForRedraftSeason`, Postgres only).
 *
 * ⚠ BOUNDED. A chop more than one week overdue no longer holds waivers: by then it is stuck (a roster
 * mapping refusal, a dead week signal), not late, and a league must not lose its waivers to it. That
 * case is logged loudly. A no-chop week, a finished elimination window and a complete season hold
 * nothing. Anything unreadable holds nothing, like the blind-window cutoff — a broken read must not
 * stop a league's waivers.
 *
 * Chop timing itself is untouched; this only decides whether a run may go ahead.
 */
import { prisma } from '@/lib/prisma'
import { nativeGuillotineState } from '@/lib/league/nativeFormatPatch'
import { getGuillotineConfig } from './GuillotineLeagueConfig'
import { readAdvanced, scheduledChops } from './chopSchedule'
import { periodEndWeek, readPeriodWeeks } from './eliminationPeriods'
import { resolveSeasonWeekForRedraftSeason } from '@/lib/season-week/seasonWeekService'
import { SCORING_SEASON_STATUSES } from '@/lib/redraft/seasonStatus'

export type ChopPendingInput = {
  /** The league's current fantasy week (the week signal score-sync gives the chop runner). */
  fantasyWeek: number
  /** Every game of `fantasyWeek` is final. */
  currentWeekComplete: boolean
  lastChoppedWeek: number | null
  currentScoringPeriod: number | null
  eliminationStartWeek: number
  eliminationEndWeek: number | null
  /** Teams the commissioner's schedule chops in a week (0 = a no-chop week). */
  chopsInWeek: (week: number) => number
  /**
   * Weeks per elimination period (./eliminationPeriods.ts). Absent = 1. In a two-week league only a
   * period's last week chops, so the first week finishing holds nothing.
   */
  periodWeeks?: number
}

export type ChopPendingVerdict =
  | { hold: true; week: number }
  | { hold: false; week: number | null; reason: 'week_in_progress' | 'no_chop_week' | 'elimination_window_ended' | 'chop_overdue' }

/** Pure. Whether a finished week's chop is due and not yet applied. */
export function chopPendingVerdict(input: ChopPendingInput): ChopPendingVerdict {
  const next = Math.max(Math.max(input.lastChoppedWeek ?? 0, input.currentScoringPeriod ?? 0) + 1, input.eliminationStartWeek)
  const week = periodEndWeek(next, input.eliminationStartWeek, input.periodWeeks ?? 1)
  if (input.eliminationEndWeek != null && week > input.eliminationEndWeek) return { hold: false, week, reason: 'elimination_window_ended' }
  const finished = week < input.fantasyWeek || (week === input.fantasyWeek && input.currentWeekComplete)
  if (!finished) return { hold: false, week, reason: 'week_in_progress' }
  if (input.chopsInWeek(week) <= 0) return { hold: false, week, reason: 'no_chop_week' }
  if (week < input.fantasyWeek - 1) return { hold: false, week, reason: 'chop_overdue' }
  return { hold: true, week }
}

export type ChopGateLeague = {
  platform?: string | null
  leagueType?: string | null
  leagueVariant?: string | null
  guillotineMode?: boolean | null
  settings?: unknown
}

export type ChopGateResult = { hold: false } | { hold: true; week: number; message: string }

export const CHOP_PENDING_WAIVER_MESSAGE = (week: number) =>
  `League skipped: week ${week}'s Guilly chop has not landed yet. Pending claims stay pending and settle on the first run after the chop.`

/**
 * Reads the league's chop state. Never throws; `{ hold: false }` for every league it cannot apply to.
 * Pass the league row when the caller already has it (sport-agnostic: every native Guilly league).
 */
export async function guillotineChopPendingForWaivers(
  leagueId: string,
  known?: ChopGateLeague | null,
  deps: { resolveWeek?: typeof resolveSeasonWeekForRedraftSeason } = {},
): Promise<ChopGateResult> {
  try {
    const league: ChopGateLeague | null =
      known && 'platform' in known && 'settings' in known
        ? known
        : await prisma.league.findUnique({
            where: { id: leagueId },
            select: { platform: true, leagueType: true, leagueVariant: true, guillotineMode: true, settings: true },
          })
    // Native only: an imported Guilly league's chop is the provider's, and nothing here runs it.
    if (!league || nativeGuillotineState(league) !== true) return { hold: false }

    const season = await prisma.redraftSeason.findFirst({
      where: { leagueId, status: { in: [...SCORING_SEASON_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!season) return { hold: false }

    const [config, gSeason, lastChop] = await Promise.all([
      getGuillotineConfig(leagueId),
      prisma.guillotineSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { currentScoringPeriod: true, status: true } }),
      prisma.guillotineRosterState.findFirst({
        where: { leagueId, choppedInPeriod: { not: null } },
        orderBy: { choppedInPeriod: 'desc' },
        select: { choppedInPeriod: true },
      }),
    ])
    if (!config || gSeason?.status === 'complete') return { hold: false }

    const resolved = await (deps.resolveWeek ?? resolveSeasonWeekForRedraftSeason)(season.id)
    if (!resolved.ok) return { hold: false }

    const advanced = readAdvanced(league.settings)
    const verdict = chopPendingVerdict({
      fantasyWeek: resolved.fantasyWeek,
      currentWeekComplete: resolved.sportWeekComplete,
      lastChoppedWeek: lastChop?.choppedInPeriod ?? null,
      currentScoringPeriod: gSeason?.currentScoringPeriod ?? null,
      eliminationStartWeek: config.eliminationStartWeek,
      eliminationEndWeek: config.eliminationEndWeek,
      chopsInWeek: (week) => scheduledChops(advanced, week, config.teamsPerChop),
      periodWeeks: readPeriodWeeks(league.settings),
    })
    if (verdict.hold) return { hold: true, week: verdict.week, message: CHOP_PENDING_WAIVER_MESSAGE(verdict.week) }
    if (verdict.reason === 'chop_overdue') {
      console.warn(`[guillotine] league ${leagueId}: week ${verdict.week}'s chop is more than a week overdue; waivers are no longer held for it`)
    }
    return { hold: false }
  } catch (err) {
    console.warn(`[guillotine] league ${leagueId}: chop state unreadable; waivers not held`, err instanceof Error ? err.message : err)
    return { hold: false }
  }
}
