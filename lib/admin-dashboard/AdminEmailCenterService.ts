import "server-only"

import crypto from "crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { isUndeliverableEmailDomain } from "@/lib/email/undeliverableDomains"
import { maskAdminEmail } from "@/lib/admin-dashboard/format"
import { sendMarketingEmail } from "@/lib/email/marketing-email"

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"]
const MAX_BROADCAST_RECIPIENTS = 500
const MAX_SENDS_PER_HOUR = 3

export type AdminEmailAudience =
  | "all"
  | "free"
  | "pro"
  | "paying"
  | "token_buyers"
  | "world_cup_users"
  | "world_cup_pool_creators"
  | "world_cup_unfinalized"
  | "waitlist_confirmed"
  | "waitlist_all"

export type AdminEmailStatus = {
  configured: boolean
  missingEnv: string[]
  senderConfigured: boolean
  totalUsersWithEmail: number
  productUpdateOptOuts: number
  unsubscribed: number
  pendingEmailOutbox: number
  recentBroadcasts: number
  recentProviderFailures: number
  lastSendAt: string | null
  lastError: string | null
  audiences: Array<{ id: AdminEmailAudience; label: string; description: string }>
}

export type AdminEmailRecipient = {
  /*
   * Null for waitlist recipients: they asked to hear from us but never created
   * an account, so there is no AppUser to point at. NotificationOutbox.userId is
   * nullable, so the send still logs -- it just logs without an owner.
   */
  userId: string | null
  email: string
  username: string | null
}

export type AdminEmailAudiencePreview = {
  audience: AdminEmailAudience
  recipientCount: number
  cappedAt: number
  sample: Array<{ username: string | null; emailMasked: string }>
  excludedOptOuts: number
}

export type AdminEmailSendResult = {
  ok: boolean
  mode: "preview" | "test" | "send"
  message: string
  preview: AdminEmailAudiencePreview
  sent: number
  failed: number
  broadcastId?: string
}

export const EMAIL_AUDIENCES: AdminEmailStatus["audiences"] = [
  { id: "all", label: "All signed-up users", description: "All AppUser rows with an email, excluding opt-outs." },
  /*
   * The waitlist lives in EarlyAccessSignup, NOT AppUser -- these are people who
   * asked to hear from us and never became users, so "all" never reached them.
   * 164 real addresses as of 2026-08-18.
   *
   * CONFIRMED AND EVERYONE ARE SEPARATE AUDIENCES ON PURPOSE, and it is not a
   * nicety. Only 20 of the 164 ever confirmed. Mailing the other 144 is a
   * months-old, unconfirmed list -- the exact pattern that gets a sending domain
   * blocked, which would take down password resets and league invites with it.
   * Anyone picking the wider option should have to pick it deliberately.
   */
  { id: "waitlist_confirmed", label: "Waitlist - confirmed only", description: "Early-access signups who confirmed. The safe list: strongest consent signal." },
  { id: "waitlist_all", label: "Waitlist - everyone (incl. unconfirmed)", description: "All early-access signups. Mostly never confirmed - higher bounce and complaint risk." },
  { id: "free", label: "Free users", description: "Users without an active subscription." },
  { id: "pro", label: "AF Pro / subscribed users", description: "Users with an active/trialing/past-due subscription row." },
  { id: "paying", label: "Paying users", description: "Users with subscription or completed payment records." },
  { id: "token_buyers", label: "Token buyers", description: "Users with positive token purchase ledger activity." },
  { id: "world_cup_users", label: "World Cup users", description: "Users with World Cup entries, participants, or owned pools." },
  { id: "world_cup_pool_creators", label: "World Cup pool creators", description: "Users who created World Cup pools." },
  { id: "world_cup_unfinalized", label: "Unfinalized World Cup brackets", description: "Users with incomplete World Cup entries." },
]

function hasEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim())
}

function sanitizeSubject(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 140)
}

function sanitizeBody(value: string): string {
  return value.replace(/\r\n/g, "\n").trim().slice(0, 8000)
}

function broadcastIdFor(input: { audience: string; subject: string; body: string }): string {
  return crypto
    .createHash("sha256")
    .update(`${input.audience}\n${input.subject}\n${input.body}`)
    .digest("hex")
    .slice(0, 24)
}

function audienceWhere(audience: AdminEmailAudience): Prisma.AppUserWhereInput {
  switch (audience) {
    case "free":
      return {
        userSubscriptions: { none: { status: { in: ACTIVE_SUBSCRIPTION_STATUSES } } },
      }
    case "pro":
      return {
        userSubscriptions: { some: { status: { in: ACTIVE_SUBSCRIPTION_STATUSES } } },
      }
    case "paying":
      return {
        OR: [
          { userSubscriptions: { some: { status: { in: ACTIVE_SUBSCRIPTION_STATUSES } } } },
          { bracketPayments: { some: { status: { in: ["completed", "paid", "succeeded"] } } } },
        ],
      }
    case "token_buyers":
      return {
        tokenLedgerEntries: { some: { tokenDelta: { gt: 0 }, entryType: { contains: "purchase", mode: "insensitive" } } },
      }
    case "world_cup_users":
      return {
        OR: [
          { worldCupBracketEntries: { some: {} } },
          { worldCupBracketParticipants: { some: {} } },
          { worldCupBracketChallengesOwned: { some: {} } },
        ],
      }
    case "world_cup_pool_creators":
      return { worldCupBracketChallengesOwned: { some: {} } }
    case "world_cup_unfinalized":
      return {
        worldCupBracketEntries: {
          some: {
            isComplete: false,
            submittedAt: null,
          },
        },
      }
    case "all":
    default:
      return {}
  }
}

