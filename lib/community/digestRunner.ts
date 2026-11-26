import 'server-only'
import { prisma } from '@/lib/prisma'
import { getResendClient } from '@/lib/resend-client'
import { createEmailUnsubscribeToken } from '@/lib/email/marketing-email'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'
import { createPlatformNotification } from '@/lib/platform/notification-service'
import { isUndeliverableEmailDomain } from '@/lib/email/undeliverableDomains'
import { getChannel } from './channels'
import { IDEA_KIND, parseIdeaDetails } from './ideas'
import { buildDigestEmail, digestHasNews, digestWeekKey, inDigestWindow, type DigestWeek } from './digest'
import { CommunityError, type CommunityViewer } from './service'

/**
 * Sends the weekly Clubhouse email to members who turned it on. Runs on the import-news cron
 * (no new cron slot); outside its Monday–Tuesday window it does one date check and returns.
 *
 * Each recipient is sent at most once per week: the in-app notification written with
 * `community:digest:<week>:<userId>` is the ledger, read before the email goes out.
 */

const PER_RUN = 150
const DAY_MS = 24 * 60 * 60 * 1000

export async function gatherDigestWeek(now: Date): Promise<DigestWeek> {
  const since = new Date(now.getTime() - 7 * DAY_MS)
  const author = { select: { username: true, displayName: true } } as const
  const name = (a: { username: string; displayName: string | null }) => a.displayName || `@${a.username}`
  const [ideas, moves, threads, memberPosts] = await Promise.all([
    prisma.communityPost.findMany({
      where: { kind: IDEA_KIND, removedAt: null, createdAt: { gte: since } },
      orderBy: { upvoteCount: 'desc' },
      take: 5,
      select: { id: true, title: true, ideaDetails: true, upvoteCount: true, author },
    }),
    prisma.communityPost.findMany({
      where: { kind: IDEA_KIND, removedAt: null, ideaStatus: { in: ['building', 'shipped'] }, ideaStatusAt: { gte: since } },
      orderBy: { ideaStatusAt: 'desc' },
      take: 5,
      select: { id: true, title: true, ideaStatus: true, author },
    }),
    prisma.communityPost.findMany({
      where: { removedAt: null, kind: 'post', lastActivityAt: { gte: since }, replyCount: { gt: 0 } },
      orderBy: { replyCount: 'desc' },
      take: 3,
      select: { id: true, title: true, replyCount: true, channel: true },
    }),
    prisma.communityPost.count({ where: { removedAt: null, systemKey: null, createdAt: { gte: since } } }),
  ])
  return {
    weekLabel: digestWeekKey(now),
    newIdeas: ideas.map((i) => ({ id: i.id, title: i.title, hook: parseIdeaDetails(i.ideaDetails).hook, upvotes: i.upvoteCount, author: name(i.author) })),
    moves: moves.map((m) => ({ id: m.id, title: m.title, status: m.ideaStatus as 'building' | 'shipped', author: name(m.author) })),
    topThreads: threads.map((t) => ({ id: t.id, title: t.title, replies: t.replyCount, channelLabel: getChannel(t.channel)?.label ?? t.channel })),
    memberPosts,
  }
}

export type DigestRunResult =
  | { status: 'outside-window' }
  | { status: 'no-news'; week: string }
  | { status: 'sent'; week: string; sent: number; skipped: number; failed: number }

export async function runClubhouseDigest(now = new Date()): Promise<DigestRunResult> {
  if (!inDigestWindow(now)) return { status: 'outside-window' }
  const week = digestWeekKey(now)
  const data = await gatherDigestWeek(now)
  if (!digestHasNews(data)) return { status: 'no-news', week }
  if (!process.env.RESEND_API_KEY) return { status: 'sent', week, sent: 0, skipped: 0, failed: 0 }

  const prefs = await prisma.emailPreference.findMany({
    where: { weeklyDigest: true, unsubscribedAt: null },
    select: { email: true },
    take: 5000,
  })
  const emails = prefs.map((p) => p.email.toLowerCase()).filter((e) => !isUndeliverableEmailDomain(e))
  if (emails.length === 0) return { status: 'sent', week, sent: 0, skipped: 0, failed: 0 }
  const users = await prisma.appUser.findMany({
    where: { email: { in: emails, mode: 'insensitive' } },
    select: { id: true, email: true },
  })
  const keys = users.map((u) => `community:digest:${week}:${u.id}`)
  const done = new Set(
    (await prisma.platformNotification.findMany({ where: { sourceKey: { in: keys } }, select: { sourceKey: true } })).map((r) => r.sourceKey),
  )
  const due = users.filter((u) => u.email && !done.has(`community:digest:${week}:${u.id}`)).slice(0, PER_RUN)

  const origin = getPublicSiteOrigin()
  const { client, fromEmail } = getResendClient()
  let sent = 0
  let failed = 0
  for (const u of due) {
    const unsubscribeUrl = `${origin}/api/email/unsubscribe?token=${encodeURIComponent(createEmailUnsubscribeToken(u.email!))}`
    const email = buildDigestEmail(data, { origin, unsubscribeUrl })
    try {
      const res = await client.emails.send({
        from: fromEmail,
        to: u.email!,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      })
      if (res.error) {
        failed++
        continue
      }
      sent++
      await createPlatformNotification({
        userId: u.id,
        type: 'community_digest',
        title: email.subject,
        body: 'Your weekly Clubhouse email is in your inbox.',
        meta: { actionHref: '/clubhouse' },
        sourceKey: `community:digest:${week}:${u.id}`,
      })
    } catch {
      failed++
    }
  }
  return { status: 'sent', week, sent, skipped: done.size, failed }
}

// ─── opt-in ──────────────────────────────────────────────────────────────────

export type DigestOptIn = { on: boolean; blockedByUnsubscribe: boolean }

async function viewerEmail(viewer: CommunityViewer): Promise<string> {
  if (!viewer.userId) throw new CommunityError(401, 'Sign in first.')
  const user = await prisma.appUser.findUnique({ where: { id: viewer.userId }, select: { email: true } })
  if (!user?.email) throw new CommunityError(400, 'Add an email address to your account first.')
  return user.email.trim().toLowerCase()
}

export async function getDigestOptIn(viewer: CommunityViewer): Promise<DigestOptIn | null> {
  if (!viewer.userId) return null
  const user = await prisma.appUser.findUnique({ where: { id: viewer.userId }, select: { email: true } })
  if (!user?.email) return null
  const pref = await prisma.emailPreference.findFirst({
    where: { email: { equals: user.email.trim(), mode: 'insensitive' } },
    select: { weeklyDigest: true, unsubscribedAt: true },
  })
  return { on: Boolean(pref?.weeklyDigest && !pref.unsubscribedAt), blockedByUnsubscribe: Boolean(pref?.unsubscribedAt) }
}

/**
 * Turning it on never overrides an unsubscribe from every AllFantasy email: that is resumed in
 * Settings, deliberately, so a single click here cannot quietly restart all of them.
 */
export async function setDigestOptIn(viewer: CommunityViewer, on: boolean): Promise<DigestOptIn> {
  const email = await viewerEmail(viewer)
  const existing = await prisma.emailPreference.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, unsubscribedAt: true },
  })
  if (on && existing?.unsubscribedAt) {
    throw new CommunityError(409, 'You unsubscribed from AllFantasy emails. Turn emails back on in Settings first.')
  }
  if (existing) await prisma.emailPreference.update({ where: { id: existing.id }, data: { weeklyDigest: on } })
  else await prisma.emailPreference.create({ data: { email, weeklyDigest: on } })
  return { on, blockedByUnsubscribe: false }
}
