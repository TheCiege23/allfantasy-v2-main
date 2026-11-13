export {
  recordEngagementEvent,
  getActivitySummary,
  getEngagementStreak,
} from "./UserActivityTracker"
export type { ActivitySummary, EngagementStreakData } from "./UserActivityTracker"

export {
  sendDailyDigest,
  sendLeagueReminder,
  sendAIInsight,
  sendWeeklyRecap,
} from "./EngagementNotificationService"

export {
  buildWeeklyRecap,
  generateAndSendWeeklyRecap,
} from "./WeeklyRecapGenerator"

export type {
  EngagementEventType,
  EngagementEventMeta,
  EngagementNotificationType,
  WeeklyRecapPayload,
} from "./types"
