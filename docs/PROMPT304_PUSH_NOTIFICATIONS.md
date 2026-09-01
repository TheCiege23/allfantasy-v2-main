# PROMPT 304 — Push Notifications

## Objective

Add **push notifications** (browser web push).

## Send

- **AI alerts** — Notifications for AI insights (category: `ai_alerts`).
- **Chat mentions** — When the user is @mentioned (category: `chat_mentions`).
- **League updates** — Matchup results, lineup reminders, league drama, commissioner alerts (categories: `matchup_results`, `lineup_reminders`, `league_drama`, `commissioner_alerts`).

## Deliverable: Push System

### Implementation

When a notification is dispatched for one of the push-enabled categories, the **NotificationDispatcher** creates the in-app notification (and email/SMS per prefs) and also calls **sendPushToUser** for each recipient. Users receive a browser push only if they have **subscribed** via the push subscription API (opt-in).

### Library: `lib/push-notifications/`

| File | Purpose |
|------|--------|
| **types.ts** | `PushPayload`, `PushSubscriptionRecord`, `PushSubscriptionInput`, `SendPushResult`. |
| **push-service.ts** | `savePushSubscription(userId, input)`, `removePushSubscription(userId, endpoint)`, `getPushSubscriptions(userId)`, `sendPushToUser(userId, payload)`. Uses **web-push** (VAPID) to send; removes expired subscriptions (410/404). |
| **index.ts** | Re-exports; `PUSH_NOTIFICATION_CATEGORIES`, `isPushCategory(category)`. |

### Categories that trigger push

- `ai_alerts`
- `chat_mentions`
- `matchup_results`
- `lineup_reminders`
- `league_drama`
- `commissioner_alerts`

### API

- **POST /api/push/subscribe** (auth) — Body: `{ endpoint, keys: { p256dh, auth }, userAgent? }`. Saves or updates subscription for the current user.
- **POST /api/push/unsubscribe** (auth) — Body: `{ endpoint }`. Removes subscription.
- **GET /api/push/vapid-public-key** — Returns `{ publicKey }` (no auth). Used by the client to subscribe.

### Client

> 🛑 **THIS SECTION NAMED TWO FILES THAT NO LONGER EXIST.** It described
> `public/sw-push.js` and `hooks/usePushSubscription.ts` as the live client, and both
> were deleted on 2026-09-01. They were dead code with zero importers, and the hook
> registered a **second** service worker at scope `/` that would have fought `/sw.js`
> for it. Left uncorrected this page is how someone recreates them.

- **Service worker**: `public/sw.js` — the only one, registered by
  `components/shell/SafeGlobalChrome.tsx`. Handles `push` and `notificationclick`, and
  reads `payload.url` (the sender emits **both** `href` and `url`; see below).
- **Hook**: `lib/push-notifications/useWebPushSubscription.ts` — requests permission,
  waits for the worker SafeGlobalChrome registered rather than registering its own,
  subscribes with the VAPID key, POSTs to `/api/push/subscribe`, and rolls the browser
  subscription back if the server rejects it. Handles the iOS home-screen precondition
  and the sticky-denied case.
- **The one UI that asks**: `components/notifications/EnableWebPushCard.tsx`, rendered
  on `/core/notifications`, on `ImportDone`, and in Settings → Notifications. It is the
  only caller of `Notification.requestPermission()` in the codebase and
  `__tests__/push-optin-reachable.test.ts` enforces that.

⚠ **The subscription table stays empty unless something ASKS.** Every server-side piece
here was complete and scheduled for months while `EnableWebPushCard` was rendered in
exactly one place a phone could not reach, so push delivered to nobody. A working
pipeline is not the same as a reachable opt-in.

### Database

- **WebPushSubscription** — `userId`, `endpoint` (unique), `p256dh`, `auth`, `userAgent?`, `createdAt`. Relation to `AppUser`. Run `prisma migrate dev` (or `db:push`) after adding the model.

### Dependencies

- **web-push** (npm) — Sends push messages using VAPID keys.
- **Env**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (generate with `npx web-push generate-vapid-keys`). Optional: `VAPID_MAILTO` (e.g. `mailto:noreply@allfantasy.ai`).

### Flow

1. User clicks **Enable** on `EnableWebPushCard` → `useWebPushSubscription` calls
   `Notification.requestPermission()`, waits for the already-registered `/sw.js`,
   subscribes with the VAPID public key, and POSTs the subscription to
   `/api/push/subscribe`. It never registers a worker of its own.
2. When the app dispatches a notification for an AI alert, chat mention, or league update, it calls `sendPushToUser(userId, { title, body, href, tag })`.
3. Backend loads all `WebPushSubscription` rows for that user and sends each with **web-push**; payload includes `href` so the service worker can open the app on click.

## Summary

- **Push system** adds browser web push for AI alerts, chat mentions, and league updates.
- **Opt-in**: Users must subscribe via the push API; then any notification in the push categories is also sent as a push.
- **Stack**: web-push (VAPID), Prisma `WebPushSubscription`, dispatcher integration,
  `/api/push/*`, `public/sw.js`, and the `useWebPushSubscription` hook behind
  `EnableWebPushCard`.
- **Off production you need `NEXT_PUBLIC_ENABLE_PWA_SW=1`.** `shouldRegisterServiceWorker()`
  returns false outside production without it, so there is no worker, so the hook's
  bounded wait times out and reports "the background service worker did not start" —
  which reads as broken code rather than a missing flag.
