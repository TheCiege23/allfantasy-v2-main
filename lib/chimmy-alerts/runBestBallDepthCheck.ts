import 'server-only'

import { latestProjectionWeek } from '@/lib/core-app/playerProjections'
import { getDash34Data, type Dash34DepthAlert, type Dash34LeagueRow } from '@/lib/core-app/dash34'
import { keepBestPerRealLeague } from '@/lib/core-app/realLeague'
import { isCategoryAllowedForLeague } from '@/lib/notifications/leagueOverrides'
import { prisma } from '@/lib/prisma'
import { lineupCheckMutedBy, lineupCheckWindow, mainSlateKickoff, type ScheduledGame } from './lineupCheck'
import {
  categoryOn,
  CLAIM_TTL_MS,
  isBestBallAudienceLeague,
  loadRegularSeasonGames,
  PROACTIVE_CATEGORY,
  proactiveDeliveryDeps,
  rotation,
  type ProactiveAudienceLeague,
  type ProactiveDeliveryDeps,
} from './proactiveDelivery'

/**
 * Chimmy's best ball depth check — the push half of the home's "Best ball depth check" (2026-10-08).
 *
 * A best ball league sets its own lineup, so there is no lineup to fix — but there can be a position
 * the auto lineup has nobody healthy to fill. The home card already finds those (dash34 →
 * lib/core-app/bestBallDepth.ts); this sends the urgent ones to the manager's phone before the
 * week's main slate, once per user per week.
 *
 * ⚠ THE SAME RULE AS THE CARD, BY CONSTRUCTION. It reads `getDash34Data(...).depthAlerts` for the
 * user's best ball leagues — the loader the home renders — so a push can never name a position the
 * home does not show, or miss one it does.
 *
 * ⚠ RED ONLY. The card shows `warn` too (half the room hurt, healthy players just covering the
 * slots); that is a glance, not a buzz. The push fires only on `bad` — the slots cannot be filled
 * even counting the questionable players, i.e. a likely zero at that position this week.
 *
 * Everything else is the lineup check's, deliberately: its window before the main slate, its
 * audience, the `lineup_reminders` category (on/off, per league), Chimmy's Lineup class mute, the
 * claim-before-send once-a-week rule (proactiveDelivery.ts), the dispatcher's channels and quiet
 * hours, and a time budget that stops starting new users.
 */

export const BEST_BALL_DEPTH_ALERT_TYPE = 'best_ball_depth'

export type BestBallDepthUserOutcome =
  | 'sent'
  | 'would_send'
  | 'clean'
  | 'already_sent'
  | 'category_off'
  | 'muted'
  | 'no_profile'
  | 'no_leagues'
  | 'error'

export interface BestBallDepthDeps extends ProactiveDeliveryDeps {
  latestWeek: () => Promise<{ season: string; week: number } | null>
  loadGames: (season: number, week: number) => Promise<ScheduledGame[]>
  /** The home loader's depth alerts for these leagues — only `bad` ones are sent. */
  depthAlerts: (userId: string, leagueIds: string[], now: Date) => Promise<Dash34DepthAlert[]>
}

export type BestBallDepthRun =
  | { ran: false; reason: 'no_projection_week' | 'no_schedule' | 'early' | 'closed'; mainSlate: string | null }
  | {
      ran: true
      dryRun: boolean
      week: { season: string; week: number }
      mainSlate: string
      users: number
      outcomes: Partial<Record<BestBallDepthUserOutcome, number>>
      notReached: number
      leaguesChecked: number
      previews: Array<{ userId: string; title: string; body: string }>
      errors: Array<{ userId: string; error: string }>
    }

const DEFAULT_BUDGET_MS = 90_000
const BODY_MAX = 280

/** `chimmy-bestball-depth:<season>-w<week>` — the dispatcher appends `:<userId>`. */
export function bestBallDepthDedupeKey(season: string | number, week: number): string {
  return `chimmy-bestball-depth:${season}-w${week}`
}

/** Shortened like the lineup check's league names: a phone line is narrow. */
function shortName(name: string): string {
  const n = name.trim()
  return n.length > 28 ? `${n.slice(0, 27).trimEnd()}…` : n
}

/** "QB: 0 healthy of 2 (2 out)" — the room in one clause. */
function roomLine(a: Dash34DepthAlert): string {
  const parts = [a.out > 0 ? `${a.out} out` : null, a.questionable > 0 ? `${a.questionable} questionable` : null].filter(Boolean)
  return `${a.position}: ${a.healthy} healthy of ${a.rostered}${parts.length ? ` (${parts.join(', ')})` : ''}`
}

export type BestBallDepthMessage = { title: string; body: string; actionHref: string; leagueId: string | null }

export function renderBestBallDepth(alerts: readonly Dash34DepthAlert[]): BestBallDepthMessage | null {
  const red = alerts.filter((a) => a.tone === 'bad')
  if (red.length === 0) return null
  const byLeague = new Map<string, Dash34DepthAlert[]>()
  for (const a of red) byLeague.set(a.leagueId, [...(byLeague.get(a.leagueId) ?? []), a])
  const first = red[0]!
  const title =
    red.length === 1
      ? `Best ball: no healthy ${first.position} left in ${shortName(first.leagueName)}`
      : byLeague.size === 1
        ? `Best ball: ${red.length} thin spots in ${shortName(first.leagueName)}`
        : `Best ball: ${red.length} thin spots across ${byLeague.size} leagues`
  let body = [...byLeague.values()]
    .map((list) => `${shortName(list[0]!.leagueName)} — ${list.map(roomLine).join('; ')}`)
    .join('\n')
  body += '\nThe auto lineup can only pick healthy players. Grab a fill-in before kickoff.'
  if (body.length > BODY_MAX) body = `${body.slice(0, BODY_MAX - 1).trimEnd()}…`
  return {
    title,
    body,
    actionHref: first.waiversHref ?? first.href,
    leagueId: byLeague.size === 1 ? first.leagueId : null,
  }
}

