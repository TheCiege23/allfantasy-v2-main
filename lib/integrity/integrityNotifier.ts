import "server-only"

// PRIVACY BOUNDARY: Notifications reference integrity flags only — no chat payloads.

import { prisma } from "@/lib/prisma"
import { dispatchNotification } from "@/lib/notifications/NotificationDispatcher"
import { readTradeAlertsEnabled } from "@/lib/integrity/tradeAlerts"
import { resolveFlagManagers } from "@/lib/integrity/flagManagers"
import { buildIntegrityAlertCopy, type IntegrityAlertCopy } from "@/lib/integrity/alertCopy"
import { getBaseUrl } from "@/lib/get-base-url"

/** The flag itself, not just the page — the page scrolls to it and highlights it. */
export function integrityFlagHref(leagueId: string, flagId: string): string {
  return `/league/${leagueId}/commissioner/integrity?flag=${encodeURIComponent(flagId)}`
}

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
  copy: IntegrityAlertCopy,
  severity: "high" | "medium"
): Promise<boolean> {
  try {
    await dispatchNotification({
      userIds: [userId],
      category: "commissioner_alerts",
      type: flagType === "collusion" ? "integrity_collusion_flag" : "integrity_tanking_flag",
      title: copy.title,
      body: copy.body,
      smsBody: copy.sms,
      severity,
      leagueId,
      actionHref: integrityFlagHref(leagueId, flagId),
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
      league: { select: { userId: true, settings: true, name: true } },
    },
  })
  if (!flag) return
  if (flag.notifiedAt) return
  // The commissioner switched suspicious-trade alerts off: the flag stays on the review page, unsent.
  if (flag.flagType === "collusion" && !readTradeAlertsEnabled(flag.league.settings)) return

  const severity = flag.severity === "high" ? "high" : "medium"
  const flagType: "collusion" | "tanking" =
    flag.flagType === "collusion" ? "collusion" : "tanking"

  /*
   * Name the managers in the alert itself. The summary describes the assets, so without this a
   * commissioner was told WHAT moved but not WHO moved it, and had to open the page to find out.
   */
  const managers = ((await resolveFlagManagers([flag]).catch(() => null))?.get(flag.id) ?? []).map((m) => m.managerName)
  const copy = buildIntegrityAlertCopy({
    flagType,
    managers,
    evidence: flag.evidenceJson,
    summary: flag.summary ?? "",
    leagueName: flag.league.name ?? null,
    url: `${getBaseUrl()}${integrityFlagHref(flag.leagueId, flag.id)}`,
  })

  const sent = await sendIntegrityNotification(flag.league.userId, flag.leagueId, flag.id, flagType, copy, severity)
  // Unsent stays unmarked: notifiedAt then records only alerts that were actually sent.
  if (!sent) return

  await prisma.integrityFlag.update({
    where: { id: flagId },
    data: { notifiedAt: new Date() },
  })
}
