/**
 * Push Notifications (PROMPT 304) — types.
 * Web push for AI alerts, chat mentions, league updates.
 */

/**
 * Payload sent to the service worker (shown in browser notification).
 *
 * KEY-NAME WARNING. Two service workers exist and they read DIFFERENT keys for the click
 * target: `public/sw.js` (the one actually registered, by SafeGlobalChrome) reads
 * `payload.url`, while `public/sw-push.js` reads `payload.href` and is never registered.
 * The sender previously emitted only `href`, so every notification clicked through to the
 * `/app` fallback instead of its intended destination. `sendToSubscription` now emits BOTH
 * keys, which also keeps any already-installed service worker on a user's device working
 * after a deploy — a stale SW is the norm, not the exception, and cannot be assumed updated.
 */
export interface PushPayload {
  title: string
  body?: string
  /** Click opens this URL (absolute or path). Serialized as both `href` and `url`. */
  href?: string
  /** Optional tag to replace same-tag notifications. */
  tag?: string
  /** Notification type for analytics; `sw.js` also uses it to pick action buttons. */
  type?: string
  /** Lets `sw.js` build league-scoped action deep links (trade/draft/score). */
  leagueId?: string | null
}

/** Subscription as stored and as needed by web-push. */
export interface PushSubscriptionRecord {
  id: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string | null
  createdAt: Date
}

/** Client sends this when subscribing (PushSubscription JSON). */
export interface PushSubscriptionInput {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
  userAgent?: string
}

export interface SendPushResult {
  ok: boolean
  subscriptionId?: string
  error?: string
}
