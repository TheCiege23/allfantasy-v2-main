/**
 * Push Notifications (PROMPT 304) — types.
 * Web push for AI alerts, chat mentions, league updates.
 */

/**
 * Payload sent to the service worker (shown in browser notification).
 *
 * ⚠ BOTH `href` AND `url` ARE EMITTED, AND THAT IS STILL LOAD-BEARING AFTER THE SECOND
 * WORKER WAS DELETED. There used to be two service workers reading different keys for the
 * click target: `public/sw.js` (the one SafeGlobalChrome actually registers) reads
 * `payload.url`, while `public/sw-push.js` read `payload.href` and was never registered at
 * all. `sw-push.js` is now gone — but the dual emission stays, because a service worker
 * already installed on a user's device is not updated by a deploy. Whatever key the copy on
 * someone's phone reads, it finds one. Sending only `href` once made every notification
 * click through to the `/app` fallback instead of its target; do not "simplify" this back.
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
