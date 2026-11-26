import 'server-only'

/**
 * The sender for live danger alerts (rules and words in ./survivalAlertRules.ts).
 *
 * Called by score-sync beside the chop-zone warning (./chopAlerts.ts), for a guillotine league whose next chop
 * week is the week being played. It reuses that warning's parts on purpose: the same recipients, the same
 * "when does the week's last game start", the same dispatcher, so a manager's own switches, quiet hours and
 * league mutes apply.
 *
 * AT MOST ONCE, the same way the warning does it: a lock held for half an hour and never released, so two
 * worker replicas and five-minute ticks look once per half hour between them; and every send is recorded as a
 * league event BEFORE it goes out, so a crash mid-loop cannot send the same alert twice. The bell row and each
 * channel are deduped again by the dispatcher's key.
 *
 * The number in the alert is the number on the Chop page: the same scores (the chop preview's rows), the same
 * outlook, the same function.
 */
import { prisma } from '@/lib/prisma'
import { acquireAutomationLock } from '@/lib/automation/locks'
import type { DispatchNotificationParams } from '@/lib/notifications/NotificationDispatcher'
import { appendEvent } from './GuillotineEventLog'
import { CHOP_ZONE_WARNING_LEAD_MS, chopAlertLeagueName, chopAlertUsersByRoster, lastGameStartOfWeek, leagueSetsItsOwnLineups } from './chopAlerts'
import { loadChopPreview } from './chopPreviewLoad'
import type { ChopPreview } from './chopPreview'
import { survivalOdds, type TeamOutlook } from './survivalOutlook'
import { loadSurvivalOutlook } from './survivalOutlookLoad'
import { survivalAlertCopy, survivalAlertsDue, type SurvivalAlertLevel } from './survivalAlertRules'

export const SURVIVAL_ALERT_EVENT = 'survival_odds_alert' as const
/** The odds are looked at again this often. */
export const SURVIVAL_ALERT_RECHECK_MS = 30 * 60 * 1000

export type SurvivalAlertOutcome =
  | 'sent'
  | 'no_change'
  | 'throttled'
  | 'schedule_unknown'
  | 'final_day'
  | 'no_chop_this_week'
  | 'week_mismatch'
  | 'blocked'
  | 'no_outlook'
  | 'no_odds'

type Dispatch = (params: DispatchNotificationParams) => Promise<unknown>

export type SurvivalAlertDeps = {
  now?: () => Date
  lastGameStart?: (args: { sport: string; season: number; week: number; now: Date }) => Promise<Date | null>
  loadPreview?: (leagueId: string) => Promise<ChopPreview | { error: string }>
  loadOutlook?: (leagueId: string, week: number, now: Date) => Promise<Record<string, TeamOutlook> | null>
  dispatch?: Dispatch
}

async function defaultDispatch(params: DispatchNotificationParams): Promise<unknown> {
  const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
  return dispatchNotification(params)
}

/** What this week's alerts already told each team, from the league events they left. */
async function sentSoFar(leagueId: string, key: string): Promise<Map<string, SurvivalAlertLevel[]>> {
  const rows = await prisma.guillotineEventLog.findMany({
    where: { leagueId, eventType: SURVIVAL_ALERT_EVENT, metadata: { path: ['key'], equals: key } },
    select: { metadata: true },
  })
  const sent = new Map<string, SurvivalAlertLevel[]>()
  for (const row of rows) {
    const m = (row.metadata ?? {}) as { sent?: Record<string, unknown> }
    if (!m.sent || typeof m.sent !== 'object') continue
    for (const [rosterId, level] of Object.entries(m.sent)) {
      if (level !== 'at_risk' && level !== 'recovered') continue
      sent.set(rosterId, [...(sent.get(rosterId) ?? []), level])
    }
  }
  return sent
}

