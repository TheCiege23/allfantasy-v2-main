import "server-only"
import { createPlatformNotification } from "@/lib/platform/notification-service"
import { prisma } from "@/lib/prisma"
import { sendSms } from "@/lib/twilio-client"
import { reserveSmsToday } from "@/lib/notifications/smsDailyCap"
import {
  getWorldCupNotificationPreferenceResolution,
  isWorldCupNotificationTypeEnabled,
  type WorldCupNotificationType,
} from "./worldCupNotificationPreferences"

export type WorldCupNotificationDiagnostics = {
  userId: string
  type: WorldCupNotificationType
  inAppSent: boolean
  twilioConfigured: boolean
  smsEligible: boolean
  smsSent: boolean
  skippedReason?: string
}

type WorldCupNotificationDispatchInput = {
  userIds: string[]
  challengeId: string
  type: WorldCupNotificationType
  title: string
  body: string
  smsBody: string
  sourceKeyPrefix: string
  messageId?: string | null
  severity?: "low" | "medium" | "high"
  privateSafe?: boolean
  excludeUserIds?: string[]
  meta?: Record<string, unknown>
}

type WorldCupChallengeRecipient = {
  userId: string
}

function uniqueUserIds(userIds: string[], excludeUserIds: string[] = []) {
  const excluded = new Set(excludeUserIds)
  return Array.from(new Set(userIds.filter(Boolean))).filter((userId) => !excluded.has(userId))
}

