import 'server-only'

import { resolveWaiverClaimWeek } from '@/lib/core-app/waiverClaimWeek'
import { getWaiversBoard, type WaiversBoardData } from '@/lib/core-app/waiversBoard'
import { isCategoryAllowedForLeague } from '@/lib/notifications/leagueOverrides'
import type { ScheduledGame } from './lineupCheck'
import {
  categoryOn,
  CLAIM_TTL_MS,
  loadRegularSeasonGames,
  PROACTIVE_CATEGORY,
  proactiveDeliveryDeps,
  rotation,
  type ProactiveDeliveryDeps,
} from './proactiveDelivery'
import {
  firstKickoff,
  lastKickoff,
  renderWaiverCheck,
  selectWaiverPicks,
  WAIVER_CHECK_ALERT_TYPE,
  waiverCheckDedupeKey,
  waiverCheckMutedBy,
  waiverCheckWindow,
} from './waiverCheck'

/**
 * Runs Chimmy's waiver check (see `waiverCheck.ts`). Called by the alert sweep every 15 minutes;
 * outside its Tuesday window it reads two small sets of rows and returns. Audience, settings, the
 * weekly claim and dispatch are the lineup check's — `proactiveDelivery.ts`.
 *
 * 🛑 IT PRICES THE WEEK AHEAD, NEVER THE WEEK BEHIND. The week is the CLAIM week
 * (lib/core-app/waiverClaimWeek.ts): once most of the week being played has kicked off, a claim is
 * for next week, and the board prices next week's Sleeper board from `future_week_projections`.
 * Before that table existed (2026-09-29) the check had to wait for the current-week feed to roll
 * over, and a feed that had not moved read as "the week's games have started" so nothing was sent.
 * That fallback still holds: with next week unpublished the claim week is the current one, its
 * first kickoff has passed, and the window stays closed rather than advising on the week behind.
 *
 * ⚠ NFL ROWS ONLY, DELIBERATELY — `board.rows`, never `board.sports`. The board's other-sport
 * sections are priced PER GAME from a season rate; this message says "+N projected pts in week W",
 * gates on WAIVER_CHECK_MIN_GAIN points per NFL week, is windowed on the NFL schedule and goes to an
 * NFL-league audience. None of that is true of a basketball gain, so sending one here would state a
 * weekly forecast the number never made. Those sports have their own window, audience and "worth a
 * claim" threshold (owner's decision 2026-09-29) — in `runSportWaiverCheck.ts`, on the rules in
 * `waiverAlertRules.ts`, never by widening this filter.
 */

export type WaiverCheckUserOutcome =
  | 'sent'
  | 'would_send'
  | 'no_picks'
  | 'already_sent'
  | 'category_off'
  | 'muted'
  | 'no_profile'
  | 'no_leagues'
  | 'error'

export interface WaiverCheckDeps extends ProactiveDeliveryDeps {
  /** The claim week at `nowMs` — `basis: 'next'` when it is priced on next week's board. */
  latestWeek: (nowMs: number) => Promise<{ season: string; week: number; basis?: 'current' | 'next' } | null>
  loadGames: (season: number, week: number) => Promise<ScheduledGame[]>
  board: (userId: string, opts?: { week?: number | null }) => Promise<WaiversBoardData>
}

export type WaiverCheckRun =
  | {
      ran: false
      reason: 'no_projection_week' | 'no_schedule' | 'early' | 'closed'
      week: { season: string; week: number } | null
      firstKickoff: string | null
    }
  | {
      ran: true
      dryRun: boolean
      week: { season: string; week: number }
      firstKickoff: string
      users: number
      outcomes: Partial<Record<WaiverCheckUserOutcome, number>>
      notReached: number
      /** Picks named across every message sent (or previewed). */
      picks: number
      previews: Array<{ userId: string; title: string; body: string }>
      errors: Array<{ userId: string; error: string }>
    }

const DEFAULT_BUDGET_MS = 90_000

const defaultDeps: WaiverCheckDeps = {
  ...proactiveDeliveryDeps,
  latestWeek: (nowMs) => resolveWaiverClaimWeek(nowMs),
  loadGames: loadRegularSeasonGames,
  board: getWaiversBoard,
}

