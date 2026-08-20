/**
 * Push notification service — store subscriptions, send via web-push (VAPID).
 */

import "server-only"
import webpush from "web-push"
import { prisma } from "@/lib/prisma"
import { getBaseUrl } from "@/lib/get-base-url"
import type { PushSubscriptionInput, PushPayload, SendPushResult } from "./types"

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

  // Emit BOTH `href` and `url`. public/sw.js — the service worker actually registered by
  // SafeGlobalChrome — reads `payload.url` and falls back to `/app`; public/sw-push.js reads
  // `href` and is never registered. Sending only `href` meant every notification clicked
  // through to `/app` rather than its target. Emitting both also survives a stale service
  // worker on a user's device, which is the normal case after a deploy.
  const payloadStr = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    href,
    url: href,
    tag: payload.tag ?? undefined,
    type: payload.type ?? "notification",
    leagueId: payload.leagueId ?? null,
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
  payload: PushPayload
): Promise<SendPushResult[]> {
  const subs = await getPushSubscriptions(userId)
  if (subs.length === 0) return []

  try {
    ensureVapid()
  } catch {
    return subs.map(() => ({ ok: false, error: "VAPID not configured" }))
  }

  const results: SendPushResult[] = []
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
