import 'server-only'

import { isBestBallLeague } from '@/lib/autocoach/bestBallShared'
import { buildLineupOptimization, type LineupOptimization } from '@/lib/chimmy/lineupOptimizerGrounding'
import { latestProjectionWeek } from '@/lib/core-app/playerProjections'
import { keepBestPerRealLeague } from '@/lib/core-app/realLeague'
import { isCategoryAllowedForLeague } from '@/lib/notifications/leagueOverrides'
import {
  countFixes,
  findLineupIssues,
  isLockedAt,
  LINEUP_CHECK_ALERT_TYPE,
  lineupCheckDedupeKey,
  lineupCheckMutedBy,
  lineupCheckWindow,
  mainSlateKickoff,
  renderLineupCheck,
  teamKickoffs,
  type LeagueLineupCheck,
  type ScheduledGame,
} from './lineupCheck'
import {
  categoryOn,
  CLAIM_TTL_MS,
  loadRegularSeasonGames,
  PROACTIVE_CATEGORY,
  proactiveDeliveryDeps,
  rotation,
  type ProactiveAudienceLeague,
  type ProactiveDeliveryDeps,
  type ProactiveUserSettings,
} from './proactiveDelivery'

/**
 * Runs Chimmy's lineup check (see `lineupCheck.ts` for what it looks for and why). Called by the
 * alert sweep every 15 minutes; outside the window before the week's main slate it reads two small
 * rows and returns. The audience, settings, weekly claim and dispatch are shared with the waiver
 * check — see `proactiveDelivery.ts`, which also explains why the claim is not the in-app row.
 *
 * ── WHOSE SETTINGS DECIDE ──────────────────────────────────────────────────────────────────────
 * The `lineup_reminders` notification category (on/off, per league), and Chimmy's own alert
 * controls — a muted "Lineup" class, a muted league. Both are read BEFORE any lineup is computed,
 * so someone who opted out costs nothing. Channel, quiet hours and contact availability are the
 * dispatcher's, exactly as for every other notification.
 *
 * ⚠ ONE LINE PER REAL LEAGUE. A Sleeper league imported by two of its members is two AF rows, and
 * a manager can hold a claimed team in both — so the same league's fixes would be listed twice and
 * counted twice. Collapsed on the output with the waivers board's own rule (`realLeague.ts`).
 *
 * ⚠ A TIME BUDGET, NOT A LIMIT ON LEAGUES. One manager here has sixty-one leagues. The run stops
 * starting new USERS at `budgetMs` (one already started is finished); anyone not reached is
 * unclaimed and gets picked up 15 minutes later. The starting point rotates each run so a budget
 * that always binds cannot starve the same people every time.
 */

export type LineupCheckUserOutcome =
  | 'sent'
  | 'would_send'
  | 'clean'
  | 'already_sent'
  | 'category_off'
  | 'muted'
  | 'no_profile'
  | 'no_leagues'
  | 'error'

export type LineupCheckAudienceLeague = ProactiveAudienceLeague
export type LineupCheckUserSettings = ProactiveUserSettings

export interface LineupCheckDeps extends ProactiveDeliveryDeps {
  latestWeek: () => Promise<{ season: string; week: number } | null>
  loadGames: (season: number, week: number) => Promise<ScheduledGame[]>
  optimize: (leagueId: string, userId: string) => Promise<LineupOptimization>
}

export type LineupCheckRun =
  | {
      ran: false
      reason: 'no_projection_week' | 'no_schedule' | 'early' | 'closed'
      week: { season: string; week: number } | null
      mainSlate: string | null
    }
  | {
      ran: true
      dryRun: boolean
      week: { season: string; week: number }
      mainSlate: string
      users: number
      outcomes: Partial<Record<LineupCheckUserOutcome, number>>
      /** Audience members not reached before the time budget ran out; next run picks them up. */
      notReached: number
      leaguesChecked: number
      /** Dry runs only: what each user would have been sent. */
      previews: Array<{ userId: string; title: string; body: string }>
      errors: Array<{ userId: string; error: string }>
    }

const CATEGORY = PROACTIVE_CATEGORY
const DEFAULT_BUDGET_MS = 90_000

const defaultDeps: LineupCheckDeps = {
  ...proactiveDeliveryDeps,
  latestWeek: latestProjectionWeek,
  loadGames: loadRegularSeasonGames,
  optimize: (leagueId, userId) => buildLineupOptimization({ leagueId, userId }),
}

