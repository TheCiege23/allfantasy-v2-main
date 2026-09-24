import 'server-only'

import type { Prisma } from '@prisma/client'

import { isBestBallLeague } from '@/lib/autocoach/bestBallShared'
import { buildLineupOptimization, type LineupOptimization } from '@/lib/chimmy/lineupOptimizerGrounding'
import { latestProjectionWeek } from '@/lib/core-app/playerProjections'
import { getBaseUrl } from '@/lib/get-base-url'
import { resolveNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import type { NotificationPreferences } from '@/lib/notification-settings/types'
import { dispatchNotification, type DispatchNotificationParams } from '@/lib/notifications/NotificationDispatcher'
import { isCategoryAllowedForLeague } from '@/lib/notifications/leagueOverrides'
import { prisma } from '@/lib/prisma'
import { getSettingsProfile } from '@/lib/user-settings'
import { loadChimmyAlertPreferences } from './ChimmyAlertPreferencesService'
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
import type { ChimmyAlertUserPreferences } from './types'

/**
 * Runs Chimmy's lineup check (see `lineupCheck.ts` for what it looks for and why). Called by the
 * alert sweep every 15 minutes; outside the window before the week's main slate it reads two small
 * rows and returns.
 *
 * ── 🛑 ONCE PER USER PER WEEK, AND THE CLAIM IS NOT THE IN-APP ROW ─────────────────────────────
 * The injured-starter sweep dedupes on the bell entry's `sourceKey`. That entry is only written
 * when in-app is on for the category, so a user who keeps email and turns the bell off would be
 * emailed every run. Here the claim is a `SportsDataCache` row CREATED by primary key before
 * anything is sent: a second run, or the second worker replica, fails the create and sends
 * nothing. At most once — a send that fails after the claim is not retried, which beats a manager
 * receiving the same lineup check twelve times on a Sunday morning.
 *
 * ── WHOSE SETTINGS DECIDE ──────────────────────────────────────────────────────────────────────
 * The `lineup_reminders` notification category (on/off, per league), and Chimmy's own alert
 * controls — a muted "Lineup" class, a muted league. Both are read BEFORE any lineup is computed,
 * so someone who opted out costs nothing. Channel, quiet hours and contact availability are the
 * dispatcher's, exactly as for every other notification.
 *
 * ⚠ A TIME BUDGET, NOT A LIMIT ON LEAGUES. One manager here has sixty-one leagues. The run stops
 * starting new USERS at `budgetMs` (one already started is finished); anyone not reached is
 * unclaimed and gets picked up 15 minutes later. The starting point rotates each run so a budget that always binds cannot starve the same
 * people every time.
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

export type LineupCheckAudienceLeague = {
  id: string
  name: string | null
  leagueVariant: string | null
  bestBallMode: boolean | null
}

export type LineupCheckUserSettings = {
  notifications: NotificationPreferences
  chimmy: ChimmyAlertUserPreferences | null
}

export interface LineupCheckDeps {
  now: () => Date
  latestWeek: () => Promise<{ season: string; week: number } | null>
  loadGames: (season: number, week: number) => Promise<ScheduledGame[]>
  loadAudience: (season: number, onlyUserId: string | null) => Promise<Map<string, LineupCheckAudienceLeague[]>>
  loadSettings: (userId: string) => Promise<LineupCheckUserSettings | null>
  optimize: (leagueId: string, userId: string) => Promise<LineupOptimization>
  /** Read-only: has this week's check already gone to this user? */
  alreadySent: (key: string) => Promise<boolean>
  /** Atomically claim this week's check for this user. False when someone already has. */
  claim: (key: string, expiresAt: Date) => Promise<boolean>
  dispatch: (params: DispatchNotificationParams) => Promise<void>
  baseUrl: () => string
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

const CATEGORY = 'lineup_reminders' as const
const QUARTER_HOUR_MS = 15 * 60 * 1000
/** Long enough to outlive the week; the key carries the week, so it cannot block the next one. */
const CLAIM_TTL_MS = 8 * 24 * 60 * 60 * 1000
const DEFAULT_BUDGET_MS = 90_000

function prismaCode(e: unknown): string | null {
  return e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : null
}

const defaultDeps: LineupCheckDeps = {
  now: () => new Date(),
  latestWeek: latestProjectionWeek,
  loadGames: async (season, week) => {
    /*
     * 🛑 `seasonType: 'regular'` IS LOAD-BEARING. Measured 2026-09-24: the `espn_live` and
     * `thesportsdb` sources file preseason games under week 2, 3 and 4 with NO seasonType, so an
     * unfiltered week-4 read returns August kickoffs — and every player on those teams reads as
     * locked since August.
     */
    const rows = await prisma.sportsGame.findMany({
      where: { sport: 'NFL', season, week, seasonType: 'regular', startTime: { not: null } },
      select: { homeTeam: true, awayTeam: true, startTime: true },
    })
    return rows.flatMap((r) => (r.startTime ? [{ homeTeam: r.homeTeam, awayTeam: r.awayTeam, startTime: r.startTime }] : []))
  },
  loadAudience: async (season, onlyUserId) => {
    const rows = await prisma.leagueTeam.findMany({
      where: {
        claimedByUserId: onlyUserId ? onlyUserId : { not: null },
        league: { season, sport: 'NFL' },
      },
      select: {
        claimedByUserId: true,
        league: { select: { id: true, name: true, leagueVariant: true, bestBallMode: true } },
      },
    })
    const out = new Map<string, LineupCheckAudienceLeague[]>()
    for (const r of rows) {
      if (!r.claimedByUserId) continue
      const list = out.get(r.claimedByUserId) ?? []
      if (!list.some((l) => l.id === r.league.id)) list.push(r.league)
      out.set(r.claimedByUserId, list)
    }
    return out
  },
  loadSettings: async (userId) => {
    const profile = await getSettingsProfile(userId)
    if (!profile) return null
    const chimmy = await loadChimmyAlertPreferences(userId).catch(() => null)
    return {
      notifications: resolveNotificationPreferences(profile.notificationPreferences as NotificationPreferences | null),
      chimmy,
    }
  },
  optimize: (leagueId, userId) => buildLineupOptimization({ leagueId, userId }),
  alreadySent: async (key) =>
    (await prisma.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { cacheKey: true } })) != null,
  claim: async (key, expiresAt) => {
    try {
      await prisma.sportsDataCache.create({
        data: { cacheKey: key, expiresAt, data: { claimedAt: new Date().toISOString() } as Prisma.InputJsonValue },
      })
      return true
    } catch (e) {
      if (prismaCode(e) === 'P2002') return false
      throw e
    }
  },
  dispatch: dispatchNotification,
  baseUrl: getBaseUrl,
}

/** Sorted, then rotated by a stride that moves the starting point each quarter hour. */
function rotation<T>(items: T[], now: Date): T[] {
  if (items.length < 2) return items
  const start = (Math.floor(now.getTime() / QUARTER_HOUR_MS) * 7919) % items.length
  return [...items.slice(start), ...items.slice(0, start)]
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
      if (n.globalEnabled === false || !n.categories?.[CATEGORY]?.enabled) {
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

      const found: LeagueLineupCheck[] = []
      // A user once started is finished: a check that skipped some leagues would claim the week
      // and then never mention them. The overshoot is bounded by one user's leagues.
      for (const league of leagues) {
        const result = await deps.optimize(league.id, userId).catch(() => null)
        leaguesChecked += 1
        // The feed's week is read once per league; a week that moved mid-run is not this run's week.
        if (!result || result.status !== 'ready' || result.week.week !== week.week || result.week.season !== week.season) continue
        const issues = findLineupIssues(result, isLocked)
        if (issues.length > 0) {
          found.push({ leagueId: league.id, leagueName: league.name ?? 'Your league', week: week.week, issues })
        }
      }

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
