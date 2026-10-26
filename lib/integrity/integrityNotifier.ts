import "server-only"

// PRIVACY BOUNDARY: Notifications reference integrity flags only — no chat payloads.

import { prisma } from "@/lib/prisma"
import { dispatchNotification } from "@/lib/notifications/NotificationDispatcher"
import { readTradeAlertsEnabled } from "@/lib/integrity/tradeAlerts"

/**
 * Sends straight through the dispatcher. This used to `queue.add` onto the BullMQ notifications
 * queue, which has no worker in production (lib/integrity/runIntegrityJob.ts), so no integrity
 * alert ever reached a commissioner. The Chimmy commissioner alerts already dispatch directly.
 */
async function sendIntegrityNotification(
  userId: string,
  leagueId: string,
  flagId: string,
  flagType: "collusion" | "tanking",
  summary: string,
  severity: "high" | "medium"
): Promise<boolean> {
  try {
    await dispatchNotification({
      userIds: [userId],
      category: "commissioner_alerts",
      type: flagType === "collusion" ? "integrity_collusion_flag" : "integrity_tanking_flag",
      title: flagType === "collusion" ? "⚠️ Potential collusion detected" : "⚠️ Potential tanking detected",
      body: summary,
      severity,
      leagueId,
      actionHref: `/league/${leagueId}/commissioner/integrity`,
      actionLabel: "Review flag",
      meta: { leagueId, flagId, flagType },
    })
    return true
  } catch (err) {
    console.error("[integrityNotifier] Failed to send notification:", err)
    return false
  }
}

export async function notifyCommissionerOfFlag(flagId: string): Promise<void> {
  const flag = await prisma.integrityFlag.findFirst({
    where: { id: flagId },
    include: {
      league: { select: { userId: true, settings: true } },
    },
  })
  if (!flag) return
  if (flag.notifiedAt) return
  // The commissioner switched suspicious-trade alerts off: the flag stays on the review page, unsent.
  if (flag.flagType === "collusion" && !readTradeAlertsEnabled(flag.league.settings)) return

  const severity = flag.severity === "high" ? "high" : "medium"
  const flagType: "collusion" | "tanking" =
    flag.flagType === "collusion" ? "collusion" : "tanking"

  const sent = await sendIntegrityNotification(
    flag.league.userId,
    flag.leagueId,
    flag.id,
    flagType,
    flag.summary ?? "",
    severity
  )
  // Unsent stays unmarked: notifiedAt then records only alerts that were actually sent.
  if (!sent) return

  await prisma.integrityFlag.update({
    where: { id: flagId },
    data: { notifiedAt: new Date() },
  })
}
