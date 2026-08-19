import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendNotificationEmail } from '@/lib/resend-client'
import { getCommandCenter, type CommandCenterPayload } from '@/lib/dashboard-intel/commandCenterService'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Morning Briefing — the Command Center payload as a daily email digest:
 * what needs your call (ranked, engine-tagged), this week's win probabilities,
 * and portfolio movers. One email per user per day (SportsDataCache dedupe).
 *
 * Rollout safety: the CRON sweep only runs when MORNING_BRIEFING_ENABLED=1 —
 * mass daily email is opt-in at the deployment level, never a surprise. The
 * MANUAL mode (signed-in GET) always works, so you can send yourself today's
 * briefing to test the format before enabling the fleet.
 */

const SEEN_PREFIX = 'briefing-sent:v1:'
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function todayKey(userId: string): string {
  return `${SEEN_PREFIX}${userId}:${new Date().toISOString().slice(0, 10)}`
}

async function alreadySent(key: string): Promise<boolean> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key } }).catch(() => null)
  return Boolean(row)
}
async function markSent(key: string): Promise<void> {
  const data = { version: 1, sentAt: new Date().toISOString() } as unknown as object
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: key },
      update: { data, expiresAt: new Date(Date.now() + SEEN_TTL_MS) },
      create: { cacheKey: key, data, expiresAt: new Date(Date.now() + SEEN_TTL_MS) },
    })
    .catch(() => null)
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function briefingHtml(center: CommandCenterPayload): string {
  const parts: string[] = []
  if (center.feed.length > 0) {
    parts.push(
      `<b>Needs your call (${center.feed.length}):</b><br>` +
        center.feed
          .slice(0, 6)
          .map((f) => `• <b>${escapeHtml(f.leagueName)}</b> — ${escapeHtml(f.title)} <i>(via ${escapeHtml(f.engine)})</i>`)
          .join('<br>'),
    )
  } else {
    parts.push('<b>All clear</b> — no pending decisions across your leagues this morning.')
  }
  if (center.week.projectedCount > 0) {
    parts.push(
      `<b>Your week:</b> favored in ${center.week.favoredCount} of ${center.week.projectedCount}.<br>` +
        center.week.matchups
          .filter((m) => m.winProb != null)
          .map(
            (m) =>
              `• ${escapeHtml(m.leagueName)}: <b>${m.winProb?.toFixed(0)}%</b> vs ${escapeHtml(m.oppName)}${m.pirate ? ' ☠ (pirate — a loss forfeits a player)' : ''}${m.rivalry ? ` · all-time ${m.rivalry.wins}–${m.rivalry.losses}` : ''}`,
          )
          .join('<br>'),
    )
  }
  if (center.portfolio.leagues.length > 0) {
    const movers = [...center.portfolio.risers.slice(0, 3), ...center.portfolio.fallers.slice(0, 3)]
    parts.push(
      `<b>Portfolio:</b> total roster value ${center.portfolio.totalValue.toLocaleString()} across ${center.portfolio.leagues.length} leagues.` +
        (movers.length > 0
          ? `<br>Movers (30d): ${movers
              .map((m) => `${escapeHtml(m.name)} ${m.trend30Day > 0 ? '+' : ''}${m.trend30Day.toLocaleString()}`)
              .join(', ')}`
          : ''),
    )
  }
  const injured = center.exposure.rows.filter((r) => r.injury)
  if (injured.length > 0) {
    parts.push(
      `<b>Injury exposure:</b> ${injured
        .map((r) => `${escapeHtml(r.name)} (${escapeHtml(r.injury?.status ?? '')}) hits ${r.count} of your leagues`)
        .join('; ')}.`,
    )
  }
  parts.push(
    '<i>Every line above comes from your synced engines — Decision OS, trade grades, draft intel, the matchup model, market values, and Legacy. Open the dashboard for the full deck.</i>',
  )
  return parts.join('<br><br>')
}

function briefingSubject(center: CommandCenterPayload): string {
  const urgent = center.feed.filter((f) => f.severity === 'crit').length
  if (urgent > 0) return `Morning briefing: ${urgent} thing${urgent === 1 ? '' : 's'} need${urgent === 1 ? 's' : ''} your call`
  if (center.week.projectedCount > 0)
    return `Morning briefing: favored in ${center.week.favoredCount} of ${center.week.projectedCount} this week`
  return 'Your AllFantasy morning briefing'
}

async function sendBriefing(userId: string, email: string): Promise<'sent' | 'skipped' | 'failed'> {
  const key = todayKey(userId)
  if (await alreadySent(key)) return 'skipped'
  const center = await getCommandCenter(userId)
  if (!center || center.leaguesScanned === 0) return 'skipped'
  const res = await sendNotificationEmail({
    to: email,
    subject: briefingSubject(center),
    bodyHtml: briefingHtml(center),
    actionHref: '/dashboard',
    actionLabel: 'Open the Command Center',
  }).catch(() => ({ ok: false as const }))
  if (!res.ok) return 'failed'
  await markSent(key)
  return 'sent'
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.CRON_SECRET?.trim()
  const isCron = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`

  if (isCron) {
    if (process.env.MORNING_BRIEFING_ENABLED !== '1') {
      return NextResponse.json({ mode: 'cron' as const, enabled: false, note: 'Set MORNING_BRIEFING_ENABLED=1 to enable the daily sweep.' })
    }
    const owners = await prisma.league.findMany({
      where: { platform: 'sleeper', platformLeagueId: { not: '' } },
      select: { userId: true },
      distinct: ['userId'],
      take: 100,
    })
    const userIds = [...new Set(owners.map((o) => o.userId).filter((v): v is string => Boolean(v)))]
    const users = await prisma.appUser
      .findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
      .catch(() => [] as { id: string; email: string | null }[])
    const sweep = await withSyncJobRun(
      { jobName: 'cron-morning-briefing', trigger: 'cron' },
      async () => {
        let sent = 0
        let failed = 0
        for (const u of users) {
          if (!u.email) continue
          const r = await sendBriefing(u.id, u.email)
          if (r === 'sent') sent += 1
          if (r === 'failed') failed += 1
        }
        return { candidates: users.length, sent, failed }
      },
      (r) => ({
        rowsRead: r.candidates,
        rowsWritten: r.sent,
        errors: r.failed > 0 ? [`${r.failed} briefing email(s) failed to send`] : [],
      }),
    )
    return NextResponse.json({ mode: 'cron' as const, enabled: true, ...sweep })
  }

  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null }
  } | null
  const userId = session?.user?.id
  const email = session?.user?.email
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!email) return NextResponse.json({ error: 'No email on your account' }, { status: 400 })

  const result = await sendBriefing(userId, email)
  return NextResponse.json({ mode: 'manual' as const, result })
}
