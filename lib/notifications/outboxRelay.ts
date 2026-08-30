/**
 * NOTIFICATION OUTBOX RELAY — the delivery half of `notification_outbox`.
 *
 * WHY THIS EXISTS
 * `lib/automation/notifications.ts` has said this since it was written:
 *
 *     "Phase 1 — persist-only outbox. Twilio / Resend dispatch reads from this table in a later
 *      worker."
 *
 * That worker was never built. The table has been write-only for its entire life: measured
 * 2026-08-30, production held 4 rows, every one `status: 'pending'` with `attemptCount: 0` and the
 * newest dated 2026-06-21. Zero attempts is the tell — nothing had ever *tried* and failed, so
 * this was never a delivery bug, it was an absent consumer.
 *
 * The only thing in the repo named like a relay is `app/api/e2e/run-relay`, which is test-gated and
 * drains a DIFFERENT table — `lib/events/outboxStore.ts` reads `eventOutbox`/`domainEvent`, the
 * domain-event outbox. Grepping for "relay" finds it and looks like coverage. It is not.
 *
 * ⚠ WHAT THIS BLOCKS IF IT STOPS. `processLeagueWaiversJob` enqueues here — claim won, claim lost,
 * and the league-chat announcement. The waivers cron fires every 5 minutes and starts doing real
 * work in week 1, so a dead relay means every manager silently learns nothing about their claims.
 *
 * DESIGN NOTES, each one a failure this repo has already had:
 *
 *   CLAIM BEFORE SEND. Rows are moved `pending -> sending` with a conditional `updateMany` before
 *   anything is dispatched. Two overlapping runs (the fast tier can be superseded mid-window)
 *   would otherwise both read the same pending row and send twice. The update's own count is the
 *   claim receipt; we only process what we actually claimed.
 *
 *   NEVER SWALLOW A SEND FAILURE INTO A SUCCESS. A channel that cannot be delivered is written
 *   `failed` with `lastError` populated, not quietly dropped. `sms` has no configured provider, so
 *   it fails loudly with a reason rather than being skipped.
 *
 *   `sentAt` IS THE FRESHNESS PROBE. `scripts/cron-freshness-check.mjs` probes this job on
 *   `max(sentAt)`. A queue that is written but never drained is exactly the silent failure the
 *   monitor exists to catch, and it had no probe.
 */
import { prisma } from "@/lib/prisma"
import { sendNotificationEmail } from "@/lib/resend-client"
import { sendPushToUser } from "@/lib/push-notifications/push-service"

/** Terminal-ish states this relay writes back. `pending` means "retry on the next pass". */
export type RelayRowOutcome = "sent" | "retry" | "failed" | "skipped"

export type RelayResult = {
  claimed: number
  sent: number
  retried: number
  failed: number
  skipped: number
  byChannel: Record<string, { sent: number; failed: number; retried: number; skipped: number }>
  errors: string[]
}

export type RelayOptions = {
  /** Hard cap per invocation. Keeps a backlog from blowing the route's maxDuration. */
  limit?: number
  now?: Date
  /** Claim and report without dispatching. Used by the route's `?dryRun=1`. */
  dryRun?: boolean
}

type OutboxRow = {
  id: string
  leagueId: string | null
  userId: string | null
  channel: string
  eventType: string
  title: string
  body: string
  attemptCount: number
  maxAttempts: number
  metadata: unknown
}

function emptyChannelTally() {
  return { sent: 0, failed: 0, retried: 0, skipped: 0 }
}

function actionHrefFrom(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined
  const href = (metadata as Record<string, unknown>).actionHref
  return typeof href === "string" && href.trim() ? href.trim() : undefined
}

function actionLabelFrom(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined
  const label = (metadata as Record<string, unknown>).actionLabel
  return typeof label === "string" && label.trim() ? label.trim() : undefined
}

/**
 * Deliver one row. Returns the outcome plus an error string when there is one.
 *
 * A `skipped` outcome means the row can never be delivered as addressed — an email with no
 * recipient, a league-chat post for a league that no longer exists. Those are recorded as `failed`
 * by the caller with the reason attached, because a row nobody will ever look at again should not
 * sit in `pending` forever pretending it is queued.
 */
