import type { Prisma } from "@prisma/client"

import type { NotificationChannel } from "@/lib/automation/types"
import { prisma } from "@/lib/prisma"

export type EnqueueNotificationInput = {
  leagueId?: string | null
  userId?: string | null
  channel: NotificationChannel | string
  eventType: string
  title: string
  body: string
  sendAfter?: Date | null
  metadata?: Prisma.InputJsonValue
}

/**
 * Phase 1 — persist-only outbox. Twilio / Resend dispatch reads from this table in a later worker.
 * Future waiver FAAB alerts, draft “on the clock”, scoring corrections, and trade outcomes enqueue here.
 */
export async function enqueueNotification(input: EnqueueNotificationInput): Promise<{ id: string }> {
  const row = await prisma.notificationOutbox.create({
    data: {
      leagueId: input.leagueId ?? null,
      userId: input.userId ?? null,
      channel: input.channel,
      eventType: input.eventType,
      title: input.title,
      body: input.body,
      status: "pending",
      sendAfter: input.sendAfter ?? null,
      metadata: input.metadata ?? undefined,
    },
  })
  return { id: row.id }
}

export async function enqueueLeagueChatNotification(input: {
  leagueId: string
  eventType: string
  title: string
  body: string
  metadata?: Prisma.InputJsonValue
}): Promise<{ id: string }> {
  return enqueueNotification({
    leagueId: input.leagueId,
    channel: "league_chat",
    eventType: input.eventType,
    title: input.title,
    body: input.body,
    metadata: input.metadata,
  })
}

export async function enqueueUserNotification(input: {
  userId: string
  channel: NotificationChannel | string
  eventType: string
  title: string
  body: string
  sendAfter?: Date | null
  metadata?: Prisma.InputJsonValue
}): Promise<{ id: string }> {
  return enqueueNotification({
    userId: input.userId,
    channel: input.channel,
    eventType: input.eventType,
    title: input.title,
    body: input.body,
    sendAfter: input.sendAfter ?? null,
    metadata: input.metadata,
  })
}

/**
 * Enqueues a WAIVER_AI_REMINDER for an AF Pro user before the waiver deadline.
 *
 * Delivered via in_app channel only (no Resend/Twilio in this phase).
 * The sendAfter date controls when the notification becomes visible.
 *
 * Future: schedule via Vercel Cron at `0 18 * * 2` (Tue 6pm UTC — configurable per league).
 *
 * @param userId      - AF Pro user to remind
 * @param leagueId    - league the reminder is for
 * @param sendBefore  - waiver deadline; notification enqueued sendBefore - buffer (or immediately if null)
 */
export async function enqueueWaiverAiReminder(input: {
  userId: string
  leagueId: string
  sendBefore?: Date | null
  metadata?: Prisma.InputJsonValue
}): Promise<{ id: string }> {
  const sendAfter = input.sendBefore
    ? new Date(input.sendBefore.getTime() - 2 * 60 * 60 * 1000) // 2h before deadline
    : null

  return enqueueNotification({
    userId: input.userId,
    leagueId: input.leagueId,
    channel: "in_app",
    eventType: "WAIVER_AI_REMINDER",
    title: "Waiver deadline approaching",
    body: "Your Chimmy waiver recommendations are ready. Check your top targets before the deadline.",
    sendAfter,
    metadata: input.metadata,
  })
}
