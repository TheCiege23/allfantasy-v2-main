/**
 * Push notification service — store subscriptions, send via web-push (VAPID).
 */

import "server-only"
import webpush from "web-push"
import { prisma } from "@/lib/prisma"
import { getBaseUrl } from "@/lib/get-base-url"
import type { PushSubscriptionInput, PushPayload, SendPushResult } from "./types"
import { IOS_ENDPOINT_PREFIX, isIosEndpoint, isValidDeviceToken, sendApns } from "./apns"

let vapidConfigured = false

function ensureVapid() {
  if (vapidConfigured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set for push notifications.")
  }
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO?.trim() || "mailto:noreply@allfantasy.ai",
    publicKey,
    privateKey
  )
  vapidConfigured = true
}

/** Save a push subscription for a user. */
export async function savePushSubscription(
  userId: string,
  input: PushSubscriptionInput
): Promise<{ id: string } | null> {
  try {
    const record = await (prisma as any).webPushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? null,
      },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? null,
      },
      select: { id: true },
    })
    return record
  } catch {
    return null
  }
}

/** Remove a subscription by endpoint. */
export async function removePushSubscription(
  userId: string,
  endpoint: string
): Promise<boolean> {
  try {
    await (prisma as any).webPushSubscription.deleteMany({
      where: { userId, endpoint },
    })
    return true
  } catch {
    return false
  }
}

/** Get all subscriptions for a user. */
export async function getPushSubscriptions(userId: string): Promise<
  { id: string; endpoint: string; p256dh: string; auth: string }[]
> {
  const rows = await (prisma as any).webPushSubscription
    .findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    })
    .catch(() => [])
  return rows
}

/**
 * A notification picture must be absolute https: Apple's extension and a browser both fetch it
 * from the device, with no idea which site sent it. A path on this site is made absolute; any
 * other scheme (http, data:, javascript:) is dropped rather than forwarded — the text still
 * goes out, it just goes out without a picture.
 */
export function absolutePushImageUrl(imageUrl: string | null | undefined): string | null {
  const url = imageUrl?.trim()
  if (!url) return null
  if (url.startsWith("https://")) return url
  if (url.startsWith("/") && !url.startsWith("//")) {
    const base = getBaseUrl().replace(/\/$/, "")
    return base.startsWith("https://") ? `${base}${url}` : null
  }
  return null
}

/** Send push to one subscription (web-push format). */
async function sendToSubscription(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<SendPushResult> {
  ensureVapid()
  const baseUrl = getBaseUrl().replace(/\/$/, "")
  const href = payload.href
    ? (payload.href.startsWith("http") ? payload.href : `${baseUrl}${payload.href}`)
    : baseUrl

  // Emit BOTH `href` and `url`. public/sw.js — the service worker SafeGlobalChrome registers
  // — reads `payload.url` and falls back to `/app`; the never-registered public/sw-push.js
  // read `href` and has since been deleted. Sending only `href` meant every notification
  // clicked through to `/app` rather than its target. The dual emission still matters with
  // one worker left, because a deploy does not update the copy already installed on a
  // user's device: whichever key that copy reads, it finds one.
  const payloadStr = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    href,
    url: href,
    tag: payload.tag ?? undefined,
    type: payload.type ?? "notification",
    leagueId: payload.leagueId ?? null,
    // public/sw.js already passes `payload.image` to showNotification; Android shows it large.
    image: payload.imageUrl ?? undefined,
    // public/sw.js reads `payload.icon` (falling back to the crest): the sender's face on a DM.
    icon: payload.iconUrl ?? undefined,
  })

  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  }

  try {
    await webpush.sendNotification(pushSubscription, payloadStr)
    return { ok: true }
  } catch (e: unknown) {
    const err = e as { statusCode?: number; body?: string }
    if (err.statusCode === 410 || err.statusCode === 404) {
      return { ok: false, error: "Subscription expired" }
    }
    return { ok: false, error: err?.body ?? String(e) }
  }
}

/**
 * Send push notification to all subscriptions for a user.
 * Call from dispatcher when category is ai_alerts, chat_mentions, or league-related.
 */