export async function sendSurvivalOddsAlerts(
  input: { leagueId: string; seasonId: string; sport: string; season: number; week: number },
  deps: SurvivalAlertDeps = {},
): Promise<{ outcome: SurvivalAlertOutcome; sent?: number }> {
  const now = deps.now?.() ?? new Date()
  const key = `${input.season}:w${input.week}`

  const lastStart = await (deps.lastGameStart ?? lastGameStartOfWeek)({ sport: input.sport, season: input.season, week: input.week, now })
  if (!lastStart) return { outcome: 'schedule_unknown' }
  // The last day belongs to the standings warning (./chopAlerts.ts); two alerts about one afternoon is one too many.
  if (now.getTime() >= lastStart.getTime() - CHOP_ZONE_WARNING_LEAD_MS) return { outcome: 'final_day' }

  const lock = await acquireAutomationLock(`guillotine-survival-alert-check:${input.leagueId}:${key}`, {
    ttlMs: SURVIVAL_ALERT_RECHECK_MS,
    owner: `survival-alert:${input.seasonId}:${now.getTime()}`,
  })
  if (!lock.ok) return { outcome: 'throttled' }

  const preview = await (deps.loadPreview ?? loadChopPreview)(input.leagueId)
  if ('error' in preview || preview.outcome !== 'chop') return { outcome: 'no_chop_this_week' }
  if (preview.week !== input.week) return { outcome: 'week_mismatch' }
  // The real chop would refuse to run: an alert about it would be about a chop that is not coming.
  if (preview.blockers.length > 0) return { outcome: 'blocked' }

  const outlook = await (deps.loadOutlook ?? loadSurvivalOutlook)(input.leagueId, input.week, now)
  if (!outlook || !preview.rows.every((row) => outlook[row.rosterId])) return { outcome: 'no_outlook' }
  // The Chop page's own number: the same rows, the same outlook, the same function.
  const odds = survivalOdds(
    preview.rows.map((row) => ({ rosterId: row.rosterId, current: row.points, remainingProjection: outlook[row.rosterId]!.remainingProjection, immune: row.status === 'immune' })),
    preview.chopCount,
  )
  if (!odds) return { outcome: 'no_odds' }

  // Read under the lock: a replica that looked a moment ago may have just sent.
  const due = survivalAlertsDue(odds, await sentSoFar(input.leagueId, key))
  if (due.length === 0) return { outcome: 'no_change' }

  const owners = await chopAlertUsersByRoster(input.leagueId, due.map((d) => d.rosterId))
  const name = await chopAlertLeagueName(input.leagueId)
  const bestBall = await leagueSetsItsOwnLineups(input.leagueId).catch(() => false)
  // Recorded before sending: a second replica (or a crash mid-loop) must not send these again.
  await appendEvent(input.leagueId, SURVIVAL_ALERT_EVENT, {
    key,
    week: input.week,
    season: input.season,
    sent: Object.fromEntries(due.map((d) => [d.rosterId, d.level])),
    odds: Object.fromEntries(due.map((d) => [d.rosterId, d.safePct])),
  })

  const dispatch = deps.dispatch ?? defaultDispatch
  let sent = 0
  for (const { rosterId, level, safePct } of due) {
    const userId = owners.get(rosterId)
    if (!userId) continue
    const alert = survivalAlertCopy({ leagueName: name, week: input.week, level, safePct, startersLeft: outlook[rosterId]?.playersLeft ?? null, bestBall })
    try {
      await dispatch({
        userIds: [userId],
        category: 'matchup_results',
        type: level === 'at_risk' ? 'guillotine_survival_at_risk' : 'guillotine_survival_recovered',
        title: alert.title,
        body: alert.body,
        severity: alert.severity,
        actionHref: `/league/${input.leagueId}`,
        actionLabel: bestBall || level === 'recovered' ? 'Open league' : 'Set lineup',
        leagueId: input.leagueId,
        // `pushTag`: a later alert for THIS league replaces this one on the device, and one for another league
        // does not (lib/notifications/pushTag.ts falls back to one tag for the whole category otherwise).
        meta: { guillotineWeek: input.week, safePct, leagueId: input.leagueId, pushTag: `guillotine-survival-${input.leagueId}` },
        // Per kind: at risk and recovered are two alerts, not one deduped away.
        dedupePrefix: `guillotine-survival:${input.leagueId}:${input.season}:w${input.week}:${level}`,
      })
      sent += 1
    } catch (error) {
      console.warn('[guillotine] survival alert not sent', { leagueId: input.leagueId, week: input.week, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { outcome: 'sent', sent }
}

/** score-sync's entry: the season row names the league, sport and year. */
export async function sendSurvivalOddsAlertsForSeason(
  input: { seasonId: string; week: number },
  deps: SurvivalAlertDeps = {},
): Promise<{ outcome: SurvivalAlertOutcome | 'season_not_found'; sent?: number }> {
  const season = await prisma.redraftSeason.findUnique({ where: { id: input.seasonId }, select: { leagueId: true, sport: true, season: true } })
  if (!season) return { outcome: 'season_not_found' }
  return sendSurvivalOddsAlerts({ leagueId: season.leagueId, seasonId: input.seasonId, sport: season.sport, season: season.season, week: input.week }, deps)
}
