/**
 * Push Notifications (PROMPT 304).
 * Web push for AI alerts, chat mentions, league updates.
 */

export * from "./types"
export {
  savePushSubscription,
  removePushSubscription,
  getPushSubscriptions,
  sendPushToUser,
} from "./push-service"

/* The category list lives in ./categories so the settings screen can import it without the sender. */
export {
  PUSH_NOTIFICATION_CATEGORIES,
  isPushCategory,
  type PushNotificationCategory,
} from "./categories"