/**
 * The home loader, for this user's best ball leagues only. The rows carry what `getDash34Data`
 * reads off a league list; `hasUnifiedRecord: true` because these are the user's played leagues,
 * not the historical board rows that flag exists to exclude.
 */
async function homeDepthAlerts(userId: string, leagueIds: string[], now: Date): Promise<Dash34DepthAlert[]> {
  if (leagueIds.length === 0) return []
  const rows = await prisma.league.findMany({
    where: { id: { in: leagueIds } },
    select: {
      id: true,
      name: true,
      platform: true,
      platformLeagueId: true,
      sport: true,
      season: true,
      status: true,
      leagueType: true,
      isDynasty: true,
      lastSyncedAt: true,
    },
  })
  const leagueRows: Dash34LeagueRow[] = rows.map((r) => ({ ...r, sport: String(r.sport), hasUnifiedRecord: true }))
  const data = await getDash34Data(userId, leagueRows, now)
  return data.depthAlerts ?? []
}

const defaultDeps: BestBallDepthDeps = {
  ...proactiveDeliveryDeps,
  latestWeek: latestProjectionWeek,
  loadGames: loadRegularSeasonGames,
  depthAlerts: homeDepthAlerts,
}

export async function runBestBallDepthCheck(
  opts: { dryRun?: boolean; force?: boolean; userId?: string | null; limit?: number; budgetMs?: number } = {},
  overrides: Partial<BestBallDepthDeps> = {},
): Promise<BestBallDepthRun> {
  const deps: BestBallDepthDeps = { ...defaultDeps, ...overrides }
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS
  const now = deps.now()
  const dryRun = Boolean(opts.dryRun)

  const week = await deps.latestWeek()
  const season = week ? Number(week.season) : NaN
  if (!week || !Number.isInteger(season)) return { ran: false, reason: 'no_projection_week', mainSlate: null }
  const mainSlate = mainSlateKickoff(await deps.loadGames(season, week.week))
  if (!mainSlate) return { ran: false, reason: 'no_schedule', mainSlate: null }
  const window = lineupCheckWindow(mainSlate, now)
  if (window !== 'open' && !opts.force) return { ran: false, reason: window, mainSlate: mainSlate.toISOString() }

  const audience = await deps.loadAudience(season, opts.userId ?? null)
  // Only people who hold a best ball league at all — everyone else costs nothing past this line.
  const userIds = rotation(
    [...audience.keys()].filter((id) => (audience.get(id) ?? []).some(isBestBallAudienceLeague)).sort(),
    now,
  ).slice(0, opts.limit ?? 500)
  const dedupePrefix = bestBallDepthDedupeKey(week.season, week.week)

  const outcomes: Partial<Record<BestBallDepthUserOutcome, number>> = {}
  const previews: Array<{ userId: string; title: string; body: string }> = []
  const errors: Array<{ userId: string; error: string }> = []
  const tally = (o: BestBallDepthUserOutcome) => (outcomes[o] = (outcomes[o] ?? 0) + 1)
  let leaguesChecked = 0
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
      if (lineupCheckMutedBy(settings.chimmy)) {
        tally('muted')
        continue
      }
      const leagues = (audience.get(userId) ?? []).filter(
        (l: ProactiveAudienceLeague) =>
          isBestBallAudienceLeague(l) &&
          isCategoryAllowedForLeague(settings.notifications, PROACTIVE_CATEGORY, l.id) &&
          !lineupCheckMutedBy(settings.chimmy, l.id),
      )
      if (leagues.length === 0) {
        tally('no_leagues')
        continue
      }
      leaguesChecked += leagues.length
      const byId = new Map(leagues.map((l) => [l.id, l]))
      const alerts = await deps.depthAlerts(userId, leagues.map((l) => l.id), now)
      // One line per REAL league: a league imported by two members is two rows (realLeague.ts).
      const kept = new Set(
        keepBestPerRealLeague(
          [...new Set(alerts.map((a) => a.leagueId))].filter((id) => byId.has(id)),
          (id) => {
            const l = byId.get(id)!
            return { platform: l.platform ?? null, platformLeagueId: l.platformLeagueId ?? null, season: l.season ?? null, leagueId: id }
          },
          (a, b) => a < b,
        ),
      )
      const message = renderBestBallDepth(alerts.filter((a) => kept.has(a.leagueId)))
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
        category: PROACTIVE_CATEGORY,
        productType: 'app',
        type: 'chimmy_best_ball_depth',
        title: message.title,
        body: message.body,
        actionHref: message.actionHref,
        actionLabel: 'Find a fill-in',
        leagueId: message.leagueId,
        severity: 'medium',
        meta: {
          chimmyAlert: true,
          class: 'lineup',
          alertType: BEST_BALL_DEPTH_ALERT_TYPE,
          season: week.season,
          week: week.week,
          leagueIds: [...kept],
        },
        dedupePrefix,
        skipChannels: { sms: true, email: Boolean(channels?.disableEmail), push: Boolean(channels?.disablePush) },
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
    notReached: userIds.length - Object.values(outcomes).reduce((a, b) => a + (b ?? 0), 0),
    leaguesChecked,
    previews,
    errors: errors.slice(0, 10),
  }
}