export async function runWaiverCheck(
  opts: { dryRun?: boolean; force?: boolean; userId?: string | null; limit?: number; budgetMs?: number } = {},
  overrides: Partial<WaiverCheckDeps> = {},
): Promise<WaiverCheckRun> {
  const deps: WaiverCheckDeps = { ...defaultDeps, ...overrides }
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS
  const now = deps.now()
  const dryRun = Boolean(opts.dryRun)

  const week = await deps.latestWeek(now.getTime())
  const season = week ? Number(week.season) : NaN
  if (!week || !Number.isInteger(season)) return { ran: false, reason: 'no_projection_week', week: null, firstKickoff: null }

  const games = await deps.loadGames(season, week.week)
  const first = firstKickoff(games)
  if (!first) return { ran: false, reason: 'no_schedule', week, firstKickoff: null }
  const previous = week.week > 1 ? await deps.loadGames(season, week.week - 1) : []
  const window = waiverCheckWindow({ firstKickoff: first, previousLastKickoff: lastKickoff(previous), now })
  if (window !== 'open' && !opts.force) return { ran: false, reason: window, week, firstKickoff: first.toISOString() }

  const audience = await deps.loadAudience(season, opts.userId ?? null)
  const userIds = rotation([...audience.keys()].sort(), now).slice(0, opts.limit ?? 500)
  const dedupePrefix = waiverCheckDedupeKey(week.season, week.week)

  const outcomes: Partial<Record<WaiverCheckUserOutcome, number>> = {}
  const previews: Array<{ userId: string; title: string; body: string }> = []
  const errors: Array<{ userId: string; error: string }> = []
  const tally = (o: WaiverCheckUserOutcome) => (outcomes[o] = (outcomes[o] ?? 0) + 1)
  let picksNamed = 0
  const overBudget = () => Date.now() - startedAt >= budgetMs

  for (const userId of userIds) {
    if (overBudget()) break
    const key = `${dedupePrefix}:${userId}`
    try {
      if (await deps.alreadySent(key)) {
        tally('already_sent')
        continue
      }
      const settings = await deps.loadSettings(userId)
      if (!settings) {
        tally('no_profile')
        continue
      }
      if (!categoryOn(settings)) {
        tally('category_off')
        continue
      }
      if (waiverCheckMutedBy(settings.chimmy)) {
        tally('muted')
        continue
      }
      // This season's leagues only — the board reads every claimed team, last season's included.
      const allowed = new Set(
        (audience.get(userId) ?? [])
          .filter(
            (l) =>
              isCategoryAllowedForLeague(settings.notifications, PROACTIVE_CATEGORY, l.id) &&
              !waiverCheckMutedBy(settings.chimmy, l.id),
          )
          .map((l) => l.id),
      )
      if (allowed.size === 0) {
        tally('no_leagues')
        continue
      }

      const board = await deps.board(userId, week.basis === 'next' ? { week: week.week } : {})
      // The board's week is the feed's, read again; a week that moved mid-run is not this run's.
      const sameWeek = board.at != null && board.at.week === week.week && board.at.season === week.season
      const picks = sameWeek
        ? selectWaiverPicks(
            board.rows.filter((r) => allowed.has(r.leagueId)),
            week.week,
          )
        : []
      const message = renderWaiverCheck(picks, { baseUrl: deps.baseUrl() })
      if (!message) {
        tally('no_picks')
        continue
      }
      if (dryRun) {
        tally('would_send')
        picksNamed += picks.length
        previews.push({ userId, title: message.title, body: message.body })
        continue
      }
      if (!(await deps.claim(key, new Date(now.getTime() + CLAIM_TTL_MS)))) {
        tally('already_sent')
        continue
      }
      const channels = settings.chimmy?.channelPreferences
      await deps.dispatch({
        userIds: [userId],
        category: PROACTIVE_CATEGORY,
        productType: 'app',
        type: 'chimmy_waiver_check',
        title: message.title,
        body: message.body,
        actionHref: message.actionHref,
        actionLabel: 'Ask Chimmy',
        leagueId: picks.length === 1 ? picks[0]!.leagueId : null,
        severity: 'medium',
        meta: {
          chimmyAlert: true,
          class: 'waiver',
          alertType: WAIVER_CHECK_ALERT_TYPE,
          season: week.season,
          week: week.week,
          leagueIds: picks.map((p) => p.leagueId),
          picks: picks.length,
        },
        dedupePrefix,
        skipChannels: { sms: true, email: Boolean(channels?.disableEmail), push: Boolean(channels?.disablePush) },
        emailOverride: message.email,
      })
      picksNamed += picks.length
      tally('sent')
    } catch (e) {
      tally('error')
      errors.push({ userId, error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160) })
    }
  }

  return {
    ran: true,
    dryRun,
    week,
    firstKickoff: first.toISOString(),
    users: userIds.length,
    outcomes,
    notReached: userIds.length - Object.values(outcomes).reduce((a, b) => a + (b ?? 0), 0),
    picks: picksNamed,
    previews,
    errors: errors.slice(0, 10),
  }
}
