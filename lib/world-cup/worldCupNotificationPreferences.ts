import "server-only"
import { getSettingsProfile, updateUserProfile } from "@/lib/user-settings"
import { hasSmsConsent } from "@/lib/sms/smsConsent"
import { resolveNotificationPreferences } from "@/lib/notification-settings/NotificationPreferenceResolver"
import type { NotificationPreferences } from "@/lib/notification-settings/types"
import type { QuietHoursPreference } from "@/lib/notifications/quietHours"

export type WorldCupNotificationType =
  | "usernameMention"
  | "allMention"
  | "commissionerAnnouncement"
  | "deadlineReminder"
  | "bracketFinalized"
  | "resultsUpdated"
  | "leaderboardUpdated"
  | "generalChat"
  | "chimmyReply"
  | "globalBroadcast"

export type WorldCupNotificationPreferences = {
  poolMuted: boolean
  inAppEnabled: boolean
  smsEnabled: boolean
  usernameMentionsEnabled: boolean
  allMentionsEnabled: boolean
  commissionerAnnouncementsEnabled: boolean
  deadlineRemindersEnabled: boolean
  bracketFinalizedEnabled: boolean
  resultsUpdatedEnabled: boolean
  leaderboardUpdatedEnabled: boolean
  generalChatEnabled: boolean
  chimmyRepliesEnabled: boolean
  globalBroadcastEnabled: boolean
}

export type WorldCupNotificationPreferenceResolution = {
  userId: string
  preferences: WorldCupNotificationPreferences
  phone: string | null
  phoneVerified: boolean
  /** A live SMS opt-in for `phone` — see lib/sms/smsConsent. */
  smsConsented: boolean
  /** The account-level quiet hours and timezone, so World Cup texts keep the same night as every other text. */
  quietHours: QuietHoursPreference | null
  timezone: string | null
}

export const DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES: WorldCupNotificationPreferences = {
  poolMuted: false,
  inAppEnabled: true,
  smsEnabled: false,
  usernameMentionsEnabled: true,
  allMentionsEnabled: true,
  commissionerAnnouncementsEnabled: true,
  deadlineRemindersEnabled: true,
  bracketFinalizedEnabled: true,
  resultsUpdatedEnabled: true,
  leaderboardUpdatedEnabled: true,
  generalChatEnabled: false,
  chimmyRepliesEnabled: true,
  globalBroadcastEnabled: true,
}

const TYPE_TO_FLAG: Record<WorldCupNotificationType, keyof WorldCupNotificationPreferences> = {
  usernameMention: "usernameMentionsEnabled",
  allMention: "allMentionsEnabled",
  commissionerAnnouncement: "commissionerAnnouncementsEnabled",
  deadlineReminder: "deadlineRemindersEnabled",
  bracketFinalized: "bracketFinalizedEnabled",
  resultsUpdated: "resultsUpdatedEnabled",
  leaderboardUpdated: "leaderboardUpdatedEnabled",
  generalChat: "generalChatEnabled",
  chimmyReply: "chimmyRepliesEnabled",
  globalBroadcast: "globalBroadcastEnabled",
}

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function preferenceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function serializeWorldCupNotificationPreferences(
  current: unknown,
  challengeId: string,
  preferences: Partial<WorldCupNotificationPreferences>
) {
  const root = preferenceObject(current)
  const worldCupRoot = preferenceObject(root.worldCup)
  const pools = preferenceObject(worldCupRoot.pools)
  const existingPool = preferenceObject(pools[challengeId])

  return {
    ...root,
    worldCup: {
      ...worldCupRoot,
      pools: {
        ...pools,
        [challengeId]: {
          ...existingPool,
          ...preferences,
        },
      },
    },
  }
}

export function resolveWorldCupNotificationPreferences(
  saved: unknown,
  challengeId?: string | null
): WorldCupNotificationPreferences {
  const root = preferenceObject(saved)
  const worldCupRoot = preferenceObject(root.worldCup)
  const pools = preferenceObject(worldCupRoot.pools)
  const poolSpecific = challengeId ? preferenceObject(pools[challengeId]) : {}
  const merged = {
    ...worldCupRoot,
    ...poolSpecific,
  }

  return {
    poolMuted: booleanOrDefault(merged.poolMuted, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.poolMuted),
    inAppEnabled: booleanOrDefault(merged.inAppEnabled, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.inAppEnabled),
    smsEnabled: booleanOrDefault(merged.smsEnabled, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.smsEnabled),
    usernameMentionsEnabled: booleanOrDefault(merged.usernameMentionsEnabled, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.usernameMentionsEnabled),
    allMentionsEnabled: booleanOrDefault(merged.allMentionsEnabled, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.allMentionsEnabled),
    commissionerAnnouncementsEnabled: booleanOrDefault(merged.commissionerAnnouncementsEnabled, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.commissionerAnnouncementsEnabled),
    deadlineRemindersEnabled: booleanOrDefault(merged.deadlineRemindersEnabled, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.deadlineRemindersEnabled),
    bracketFinalizedEnabled: booleanOrDefault(merged.bracketFinalizedEnabled, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.bracketFinalizedEnabled),
    resultsUpdatedEnabled: booleanOrDefault(merged.resultsUpdatedEnabled, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.resultsUpdatedEnabled),
    leaderboardUpdatedEnabled: booleanOrDefault(merged.leaderboardUpdatedEnabled, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.leaderboardUpdatedEnabled),
    generalChatEnabled: booleanOrDefault(merged.generalChatEnabled, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.generalChatEnabled),
    chimmyRepliesEnabled: booleanOrDefault(merged.chimmyRepliesEnabled, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.chimmyRepliesEnabled),
    globalBroadcastEnabled: booleanOrDefault(merged.globalBroadcastEnabled, DEFAULT_WORLD_CUP_NOTIFICATION_PREFERENCES.globalBroadcastEnabled),
  }
}

export function isWorldCupNotificationTypeEnabled(
  preferences: WorldCupNotificationPreferences,
  type: WorldCupNotificationType
) {
  return !preferences.poolMuted && Boolean(preferences[TYPE_TO_FLAG[type]])
}

export async function getWorldCupNotificationPreferenceResolution(
  userId: string,
  challengeId?: string | null
): Promise<WorldCupNotificationPreferenceResolution> {
  const profile = await getSettingsProfile(userId)
  const preferences = resolveWorldCupNotificationPreferences(
    profile?.notificationPreferences,
    challengeId
  )

  return {
    userId,
    preferences,
    phone: profile?.phone ?? null,
    phoneVerified: Boolean(profile?.phoneVerifiedAt),
    smsConsented: hasSmsConsent(profile?.notificationPreferences, profile?.phone),
    quietHours:
      resolveNotificationPreferences(profile?.notificationPreferences as NotificationPreferences | null).quietHours ?? null,
    timezone: profile?.timezone ?? null,
  }
}

export async function updateWorldCupNotificationPreferencesForUser(input: {
  userId: string
  challengeId: string
  patch: Partial<WorldCupNotificationPreferences>
}) {
  const profile = await getSettingsProfile(input.userId)
  const nextPreferences = serializeWorldCupNotificationPreferences(
    profile?.notificationPreferences,
    input.challengeId,
    input.patch
  )
  const result = await updateUserProfile(input.userId, {
    notificationPreferences: nextPreferences,
  })
  return {
    ok: result.ok,
    error: result.error,
    preferences: resolveWorldCupNotificationPreferences(nextPreferences, input.challengeId),
  }
}
