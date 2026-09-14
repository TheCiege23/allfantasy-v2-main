/**
 * Hooks called after waiver processing: activity feed, league chat, player trend signals, and notifications.
 */

import { prisma } from "@/lib/prisma"
import { createSystemMessage } from "@/lib/platform/chat-service"
import { recordTrendSignalsAndUpdate } from "@/lib/player-trend"
import { getLeagueMemberAppUserIds } from "@/lib/draft-notifications/DraftNotificationService"
import { dispatchNotification } from "@/lib/notifications/NotificationDispatcher"
import { handleInvalidationTrigger } from "@/lib/trade-engine/caching"
import { onWaiverReaction } from "@/lib/commentary-engine"
import { normalizeToSupportedSport } from "@/lib/sport-scope"
import { isLeaguePrefEnabled, parseLeagueNotificationPrefs } from "@/lib/league/league-notification-prefs"
import type { ProcessedClaimResult } from "./types"

/** Called after processWaiverClaimsForLeague; posts to activity feed and league chat when configured. */
export async function onWaiverRunComplete(
  leagueId: string,
  results: ProcessedClaimResult[]
): Promise<void> {
  handleInvalidationTrigger("waiver_processed", leagueId)

  const awarded = results.filter((r) => r.success).length
  const message =
    awarded === 0
      ? "Waivers processed. No claims awarded."
      : `Waivers processed. ${awarded} claim${awarded === 1 ? "" : "s"} awarded.`

  try {
    const memberIds = await getLeagueMemberAppUserIds(leagueId)
    if (memberIds.length > 0) {
      const league = await (prisma as any).league.findUnique({
        where: { id: leagueId },
        select: { name: true, settings: true },
      })
      const prefs = parseLeagueNotificationPrefs(league?.settings)
      if (isLeaguePrefEnabled(prefs, "waiverResults")) {
        const leagueName = league?.name ? ` — ${league.name}` : ""
        dispatchNotification({
          userIds: memberIds,
          category: "waiver_processing",
          productType: "app",
          type: "waiver_processed",
          title: `Waivers processed${leagueName}`,
          body: message,
          actionHref: `/league/${leagueId}`,
          actionLabel: "Open league",
          meta: { leagueId, awarded, total: results.length },
          severity: "medium",
        }).catch((e) => console.error("[waiver run] notify", e))
      }
    }
  } catch {
    // non-fatal
  }

  try {
    const rosterRows = await (prisma as any).roster.findMany({
      where: { id: { in: [...new Set(results.map((r) => r.rosterId))] } },
      select: { id: true, platformUserId: true },
    })
    const uidByRoster = new Map(rosterRows.map((r: { id: string; platformUserId: string }) => [r.id, r.platformUserId]))
    for (const r of results) {
      const uid = uidByRoster.get(r.rosterId)
      if (!uid || typeof uid !== "string" || !uid.trim()) continue
      if (r.success) {
        void dispatchNotification({
          userIds: [uid.trim()],
          category: "waiver_processing",
          productType: "app",
          type: "waiver_claim_won",
          title: "Waiver claim awarded",
          body: r.message ?? "Your waiver claim was processed.",
          actionHref: `/league/${leagueId}`,
          actionLabel: "View roster",
          meta: { leagueId, claimId: r.claimId, addPlayerId: r.addPlayerId, outcomeCode: r.outcomeCode ?? "won" },
          severity: "low",
        }).catch(() => {})
      } else {
        /*
         * EVERY claim that did not go through, not three outcome codes. The waiver job used to
         * queue its own "not awarded" bell entry for all failures beside this one, which is why
         * this branch could afford to be narrow. That queue entry is gone (it duplicated the won
         * announcement and skipped the user's settings — see processLeagueWaiversJob), so this
         * is now the only announcement and must cover lost_priority and lost_tiebreaker, the
         * common ways to lose a claim.
         */
        void dispatchNotification({
          userIds: [uid.trim()],
          category: "waiver_processing",
          productType: "app",
          type: "waiver_claim_lost",
          title: "Waiver claim not awarded",
          body: r.message ?? "Your waiver claim did not go through.",
          actionHref: `/league/${leagueId}`,
          actionLabel: "Review waivers",
          meta: { leagueId, claimId: r.claimId, outcomeCode: r.outcomeCode },
          severity: "low",
        }).catch(() => {})
      }
    }
  } catch {
    // non-fatal
  }

  try {
    await (prisma as any).activityEvent.create({
      data: {
        leagueId,
        type: "waiver",
        message,
        metadata: { awarded, total: results.length },
      },
    })
  } catch {
    // non-fatal
  }

  try {
    const league = await (prisma as any).league.findUnique({
      where: { id: leagueId },
      select: { settings: true, sport: true },
    })
    const settings = (league?.settings as Record<string, unknown>) || {}
    const threadId = settings.leagueChatThreadId as string | undefined
    if (threadId && typeof threadId === "string") {
      await createSystemMessage(threadId, "waiver_bot", message).catch(() => {})
    }

    // Player Trend Detection: record waiver_add / waiver_drop for processed claims
    const sport = league?.sport != null ? String(league.sport) : "NFL"
    const events: Array<{ playerId: string; sport: string; signalType: string; leagueId?: string }> = []
    for (const r of results) {
      if (r.success && r.addPlayerId) {
        events.push({ playerId: r.addPlayerId, sport, signalType: "waiver_add", leagueId: leagueId })
      }
      if (r.success && r.dropPlayerId) {
        events.push({ playerId: r.dropPlayerId, sport, signalType: "waiver_drop", leagueId: leagueId })
      }
    }
    if (events.length > 0) {
      recordTrendSignalsAndUpdate(events).catch(() => {})
    }

    // Emit a small number of waiver reaction commentary entries.
    const successful = results.filter((r) => r.success).slice(0, 3)
    if (successful.length > 0) {
      const rosterRows = await (prisma as any).roster.findMany({
        where: { id: { in: successful.map((r) => r.rosterId) } },
        select: { id: true, platformUserId: true },
      })
      const teamRows = await (prisma as any).leagueTeam.findMany({
        where: {
          leagueId,
          externalId: { in: rosterRows.map((r: { platformUserId: string }) => r.platformUserId) },
        },
        select: { externalId: true, ownerName: true, teamName: true },
      })
      const platformIdByRosterId = new Map(
        rosterRows.map((row: { id: string; platformUserId: string }) => [row.id, row.platformUserId])
      )
      const managerByPlatformUser = new Map(
        teamRows.map((row: { externalId: string; ownerName: string; teamName: string }) => [
          row.externalId,
          row.ownerName || row.teamName || row.externalId,
        ])
      )
      const commentarySport = normalizeToSupportedSport(sport)
      for (const claim of successful) {
        const platformUserId = platformIdByRosterId.get(claim.rosterId)
        const managerNameRaw = platformUserId
          ? managerByPlatformUser.get(platformUserId) ?? platformUserId
          : claim.rosterId
        const managerName = String(managerNameRaw || claim.rosterId || "Manager").trim() || "Manager"
        const playerName = String(claim.addPlayerId || "").trim() || "Waiver add"
        void onWaiverReaction(
          {
            eventType: "waiver_reaction",
            leagueId,
            sport: commentarySport,
            managerName,
            playerName,
            action: "claim",
            faabSpent: claim.faabSpent ?? undefined,
          },
          { skipStats: true, persist: true }
        ).catch(() => {})
      }
    }
  } catch {
    // non-fatal
  }
}
