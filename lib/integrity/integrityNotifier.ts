import "server-only"

// PRIVACY BOUNDARY: Notifications reference integrity flags only — no chat payloads.

import { prisma } from "@/lib/prisma"
import { getNotificationsQueue } from "@/lib/queues/bullmq"
import { readTradeAlertsEnabled } from "@/lib/integrity/tradeAlerts"

async function enqueueIntegrityNotification(
  userId: string,
  leagueId: string,
  flagId: string,
  flagType: "collusion" | "tanking",
  summary: string,
  severity: "high" | "medium"
): Promise<void> {
  const queue = getNotificationsQueue()
  if (!queue) return
  try {
    await queue.add(
      "integrity_flag",
      {
        userIds: [userId],
        category: "commissioner_alerts",
        type: flagType === "collusion" ? "integrity_collusion_flag" : "integrity_tanking_flag",
        title:
          flagType === "collusion" ? "⚠️ Potential collusion detected" : "⚠️ Potential tanking detected",
        body: summary,
        severity,
        actionHref: `/league/${leagueId}/commissioner/integrity`,
        actionLabel: "Review flag",
        meta: { leagueId, flagId, flagType },
      },
      { removeOnComplete: true }
    )
  } catch (err) {
    console.error("[integrityNotifier] Failed to enqueue notification:", err)
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

  await enqueueIntegrityNotification(
    flag.league.userId,
    flag.leagueId,
    flag.id,
    flagType,
    flag.summary ?? "",
    severity
  )

  await prisma.integrityFlag.update({
    where: { id: flagId },
    data: { notifiedAt: new Date() },
  })
}