function truncateText(value: string, max = 280) {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 3))}...` : normalized
}

function twilioConfigured() {
  const hasAccount = Boolean(process.env.TWILIO_ACCOUNT_SID?.trim())
  const hasFrom = Boolean(process.env.TWILIO_PHONE_NUMBER?.trim())
  const hasAuthToken = Boolean(process.env.TWILIO_AUTH_TOKEN?.trim())
  const hasApiKeys = Boolean(process.env.TWILIO_API_KEY?.trim() && process.env.TWILIO_API_SECRET?.trim())
  return hasAccount && hasFrom && (hasAuthToken || hasApiKeys)
}

async function getWorldCupChallengeName(challengeId: string) {
  const findUnique = (prisma as any)?.worldCupBracketChallenge?.findUnique
  if (typeof findUnique !== "function") return "World Cup Pool"
  const challenge = await findUnique({
    where: { id: challengeId },
    select: { name: true },
  })
  return challenge?.name ? String(challenge.name) : "World Cup Pool"
}

export async function getWorldCupChallengeParticipantUserIds(challengeId: string) {
  const findMany = (prisma as any)?.worldCupBracketParticipant?.findMany
  if (typeof findMany !== "function") return []
  const participants = await findMany({
    where: { challengeId },
    select: { userId: true },
  }) as WorldCupChallengeRecipient[]
  return participants.map((participant) => participant.userId)
}

async function dispatchWorldCupNotification(
  input: WorldCupNotificationDispatchInput
): Promise<WorldCupNotificationDiagnostics[]> {
  const configured = twilioConfigured()
  const diagnostics: WorldCupNotificationDiagnostics[] = []
  const recipients = uniqueUserIds(input.userIds, input.excludeUserIds)

  for (const userId of recipients) {
    const resolution = await getWorldCupNotificationPreferenceResolution(userId, input.challengeId)
    const prefs = resolution.preferences
    const typeEnabled = isWorldCupNotificationTypeEnabled(prefs, input.type)
    const inAppAllowed = prefs.inAppEnabled && typeEnabled
    const smsEligible = Boolean(
      typeEnabled &&
        prefs.smsEnabled &&
        resolution.phoneVerified &&
        resolution.phone &&
        configured
    )

    let inAppSent = false
    let smsSent = false
    let skippedReason: string | undefined

    if (inAppAllowed) {
      inAppSent = await createPlatformNotification({
        userId,
        productType: "bracket",
        type: `world_cup_${input.type}`,
        title: input.title,
        body: input.body,
        severity: input.severity ?? "low",
        sourceKey: `${input.sourceKeyPrefix}:${userId}`,
        meta: {
          challengeId: input.challengeId,
          worldCupNotificationType: input.type,
          privateSafe: input.privateSafe ?? false,
          ...(input.messageId ? { messageId: input.messageId } : {}),
          ...(input.meta ?? {}),
        },
      })
    } else {
      skippedReason = prefs.poolMuted
        ? "pool_muted"
        : !typeEnabled
          ? "type_disabled"
          : "inapp_disabled"
    }

    // Same per-recipient daily text budget as NotificationDispatcher (lib/notifications/smsDailyCap).
    if (smsEligible && resolution.phone) {
      if (await reserveSmsToday(userId)) {
        smsSent = await sendSms(resolution.phone, truncateText(input.smsBody, 320))
      } else if (!skippedReason) {
        skippedReason = "sms_daily_cap"
      }
    }

    diagnostics.push({
      userId,
      type: input.type,
      inAppSent,
      twilioConfigured: configured,
      smsEligible,
      smsSent,
      skippedReason,
    })
  }

  return diagnostics
}

export async function notifyWorldCupMention(input: {
  challengeId: string
  poolName?: string
  senderName: string
  body: string
  messageId: string
  senderUserId: string
  targetUserIds: string[]
}) {
  const poolName = input.poolName ?? await getWorldCupChallengeName(input.challengeId)
  return dispatchWorldCupNotification({
    userIds: input.targetUserIds,
    excludeUserIds: [input.senderUserId],
    challengeId: input.challengeId,
    type: "usernameMention",
    title: "World Cup pool mention",
    body: `${input.senderName} mentioned you in ${poolName}.`,
    smsBody: `You were mentioned in World Cup Pool: ${poolName}.`,
    sourceKeyPrefix: `world-cup-chat-mention:${input.messageId}`,
    messageId: input.messageId,
    meta: { preview: truncateText(input.body, 140) },
  })
}

export async function notifyWorldCupAllMention(input: {
  challengeId: string
  poolName?: string
  senderName: string
  body: string
  messageId: string
  senderUserId: string
}) {
  const poolName = input.poolName ?? await getWorldCupChallengeName(input.challengeId)
  const participantUserIds = await getWorldCupChallengeParticipantUserIds(input.challengeId)
  return dispatchWorldCupNotification({
    userIds: participantUserIds,
    excludeUserIds: [input.senderUserId],
    challengeId: input.challengeId,
    type: "allMention",
    title: `World Cup @all in ${poolName}`,
    body: `${input.senderName}: ${truncateText(input.body, 180)}`,
    smsBody: `World Cup @all in ${poolName}: ${truncateText(input.body, 180)}`,
    sourceKeyPrefix: `world-cup-chat-all:${input.messageId}`,
    messageId: input.messageId,
    severity: "medium",
  })
}

export async function notifyWorldCupCommissionerAnnouncement(input: {
  challengeId: string
  poolName?: string
  senderUserId?: string | null
  announcement: string
  sourceId: string
}) {
  const poolName = input.poolName ?? await getWorldCupChallengeName(input.challengeId)
  const participantUserIds = await getWorldCupChallengeParticipantUserIds(input.challengeId)
  return dispatchWorldCupNotification({
    userIds: participantUserIds,
    excludeUserIds: input.senderUserId ? [input.senderUserId] : [],
    challengeId: input.challengeId,
    type: "commissionerAnnouncement",
    title: `Commissioner announcement in ${poolName}`,
    body: truncateText(input.announcement, 240),
    smsBody: `Commissioner announcement in ${poolName}: ${truncateText(input.announcement, 160)}`,
    sourceKeyPrefix: `world-cup-commissioner-announcement:${input.sourceId}`,
    severity: "medium",
  })
}

export async function notifyWorldCupDeadlineReminder(input: {
  challengeId: string
  poolName?: string
  reminder: string
  sourceId: string
}) {
  const poolName = input.poolName ?? await getWorldCupChallengeName(input.challengeId)
  const participantUserIds = await getWorldCupChallengeParticipantUserIds(input.challengeId)
  return dispatchWorldCupNotification({
    userIds: participantUserIds,
    challengeId: input.challengeId,
    type: "deadlineReminder",
    title: `World Cup picks lock soon for ${poolName}`,
    body: truncateText(input.reminder, 240),
    smsBody: `World Cup picks lock soon for ${poolName}.`,
    sourceKeyPrefix: `world-cup-deadline-reminder:${input.sourceId}`,
    severity: "medium",
  })
}

export async function notifyWorldCupBracketFinalized(input: {
  challengeId: string
  poolName?: string
  userId: string
  entryId: string
}) {
  const poolName = input.poolName ?? await getWorldCupChallengeName(input.challengeId)
  return dispatchWorldCupNotification({
    userIds: [input.userId],
    challengeId: input.challengeId,
    type: "bracketFinalized",
    title: "World Cup bracket finalized",
    body: `Your bracket is finalized for ${poolName}.`,
    smsBody: `Your World Cup bracket is finalized for ${poolName}.`,
    sourceKeyPrefix: `world-cup-bracket-finalized:${input.entryId}`,
    meta: { entryId: input.entryId },
  })
}

export async function notifyWorldCupResultsUpdated(input: {
  challengeId: string
  poolName?: string
  sourceId: string
}) {
  const poolName = input.poolName ?? await getWorldCupChallengeName(input.challengeId)
  const participantUserIds = await getWorldCupChallengeParticipantUserIds(input.challengeId)
  return dispatchWorldCupNotification({
    userIds: participantUserIds,
    challengeId: input.challengeId,
    type: "resultsUpdated",
    title: `Results updated in ${poolName}`,
    body: "World Cup results were updated. Check your bracket.",
    smsBody: `Results updated in ${poolName}. Check your bracket.`,
    sourceKeyPrefix: `world-cup-results-updated:${input.sourceId}`,
    severity: "medium",
  })
}

export async function notifyWorldCupLeaderboardUpdated(input: {
  challengeId: string
  poolName?: string
  sourceId: string
}) {
  const poolName = input.poolName ?? await getWorldCupChallengeName(input.challengeId)
  const participantUserIds = await getWorldCupChallengeParticipantUserIds(input.challengeId)
  return dispatchWorldCupNotification({
    userIds: participantUserIds,
    challengeId: input.challengeId,
    type: "leaderboardUpdated",
    title: `Leaderboard updated in ${poolName}`,
    body: "The World Cup pool leaderboard changed.",
    smsBody: `Leaderboard updated in ${poolName}.`,
    sourceKeyPrefix: `world-cup-leaderboard-updated:${input.sourceId}`,
    severity: "medium",
  })
}

export async function notifyWorldCupChimmyReply(input: {
  challengeId: string
  poolName?: string
  userId: string
  messageId: string
}) {
  const poolName = input.poolName ?? await getWorldCupChallengeName(input.challengeId)
  return dispatchWorldCupNotification({
    userIds: [input.userId],
    challengeId: input.challengeId,
    type: "chimmyReply",
    title: "Private Chimmy reply ready",
    body: `Your private World Cup Chimmy reply is ready in ${poolName}.`,
    smsBody: `Private Chimmy reply ready in ${poolName}.`,
    sourceKeyPrefix: `world-cup-chimmy-reply:${input.messageId}`,
    messageId: input.messageId,
    privateSafe: true,
  })
}
