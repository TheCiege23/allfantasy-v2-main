import { getActivitySummary } from "./UserActivityTracker"
import { sendWeeklyRecap } from "./EngagementNotificationService"
import type { WeeklyRecapPayload } from "./types"

/**
 * Builds a weekly recap from the user's activity and optionally sends the notification.
 */
export async function buildWeeklyRecap(userId: string): Promise<WeeklyRecapPayload | null> {
  const since = new Date()
  since.setDate(since.getDate() - 7)

  const summary = await getActivitySummary(userId, since)

  const total = summary.leagueViews + summary.bracketViews + summary.aiUses
  if (total === 0) {
    return {
      title: "Your week on AllFantasy",
      body: "You haven't been active this week. Open a league or try the trade analyzer to get started.",
      actionHref: "/dashboard",
      actionLabel: "Go to dashboard",
    }
  }

  const parts: string[] = []
  if (summary.leagueViews > 0) parts.push(`${summary.leagueViews} league visit${summary.leagueViews !== 1 ? "s" : ""}`)
  if (summary.bracketViews > 0) parts.push(`${summary.bracketViews} bracket view${summary.bracketViews !== 1 ? "s" : ""}`)
  if (summary.aiUses > 0) parts.push(`${summary.aiUses} Chimmy tool use${summary.aiUses !== 1 ? "s" : ""}`)

  return {
    title: "Your weekly recap",
    body: `This week: ${parts.join(", ")}. Keep it up!`,
    actionHref: "/dashboard",
    actionLabel: "Open dashboard",
    leagueViews: summary.leagueViews,
    bracketViews: summary.bracketViews,
    aiUses: summary.aiUses,
  }
}

/**
 * Generate and send weekly recap notification for a user.
 */
export async function generateAndSendWeeklyRecap(userId: string): Promise<boolean> {
  const payload = await buildWeeklyRecap(userId)
  if (!payload) return false
  return sendWeeklyRecap({
    userId,
    title: payload.title,
    body: payload.body,
    actionHref: payload.actionHref,
    actionLabel: payload.actionLabel,
    meta: {
      leagueViews: payload.leagueViews,
      bracketViews: payload.bracketViews,
      aiUses: payload.aiUses,
    },
  })
}
