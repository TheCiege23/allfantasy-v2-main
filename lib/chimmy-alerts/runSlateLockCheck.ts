import 'server-only'

import { buildLineupOptimization, type LineupOptimization } from '@/lib/chimmy/lineupOptimizerGrounding'
import { latestProjectionWeek } from '@/lib/core-app/playerProjections'
import { keepBestPerRealLeague } from '@/lib/core-app/realLeague'
import { isCategoryAllowedForLeague } from '@/lib/notifications/leagueOverrides'
import {
  findLineupIssues,
  isLockedAt,
  lineupCheckMutedBy,
  mainSlateKickoff,
  teamKickoffs,
  type LeagueLineupCheck,
  type ScheduledGame,
} from './lineupCheck'
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
import { openSlate, playsInSlate, renderSlateLock, slateIssues } from './slateLockCheck'

/**
 * Runs Chimmy's slate lock check (see `slateLockCheck.ts` for what it says and why). Called by the
 * alert sweep; outside a slate's lock window it reads the week and the schedule and returns.
 *
 * Shares the weekly lineup check's plumbing on purpose (proactiveDelivery.ts): the same audience,
 * the `lineup_reminders` switch (per league too), Chimmy's Lineup-class mute, claim-before-send,
 * and the dispatcher's channels and quiet hours. Two of its own:
 *
 *   - ONE CLAIM PER USER PER SLATE, so Thursday's message cannot block Monday's;
 *   - an EMPTY SLOT is said once per league per week (its own claim), not before every slate.
 *
 * ⚠ PUSH AND IN-APP, NOT EMAIL. This lands 20–90 minutes before a lock; an email read after kickoff
 * is advice nobody can take. The weekly check, hours earlier, is the one that emails.
 */

export const SLATE_LOCK_ALERT_TYPE = 'slate_lock_check'

export type SlateLockUserOutcome =
  | 'sent'
  | 'would_send'
  | 'clean'
  | 'already_sent'
  | 'category_off'
  | 'muted'
  | 'no_profile'
  | 'no_leagues'
  | 'error'

export interface SlateLockDeps extends ProactiveDeliveryDeps {
  latestWeek: () => Promise<{ season: string; week: number } | null>
  loadGames: (season: number, week: number) => Promise<ScheduledGame[]>
  optimize: (leagueId: string, userId: string) => Promise<LineupOptimization>
}

export type SlateLockRun =
  | { ran: false; reason: 'no_projection_week' | 'no_schedule' | 'no_slate'; slate: string | null }
  | {
      ran: true
      dryRun: boolean
      week: { season: string; week: number }
      slate: string
      users: number
      outcomes: Partial<Record<SlateLockUserOutcome, number>>
      notReached: number
      leaguesChecked: number
      previews: Array<{ userId: string; title: string; body: string }>
      errors: Array<{ userId: string; error: string }>
    }

const DEFAULT_BUDGET_MS = 90_000

/** `chimmy-slate-lock:<season>-w<week>-<slate ISO>` — the dispatcher appends `:<userId>`. */
export function slateLockDedupeKey(season: string | number, week: number, slate: Date): string {
  return `chimmy-slate-lock:${season}-w${week}-${slate.toISOString()}`
}

/** An empty slot is said once per league per week, whichever slate first sees it. */
export function emptySlotClaimKey(season: string | number, week: number, leagueId: string): string {
  return `chimmy-slate-lock-empty:${season}-w${week}:${leagueId}`
}

const defaultDeps: SlateLockDeps = {
  ...proactiveDeliveryDeps,
  latestWeek: latestProjectionWeek,
  loadGames: loadRegularSeasonGames,
  optimize: (leagueId, userId) => buildLineupOptimization({ leagueId, userId }),
}