export async function runLineupCheck(
  opts: {
    dryRun?: boolean
    /** Ignore the window — for a hand-run verification. The weekly claim still applies to a real send. */
    force?: boolean
    userId?: string | null
    limit?: number
    budgetMs?: number
  } = {},
  overrides: Partial<LineupCheckDeps> = {},
): Promise<LineupCheckRun> {
  const deps: LineupCheckDeps = { ...defaultDeps, ...overrides }
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS
  const now = deps.now()
  const dryRun = Boolean(opts.dryRun)

  const week = await deps.latestWeek()
  const season = week ? Number(week.season) : NaN
  if (!week || !Number.isInteger(season)) return { ran: false, reason: 'no_projection_week', week: null, mainSlate: null }

  const games = await deps.loadGames(season, week.week)
  const mainSlate = mainSlateKickoff(games)
  if (!mainSlate) return { ran: false, reason: 'no_schedule', week, mainSlate: null }
  const window = lineupCheckWindow(mainSlate, now)
  if (window !== 'open' && !opts.force) return { ran: false, reason: window, week, mainSlate: mainSlate.toISOString() }

  const isLocked = isLockedAt(teamKickoffs(games), now)
  const audience = await deps.loadAudience(season, opts.userId ?? null)
  const userIds = rotation([...audience.keys()].sort(), now).slice(0, opts.limit ?? 500)
  const dedupePrefix = lineupCheckDedupeKey(week.season, week.week)

  const outcomes: Partial<Record<LineupCheckUserOutcome, number>> = {}
  const previews: Array<{ userId: string; title: string; body: string }> = []
  const errors: Array<{ userId: string; error: string }> = []
  const tally = (o: LineupCheckUserOutcome) => (outcomes[o] = (outcomes[o] ?? 0) + 1)
  let leaguesChecked = 0
  // `>=`, so a budget of zero starts nobody — the sweep passes zero when it has used the run up.
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
      const n = settings.notifications
      if (!categoryOn(settings)) {
        tally('category_off')
        continue
      }
      if (lineupCheckMutedBy(settings.chimmy)) {
        tally('muted')
        continue
      }
      const leagues = (audience.get(userId) ?? []).filter(
        (l) =>
          !isBestBallLeague(l.leagueVariant, l.bestBallMode) &&
          isCategoryAllowedForLeague(n, CATEGORY, l.id) &&
          !lineupCheckMutedBy(settings.chimmy, l.id),
      )
      if (leagues.length === 0) {
        tally('no_leagues')
        continue
      }

      const checked: Array<{ check: LeagueLineupCheck; league: LineupCheckAudienceLeague }> = []
      // A user once started is finished: a check that skipped some leagues would claim the week
      // and then never mention them. The overshoot is bounded by one user's leagues.
      for (const league of leagues) {
        const result = await deps.optimize(league.id, userId).catch(() => null)
        leaguesChecked += 1
        // The feed's week is read once per league; a week that moved mid-run is not this run's week.
        if (!result || result.status !== 'ready' || result.week.week !== week.week || result.week.season !== week.season) continue
        const issues = findLineupIssues(result, isLocked)
        if (issues.length > 0) {
          checked.push({ check: { leagueId: league.id, leagueName: league.name ?? 'Your league', week: week.week, issues }, league })
        }
      }
      // One line per real league (see the header): the copy with more to fix wins, ties by id.
      const found = keepBestPerRealLeague(
        checked,
        (c) => ({
          platform: c.league.platform ?? null,
          platformLeagueId: c.league.platformLeagueId ?? null,
          season: c.league.season ?? null,
          leagueId: c.league.id,
        }),
        (a, b) =>
          a.check.issues.length > b.check.issues.length ||
          (a.check.issues.length === b.check.issues.length && a.check.leagueId < b.check.leagueId),
      ).map((c) => c.check)

      const message = renderLineupCheck(found, { baseUrl: deps.baseUrl() })
      if (!message) {
        tally('clean')
        continue
      }
      if (dryRun) {
        tally('would_send')
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
        category: CATEGORY,
        productType: 'app',
        type: 'chimmy_lineup_check',
        title: message.title,
        body: message.body,
        actionHref: message.actionHref,
        actionLabel: 'Ask Chimmy',
        leagueId: found.length === 1 ? found[0]!.leagueId : null,
        severity: 'medium',
        meta: {
          chimmyAlert: true,
          class: 'lineup',
          alertType: LINEUP_CHECK_ALERT_TYPE,
          season: week.season,
          week: week.week,
          leagueIds: found.map((f) => f.leagueId),
          fixes: countFixes(found),
        },
        dedupePrefix,
        skipChannels: { sms: true, email: Boolean(channels?.disableEmail), push: Boolean(channels?.disablePush) },
        emailOverride: message.email,
      })
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
    mainSlate: mainSlate.toISOString(),
    users: userIds.length,
    outcomes,
    // Every user the run finished with tallied exactly one outcome; the rest were not reached.
    notReached: userIds.length - Object.values(outcomes).reduce((a, b) => a + (b ?? 0), 0),
    leaguesChecked,
    previews,
    errors: errors.slice(0, 10),
  }
}