export async function sendPushToUser(
  userId: string,
  input: PushPayload
): Promise<SendPushResult[]> {
  const all = await getPushSubscriptions(userId)
  if (all.length === 0) return []
  // Resolved once here so the APNs and web-push halves see the same, already-vetted picture.
  const payload: PushPayload = {
    ...input,
    imageUrl: absolutePushImageUrl(input.imageUrl),
    iconUrl: absolutePushImageUrl(input.iconUrl),
  }

  /*
   * iPhones (endpoint `apns:<token>`, registered by the iOS app) go to Apple's push service;
   * browsers go through web-push. Each half depends only on ITS OWN keys — this used to return
   * "VAPID not configured" for every row, which would have silenced iPhones whenever VAPID was
   * unset, and handed an APNs token to web-push otherwise.
   */
  const results: SendPushResult[] = []
  const ios = all.filter((s) => isIosEndpoint(s.endpoint))
  const subs = all.filter((s) => !isIosEndpoint(s.endpoint))

  if (ios.length > 0) {
    const sent = await sendApns(
      ios.map((s) => s.endpoint.slice(IOS_ENDPOINT_PREFIX.length)),
      // iOS has no remote icon slot: a face with no other picture rides the attachment instead.
      { ...payload, imageUrl: payload.imageUrl ?? payload.iconUrl ?? null },
    )
    for (let i = 0; i < ios.length; i += 1) {
      const r = sent[i]
      results.push(r.ok ? { ok: true, subscriptionId: ios[i].id } : { ok: false, error: r.error, subscriptionId: ios[i].id })
      if (!r.ok && r.expired) {
        await (prisma as any).webPushSubscription
          .deleteMany({ where: { endpoint: ios[i].endpoint } })
          .catch(() => undefined)
      }
    }
  }
  if (subs.length === 0) return results

  try {
    ensureVapid()
  } catch {
    return [...results, ...subs.map(() => ({ ok: false, error: "VAPID not configured" }))]
  }

  for (const sub of subs) {
    const result = await sendToSubscription(sub, payload)
    results.push({ ...result, subscriptionId: sub.id })
    if (!result.ok && result.error === "Subscription expired") {
      try {
        await (prisma as any).webPushSubscription.deleteMany({
          where: { endpoint: sub.endpoint },
        })
      } catch {
        // ignore
      }
    }
  }
  return results
}

/*
 * ── The iOS app's device tokens ──────────────────────────────────────────────
 * Stored in web_push_subscriptions beside browser subscriptions: endpoint `apns:<token>`,
 * p256dh/auth empty (APNs has no per-subscription keys), and userAgent `ios-app sid:<sid>` —
 * the login's session id (lib/auth/sessionRevocation), so SIGNING OUT removes exactly that
 * phone and a signed-out phone stops getting someone's notifications.
 */

const iosAgent = (sid: string | null) => (sid ? `ios-app sid:${sid}` : "ios-app")

/** Register (or re-point) an iPhone. A token already held by another user moves to this one. */
export async function saveIosDevice(userId: string, token: string, sid: string | null): Promise<boolean> {
  if (!isValidDeviceToken(token)) return false
  const endpoint = `${IOS_ENDPOINT_PREFIX}${token.toLowerCase()}`
  try {
    await (prisma as any).webPushSubscription.upsert({
      where: { endpoint },
      update: { userId, userAgent: iosAgent(sid) },
      create: { userId, endpoint, p256dh: "", auth: "", userAgent: iosAgent(sid) },
    })
    return true
  } catch {
    return false
  }
}

/** Unregister one iPhone for this user (the app turned notifications off). */
export async function removeIosDevice(userId: string, token: string): Promise<boolean> {
  if (!isValidDeviceToken(token)) return false
  return removePushSubscription(userId, `${IOS_ENDPOINT_PREFIX}${token.toLowerCase()}`)
}

/** Sign-out: the phone that held this session stops receiving this user's notifications. */
export async function removeIosDevicesForSession(sid: string): Promise<number> {
  if (!sid) return 0
  const res = await (prisma as any).webPushSubscription
    .deleteMany({ where: { endpoint: { startsWith: IOS_ENDPOINT_PREFIX }, userAgent: iosAgent(sid) } })
    .catch(() => ({ count: 0 }))
  return res.count
}