async function deliver(row: OutboxRow): Promise<{ outcome: RelayRowOutcome; error?: string }> {
  switch (row.channel) {
    case "email": {
      if (!row.userId) return { outcome: "skipped", error: "email row has no userId" }
      const user = await prisma.appUser.findUnique({
        where: { id: row.userId },
        select: { email: true },
      })
      if (!user?.email) return { outcome: "skipped", error: `no email for user ${row.userId}` }

      const res = await sendNotificationEmail({
        to: user.email,
        subject: row.title,
        bodyHtml: row.body,
        actionHref: actionHrefFrom(row.metadata),
        actionLabel: actionLabelFrom(row.metadata),
      })
      return res.ok ? { outcome: "sent" } : { outcome: "retry", error: res.error ?? "send failed" }
    }

    case "push": {
      if (!row.userId) return { outcome: "skipped", error: "push row has no userId" }
      const results = await sendPushToUser(row.userId, {
        title: row.title,
        body: row.body,
        href: actionHrefFrom(row.metadata),
        type: row.eventType,
        leagueId: row.leagueId,
      })
      /*
       * No subscriptions is a legitimate end state, not a failure: the user has simply never
       * granted push. Retrying it every five minutes until maxAttempts would burn the queue on
       * users who will never receive push at all.
       */
      if (results.length === 0) return { outcome: "skipped", error: "no push subscriptions" }
      if (results.some((r) => r.ok)) return { outcome: "sent" }
      return {
        outcome: "retry",
        error: results[0]?.error ?? "all push endpoints failed",
      }
    }

    case "in_app": {
      if (!row.userId) return { outcome: "skipped", error: "in_app row has no userId" }
      await prisma.platformNotification.create({
        data: {
          userId: row.userId,
          leagueId: row.leagueId,
          type: row.eventType,
          title: row.title,
          body: row.body,
          meta: (row.metadata ?? undefined) as never,
        },
      })
      return { outcome: "sent" }
    }

    case "league_chat": {
      if (!row.leagueId) return { outcome: "skipped", error: "league_chat row has no leagueId" }
      /*
       * `LeagueChatMessage.userId` is required and FKs to AppUser, so a system post needs a real
       * author. The league owner is the established stand-in — `lib/league/faqGenerator.ts` posts
       * announcements the same way, tagged in metadata rather than by a synthetic user.
       */
      const league = await prisma.league.findUnique({
        where: { id: row.leagueId },
        select: { userId: true },
      })
      if (!league?.userId) {
        return { outcome: "skipped", error: `league ${row.leagueId} has no owner to post as` }
      }
      await prisma.leagueChatMessage.create({
        data: {
          leagueId: row.leagueId,
          userId: league.userId,
          message: row.body,
          type: "host_announcement",
          metadata: {
            senderIsHost: true,
            contentType: "automation_notification",
            eventType: row.eventType,
            title: row.title,
            outboxId: row.id,
          },
        },
      })
      return { outcome: "sent" }
    }

    case "sms":
      /* No SMS provider is wired. Fail with the reason rather than dropping the row — a channel
       * nobody implemented should be visible in `lastError`, not invisible in `pending`. */
      return { outcome: "skipped", error: "sms channel has no configured provider" }

    default:
      return { outcome: "skipped", error: `unknown channel '${row.channel}'` }
  }
}

/**
 * Drain one batch of the notification outbox.
 *
 * Safe to call concurrently: the claim step is a conditional `updateMany`, so a row can only be
 * taken by one caller.
 */
export async function relayNotificationOutbox(options: RelayOptions = {}): Promise<RelayResult> {
  const now = options.now ?? new Date()
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500))

  const result: RelayResult = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    byChannel: {},
    errors: [],
  }

  const due = await prisma.notificationOutbox.findMany({
    where: {
      status: "pending",
      OR: [{ sendAfter: null }, { sendAfter: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  })
  if (due.length === 0) return result

  const ids = due.map((r) => r.id)

  if (options.dryRun) {
    result.claimed = ids.length
    return result
  }

  /* THE CLAIM. `status: "pending"` in the where clause is what makes this safe under concurrency —
   * a row already taken by another run no longer matches and is not re-sent. */
  const claim = await prisma.notificationOutbox.updateMany({
    where: { id: { in: ids }, status: "pending" },
    data: { status: "sending", updatedAt: now },
  })
  if (claim.count === 0) return result

  const rows = (await prisma.notificationOutbox.findMany({
    where: { id: { in: ids }, status: "sending" },
    select: {
      id: true,
      leagueId: true,
      userId: true,
      channel: true,
      eventType: true,
      title: true,
      body: true,
      attemptCount: true,
      maxAttempts: true,
      metadata: true,
    },
  })) as OutboxRow[]

  result.claimed = rows.length

  for (const row of rows) {
    const tally = (result.byChannel[row.channel] ??= emptyChannelTally())
    const attempt = row.attemptCount + 1

    let outcome: RelayRowOutcome
    let error: string | undefined
    try {
      const d = await deliver(row)
      outcome = d.outcome
      error = d.error
    } catch (e) {
      outcome = "retry"
      error = e instanceof Error ? e.message : String(e)
    }

    if (outcome === "sent") {
      await prisma.notificationOutbox.update({
        where: { id: row.id },
        data: { status: "sent", sentAt: new Date(), attemptCount: attempt, lastError: null },
      })
      result.sent += 1
      tally.sent += 1
      continue
    }

    if (outcome === "skipped") {
      /* Undeliverable as addressed. Terminal — see the note on `deliver`. */
      await prisma.notificationOutbox.update({
        where: { id: row.id },
        data: { status: "failed", attemptCount: attempt, lastError: (error ?? "skipped").slice(0, 500) },
      })
      result.skipped += 1
      tally.skipped += 1
      if (error) result.errors.push(`${row.channel}/${row.id}: ${error}`)
      continue
    }

    // Transient. Back to pending until maxAttempts is spent, then terminal.
    const exhausted = attempt >= row.maxAttempts
    await prisma.notificationOutbox.update({
      where: { id: row.id },
      data: {
        status: exhausted ? "failed" : "pending",
        attemptCount: attempt,
        lastError: (error ?? "unknown error").slice(0, 500),
      },
    })
    if (exhausted) {
      result.failed += 1
      tally.failed += 1
    } else {
      result.retried += 1
      tally.retried += 1
    }
    if (error) result.errors.push(`${row.channel}/${row.id}: ${error}`)
  }

  return result
}
