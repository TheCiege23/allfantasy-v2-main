import { dispatchNotification } from "@/lib/notifications/NotificationDispatcher"
import { getDeepLinkRedirect } from "@/lib/routing/DeepLinkHandler"

/**
 * Sends engagement notifications (daily digest, league reminder, AI insight, weekly recap).
 * All notifications include meta.actionHref / actionLabel for deep linking when set.
 */
export async function sendDailyDigest(params: {
  userId: string
  title: string
  body?: string
  actionHref?: string
  actionLabel?: string
  leagueId?: string
}): Promise<boolean> {
  const href = params.actionHref
    ? getDeepLinkRedirect(params.actionHref, "/dashboard")
    : params.leagueId
      ? `/league/${params.leagueId}`
      : "/dashboard"
  await dispatchNotification({
    userIds: [params.userId],
    category: "system_account",
    productType: "app",
    type: "daily_digest",
    title: params.title,
    body: params.body ?? undefined,
    actionHref: href,
    actionLabel: params.actionLabel ?? "Open",
    meta: { leagueId: params.leagueId ?? undefined },
    severity: "low",
  })
  return true
}

export async function sendLeagueReminder(params: {
  userId: string
  leagueId: string
  title: string
  body?: string
  actionLabel?: string
}): Promise<boolean> {
  const href = getDeepLinkRedirect(`/league/${params.leagueId}`, "/dashboard")
  await dispatchNotification({
    userIds: [params.userId],
    category: "lineup_reminders",
    productType: "app",
    type: "league_reminder",
    title: params.title,
    body: params.body ?? undefined,
    actionHref: href,
    actionLabel: params.actionLabel ?? "Open league",
    meta: { leagueId: params.leagueId },
    severity: "medium",
  })
  return true
}

export async function sendAIInsight(params: {
  userId: string
  title: string
  body?: string
  actionHref?: string
  actionLabel?: string
  leagueId?: string
}): Promise<boolean> {
  const href = params.actionHref
    ? getDeepLinkRedirect(params.actionHref, "/af-legacy")
    : params.leagueId
      ? `/league/${params.leagueId}`
      : "/af-legacy"
  await dispatchNotification({
    userIds: [params.userId],
    category: "ai_alerts",
    productType: "legacy",
    type: "ai_insight",
    title: params.title,
    body: params.body ?? undefined,
    actionHref: href,
    actionLabel: params.actionLabel ?? "View",
    meta: { leagueId: params.leagueId ?? undefined },
    severity: "low",
  })
  return true
}

export async function sendWeeklyRecap(params: {
  userId: string
  title: string
  body: string
  actionHref: string
  actionLabel: string
  meta?: Record<string, unknown>
}): Promise<boolean> {
  const href = getDeepLinkRedirect(params.actionHref, "/dashboard")
  await dispatchNotification({
    userIds: [params.userId],
    category: "matchup_results",
    productType: "shared",
    type: "weekly_recap",
    title: params.title,
    body: params.body,
    actionHref: href,
    actionLabel: params.actionLabel,
    meta: params.meta,
    severity: "low",
  })
  return true
}