async function optOutEmailSet(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set()
  const rows = await prisma.emailPreference.findMany({
    where: {
      email: { in: emails },
      OR: [{ productUpdates: false }, { unsubscribedAt: { not: null } }],
    },
    select: { email: true },
  })
  return new Set(rows.map((row) => row.email.toLowerCase()))
}

export async function getEmailCenterStatus(): Promise<AdminEmailStatus> {
  const [totalUsersWithEmail, productUpdateOptOuts, unsubscribed, pendingEmailOutbox, recentBroadcasts, failures, lastEmail] =
    await Promise.all([
      prisma.appUser.count({ where: { email: { contains: "@" } } }),
      prisma.emailPreference.count({ where: { productUpdates: false } }),
      prisma.emailPreference.count({ where: { unsubscribedAt: { not: null } } }),
      prisma.notificationOutbox.count({ where: { channel: "email", status: "pending" } }),
      prisma.notificationOutbox.count({
        where: {
          channel: "email",
          eventType: "admin_marketing_broadcast",
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
      }),
      prisma.resendEmailEvent.findMany({
        where: { eventType: { in: ["email.bounced", "email.complained", "email.failed", "email.delivery_delayed"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
      }),
      prisma.notificationOutbox.findFirst({
        where: { channel: "email" },
        orderBy: [{ sentAt: "desc" }, { updatedAt: "desc" }],
        select: { sentAt: true, updatedAt: true, lastError: true },
      }),
    ])

  const missingEnv = [
    !hasEnv("RESEND_API_KEY") ? "RESEND_API_KEY" : null,
    !(hasEnv("RESEND_FROM") || hasEnv("RESEND_FROM_EMAIL") || hasEnv("EMAIL_FROM")) ? "RESEND_FROM or RESEND_FROM_EMAIL" : null,
  ].filter((item): item is string => Boolean(item))

  return {
    configured: missingEnv.length === 0,
    missingEnv,
    senderConfigured: hasEnv("RESEND_FROM") || hasEnv("RESEND_FROM_EMAIL") || hasEnv("EMAIL_FROM"),
    totalUsersWithEmail,
    productUpdateOptOuts,
    unsubscribed,
    pendingEmailOutbox,
    recentBroadcasts,
    recentProviderFailures: failures.length,
    lastSendAt: (lastEmail?.sentAt ?? lastEmail?.updatedAt)?.toISOString() ?? null,
    lastError: lastEmail?.lastError?.slice(0, 180) ?? null,
    audiences: EMAIL_AUDIENCES,
  }
}

/**
 * Waitlist audiences resolve against EarlyAccessSignup instead of AppUser.
 *
 * These people have no account, so there is no `userId` to attach -- the
 * recipient carries a null id and the signup name as its display name.
 *
 * Reserved-domain addresses are excluded here as well as at write time. The 114
 * test rows were purged on 2026-08-18 and all three writers are now guarded, but
 * a send is irreversible and this costs one predicate.
 */
async function waitlistRecipients(
  audience: "waitlist_all" | "waitlist_confirmed",
  limit: number
): Promise<AdminEmailRecipient[]> {
  const rows = await prisma.earlyAccessSignup.findMany({
    where: {
      email: { contains: "@" },
      ...(audience === "waitlist_confirmed" ? { confirmedAt: { not: null } } : {}),
    },
    select: { email: true, name: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit * 2, 50), MAX_BROADCAST_RECIPIENTS * 2),
  })
  const deliverable = rows.filter((row) => !isUndeliverableEmailDomain(row.email))
  const optOuts = await optOutEmailSet(deliverable.map((row) => row.email.toLowerCase()))
  return deliverable
    .filter((row) => !optOuts.has(row.email.toLowerCase()))
    .slice(0, limit)
    .map((row) => ({ userId: null, email: row.email, username: row.name ?? null }))
}

export async function previewEmailAudience(
  audience: AdminEmailAudience,
  limit = MAX_BROADCAST_RECIPIENTS
): Promise<{ preview: AdminEmailAudiencePreview; recipients: AdminEmailRecipient[] }> {
  if (audience === "waitlist_all" || audience === "waitlist_confirmed") {
    const recipients = await waitlistRecipients(audience, limit)
    return {
      recipients,
      preview: {
        audience,
        recipientCount: recipients.length,
        cappedAt: limit,
        sample: recipients.slice(0, 8).map((row) => ({
          username: row.username,
          emailMasked: maskAdminEmail(row.email),
        })),
        excludedOptOuts: 0,
      },
    }
  }

  const rows = await prisma.appUser.findMany({
    where: {
      email: { contains: "@" },
      ...audienceWhere(audience),
    },
    select: { id: true, email: true, username: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit * 2, 50), MAX_BROADCAST_RECIPIENTS * 2),
  })
  const emailValues = rows.map((row) => row.email.toLowerCase())
  const optOuts = await optOutEmailSet(emailValues)
  const recipients = rows
    .filter((row) => !optOuts.has(row.email.toLowerCase()))
    .slice(0, limit)
    .map((row) => ({ userId: row.id, email: row.email, username: row.username }))

  return {
    recipients,
    preview: {
      audience,
      recipientCount: recipients.length,
      cappedAt: limit,
      sample: recipients.slice(0, 8).map((row) => ({
        username: row.username,
        emailMasked: maskAdminEmail(row.email),
      })),
      excludedOptOuts: optOuts.size,
    },
  }
}

export async function runAdminEmailAction(input: {
  mode: "preview" | "test" | "send"
  audience: AdminEmailAudience
  subject: string
  body: string
  adminEmail?: string | null
  confirm?: boolean
}): Promise<AdminEmailSendResult> {
  const subject = sanitizeSubject(input.subject)
  const body = sanitizeBody(input.body)
  if (!subject || subject.length < 4) {
    throw new Error("Subject is required.")
  }
  if (!body || body.length < 10) {
    throw new Error("Body is required.")
  }

  const { preview, recipients } = await previewEmailAudience(input.audience)
  if (input.mode === "preview") {
    return { ok: true, mode: "preview", message: "Preview only. No emails sent.", preview, sent: 0, failed: 0 }
  }

  const status = await getEmailCenterStatus()
  if (!status.configured) {
    return {
      ok: false,
      mode: input.mode,
      message: `Email provider missing env: ${status.missingEnv.join(", ")}`,
      preview,
      sent: 0,
      failed: 0,
    }
  }

  if (input.mode === "test") {
    const to = input.adminEmail?.trim()
    if (!to || !to.includes("@")) {
      throw new Error("Admin email is required for test send.")
    }
    const result = await sendMarketingEmail({
      to,
      subject: `[TEST] ${subject}`,
      bodyText: body,
    })
    await prisma.notificationOutbox.create({
      data: {
        channel: "email",
        eventType: "admin_marketing_test",
        title: subject,
        body,
        status: result.ok ? "sent" : "failed",
        sentAt: result.ok ? new Date() : null,
        lastError: result.error?.slice(0, 180) ?? null,
        metadata: {
          adminEmailMasked: maskAdminEmail(to),
          providerMessageId: result.id ?? null,
        },
      },
    })
    return {
      ok: result.ok,
      mode: "test",
      message: result.ok ? "Test email sent to admin." : result.error ?? "Test email failed.",
      preview,
      sent: result.ok ? 1 : 0,
      failed: result.ok ? 0 : 1,
    }
  }

  if (!input.confirm) {
    return {
      ok: false,
      mode: "send",
      message: "Set confirm=true after previewing the recipient count.",
      preview,
      sent: 0,
      failed: 0,
    }
  }
  if (status.recentBroadcasts >= MAX_SENDS_PER_HOUR) {
    return {
      ok: false,
      mode: "send",
      message: "Broadcast rate limit reached. Try again later.",
      preview,
      sent: 0,
      failed: 0,
    }
  }

  const broadcastId = broadcastIdFor({ audience: input.audience, subject, body })
  const duplicate = await prisma.notificationOutbox.findFirst({
    where: {
      channel: "email",
      eventType: "admin_marketing_broadcast",
      title: subject,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true },
  })
  if (duplicate) {
    return {
      ok: false,
      mode: "send",
      message: "A similar broadcast was already created in the last 24 hours.",
      preview,
      sent: 0,
      failed: 0,
      broadcastId,
    }
  }

  let sent = 0
  let failed = 0
  const failures: string[] = []
  for (const recipient of recipients) {
    const result = await sendMarketingEmail({
      to: recipient.email,
      subject,
      bodyText: body,
    })
    if (result.ok) sent += 1
    else {
      failed += 1
      if (result.error && failures.length < 3) failures.push(result.error)
    }
    await prisma.notificationOutbox.create({
      data: {
        userId: recipient.userId,
        channel: "email",
        eventType: "admin_marketing_broadcast",
        title: subject,
        body,
        status: result.ok ? "sent" : "failed",
        sentAt: result.ok ? new Date() : null,
        lastError: result.error?.slice(0, 180) ?? null,
        metadata: {
          broadcastId,
          audience: input.audience,
          providerMessageId: result.id ?? null,
        },
      },
    })
  }

  return {
    ok: failed === 0,
    mode: "send",
    message: failed === 0 ? "Broadcast sent." : `Broadcast finished with ${failed} failures. ${failures.join(" ")}`.slice(0, 240),
    preview,
    sent,
    failed,
    broadcastId,
  }
}