export async function runSlateLockCheck(
  opts: {
    dryRun?: boolean
    /** Use this slate instead of the open one — for a hand-run verification. Claims still apply. */
    force?: boolean
    userId?: string | null
    limit?: number
    budgetMs?: number
  } = {},
  overrides: Partial<SlateLockDeps> = {},
): Promise<SlateLockRun> {
  const deps: SlateLockDeps = { ...defaultDeps, ...overrides }
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS
  const now = deps.now()
  const dryRun = Boolean(opts.dryRun)

  const week = await deps.latestWeek()
  const season = week ? Number(week.season) : NaN
  if (!week || !Number.isInteger(season)) return { ran: false, reason: 'no_projection_week', slate: null }
  const games = await deps.loadGames(season, week.week)
  if (games.length === 0) return { ran: false, reason: 'no_schedule', slate: null }
  const main = mainSlateKickoff(games)
  // A forced run takes the next non-main slate that has not kicked off, so a hand check is possible
  // on any day of the week; the claims below still stop it from sending twice.
  const slate =
    openSlate(games, now, main) ??
    (opts.force
      ? games
          .map((g) => g.startTime)
          .filter((t) => t.getTime() > now.getTime() && t.getTime() !== main?.getTime())
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
      : null)
  if (!slate) return { ran: false, reason: 'no_slate', slate: null }

  const kickoffs = teamKickoffs(games)
  const isLocked = isLockedAt(kickoffs, now)
  const inSlate = playsInSlate(kickoffs, slate)
  const audience = await deps.loadAudience(season, opts.userId ?? null)
  const userIds = rotation([...audience.keys()].sort(), now).slice(0, opts.limit ?? 500)
  const dedupePrefix = slateLockDedupeKey(week.season, week.week, slate)

  const outcomes: Partial<Record<SlateLockUserOutcome, number>> = {}
  const previews: Array<{ userId: string; title: string; body: string }> = []
  const errors: Array<{ userId: string; error: string }> = []
  const tally = (o: SlateLockUserOutcome) => (outcomes[o] = (outcomes[o] ?? 0) + 1)
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
          !isBestBallAudienceLeague(l) &&
          isCategoryAllowedForLeague(settings.notifications, PROACTIVE_CATEGORY, l.id) &&
          !lineupCheckMutedBy(settings.chimmy, l.id),
      )
      if (leagues.length === 0) {
        tally('no_leagues')
        continue
      }

      const checked: Array<{ check: LeagueLineupCheck; league: ProactiveAudienceLeague; emptyKey: string | null }> = []
      for (const league of leagues) {
        const result = await deps.optimize(league.id, userId).catch(() => null)
        leaguesChecked += 1
        if (!result || result.status !== 'ready' || result.week.week !== week.week || result.week.season !== week.season) continue
        const emptyKey = emptySlotClaimKey(week.season, week.week, league.id)
        const emptyAlreadySaid = await deps.alreadySent(emptyKey)
        const issues = slateIssues(findLineupIssues(result, isLocked), inSlate, { includeEmptySlots: !emptyAlreadySaid })
        if (issues.length > 0) {
          checked.push({
            check: { leagueId: league.id, leagueName: league.name ?? 'Your league', week: week.week, issues },
            league,
            emptyKey: issues.some((i) => i.kind === 'empty_slots') ? emptyKey : null,
          })
        }
      }
      const kept = keepBestPerRealLeague(
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
      )
      const found = kept.map((c) => c.check)

      const message = renderSlateLock(found, slate, now, inSlate)
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
      // The empty-slot claims ride the sent message; a second run racing this one loses them harmlessly.
      for (const c of kept) if (c.emptyKey) await deps.claim(c.emptyKey, new Date(now.getTime() + CLAIM_TTL_MS)).catch(() => false)
      const channels = settings.chimmy?.channelPreferences
      await deps.dispatch({
        userIds: [userId],
        category: PROACTIVE_CATEGORY,
        productType: 'app',
        type: 'chimmy_slate_lock_check',
        title: message.title,
        body: message.body,
        actionHref: message.actionHref,
        actionLabel: 'Ask Chimmy',
        leagueId: found.length === 1 ? found[0]!.leagueId : null,
        // High: it is the last useful moment, and quiet hours let a high alert through only when the
        // user allowed critical ones — the dispatcher's rule, not this file's.
        severity: 'high',
        meta: {
          chimmyAlert: true,
          class: 'lineup',
          alertType: SLATE_LOCK_ALERT_TYPE,
          season: week.season,
          week: week.week,
          slate: slate.toISOString(),
          leagueIds: found.map((f) => f.leagueId),
        },
        dedupePrefix,
        skipChannels: { sms: true, email: true, push: Boolean(channels?.disablePush) },
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
    slate: slate.toISOString(),
    users: userIds.length,
    outcomes,
    notReached: userIds.length - Object.values(outcomes).reduce((a, b) => a + (b ?? 0), 0),
    leaguesChecked,
    previews,
    errors: errors.slice(0, 10),
  }
}
