import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from './NotificationDispatcher'
import { renderDigestEmail } from './designedEmail'
import { escapeHtml } from '@/lib/trade-intel/tradeGradeEmail'
import { getBaseUrl } from '@/lib/get-base-url'
import type { RunBudget } from '@/lib/cron/runBudget'

/**
 * The daily "Roster news" email — ONE email per person per day in place of one per story (owner's
 * call, 2026-10-22, after 59 player-news emails in a day). Every player-news sender now writes the
 * bell row with `meta.playerNews` (lib/notifications/playerNewsGate) and never emails; this collects
 * those rows once a day, grouped by league and then starters first, team by team.
 *
 * WHEN. The first run at or after DIGEST_LOCAL_HOUR in the person's own timezone (profile timezone,
 * else US Eastern). Driven from /api/cron/import-news, which already runs every 15 minutes — no new
 * cron. Claimed per person and local day before sending, so overlapping runs cannot double-send.
 *
 * WHAT. Everything since the last digest (or the last 24 hours on the first one). Nothing new → no
 * email. The email itself goes through the dispatcher under `injury_alerts`, so the person's email
 * switch, unsubscribe and quiet hours all still apply.
 */

export const DIGEST_LOCAL_HOUR = 8
const CLAIM_TTL_MS = 3 * 86_400_000
const MAX_ITEMS = 60

export type DigestItem = {
  leagueId: string | null
  leagueName: string | null
  playerName: string
  team: string | null
  position: string | null
  status: string | null
  starter: boolean
  headline: string
  createdAt: Date
}

function localParts(now: Date, timeZone: string): { day: string; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now)
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
    return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
  } catch {
    return localParts(now, 'America/New_York')
  }
}

/** Pure: is it time for this person's digest? */
export function digestDue(now: Date, timeZone: string | null | undefined): { due: boolean; day: string } {
  const { day, hour } = localParts(now, timeZone || 'America/New_York')
  return { due: hour >= DIGEST_LOCAL_HOUR, day }
}

/** Pure: the email, grouped league → starters first → team. */
export function renderPlayerNewsDigest(items: DigestItem[], baseUrl: string): { subject: string; html: string; body: string } {
  const byLeague = new Map<string, DigestItem[]>()
  for (const it of items) {
    const key = it.leagueName ?? 'Players you follow'
    byLeague.set(key, [...(byLeague.get(key) ?? []), it])
  }
  const starters = items.filter(i => i.starter).length
  const subject = `Roster news: ${items.length} update${items.length === 1 ? '' : 's'}${starters ? ` · ${starters} about your starters` : ''}`
  const blocks = [...byLeague.entries()].map(([league, rows]) => {
    rows.sort((a, b) => Number(b.starter) - Number(a.starter) || String(a.team ?? '').localeCompare(String(b.team ?? '')) || a.playerName.localeCompare(b.playerName))
    const lines = rows.map(r => {
      const tag = [r.position, r.team].filter(Boolean).join(' · ')
      return `<div style="margin:0 0 8px 0;color:#d4d4d8">${r.starter ? '⭐ ' : '• '}<strong style="color:#ffffff">${escapeHtml(r.playerName)}</strong>${tag ? ` <span style="color:#a1a1aa">(${escapeHtml(tag)})</span>` : ''} — ${escapeHtml(r.headline)}</div>`
    }).join('')
    return `<div style="margin:0 0 16px 0"><div style="font-size:15px;font-weight:800;color:#ffffff;margin:0 0 6px 0">${escapeHtml(league)}</div>${lines}</div>`
  }).join('')
  const html = renderDigestEmail({
    eyebrow: 'AllFantasy · Roster news',
    title: subject,
    sub: '⭐ marks a player in your starting lineup. Starters already got a push when it happened; everything else waited for this email.',
    bodyHtml: blocks,
    cta: { href: `${baseUrl}/core/players`, label: 'Open your players' },
    baseUrl,
  })
  const body = items.slice(0, 6).map(i => `${i.starter ? '⭐ ' : ''}${i.playerName}: ${i.headline}`).join('\n')
  return { subject, html, body }
}

type Row = { id: string; leagueId: string | null; body: string | null; title: string; meta: unknown; createdAt: Date }

function toItem(row: Row, leagueNames: Map<string, string>): DigestItem | null {
  const pn = (row.meta as { playerNews?: Record<string, unknown> } | null)?.playerNews
  if (!pn) return null
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    leagueId: row.leagueId,
    leagueName: row.leagueId ? leagueNames.get(row.leagueId) ?? 'Your league' : null,
    playerName: str(pn.playerName) ?? row.title,
    team: str(pn.team),
    position: str(pn.position),
    status: str(pn.status),
    starter: pn.starter === true,
    headline: (row.body ?? row.title).split('\n')[0]!.slice(0, 220),
    createdAt: row.createdAt,
  }
}

export async function sendDuePlayerNewsDigests(input: { now?: Date; budget?: RunBudget; limit?: number } = {}): Promise<{ candidates: number; sent: number; notDue: number; empty: number }> {
  const now = input.now ?? new Date()
  const report = { candidates: 0, sent: 0, notDue: 0, empty: 0 }
  const since = new Date(now.getTime() - 36 * 3600_000)
  const users = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT DISTINCT "userId" FROM platform_notifications
    WHERE "createdAt" >= ${since} AND meta->'playerNews' IS NOT NULL
    LIMIT ${input.limit ?? 2000}`
  report.candidates = users.length
  if (!users.length) return report
  const profiles = await prisma.userProfile.findMany({ where: { userId: { in: users.map(u => u.userId) } }, select: { userId: true, timezone: true } })
  const tz = new Map(profiles.map(p => [p.userId, p.timezone]))
  const base = getBaseUrl()

  for (const { userId } of users) {
    if (input.budget?.exhausted()) break
    const { due, day } = digestDue(now, tz.get(userId))
    if (!due) { report.notDue++; continue }
    const claimKey = `pn-digest:v1:${day}:${userId}`
    const lastKey = `pn-digest-last:v1:${userId}`
    const existing = await prisma.sportsDataCache.findUnique({ where: { cacheKey: claimKey }, select: { cacheKey: true } })
    if (existing) continue
    const last = await prisma.sportsDataCache.findUnique({ where: { cacheKey: lastKey }, select: { data: true } })
    const lastAt = Date.parse(String((last?.data as { at?: string } | null)?.at ?? ''))
    const from = new Date(Number.isFinite(lastAt) ? Math.max(lastAt, now.getTime() - 36 * 3600_000) : now.getTime() - 24 * 3600_000)
    const rows = await prisma.platformNotification.findMany({
      where: { userId, createdAt: { gt: from, lte: now }, meta: { path: ['playerNews'], not: Prisma.AnyNull } },
      orderBy: { createdAt: 'desc' },
      take: MAX_ITEMS,
      select: { id: true, leagueId: true, body: true, title: true, meta: true, createdAt: true },
    })
    const leagueIds = [...new Set(rows.map(r => r.leagueId).filter((x): x is string => !!x))]
    const leagues = leagueIds.length ? await prisma.league.findMany({ where: { id: { in: leagueIds } }, select: { id: true, name: true } }) : []
    const names = new Map(leagues.map(l => [l.id, l.name ?? 'Your league']))
    const items = rows.map(r => toItem(r, names)).filter((x): x is DigestItem => !!x)
    if (!items.length) { report.empty++; continue }

    // Claim before sending, so two overlapping runs cannot both send today's digest.
    try {
      await prisma.sportsDataCache.create({ data: { cacheKey: claimKey, expiresAt: new Date(now.getTime() + CLAIM_TTL_MS), data: { at: now.toISOString(), items: items.length } as Prisma.InputJsonValue } })
    } catch {
      continue
    }
    const email = renderPlayerNewsDigest(items, base)
    const result = await dispatchNotification({
      userIds: [userId], category: 'injury_alerts', type: 'player_news_digest',
      title: email.subject, body: email.body, actionHref: '/core/players', actionLabel: 'Open your players',
      leagueId: null, severity: 'low', dedupePrefix: claimKey,
      skipChannels: { sms: true, push: true }, emailOverride: { subject: email.subject, html: email.html },
      meta: { playerNewsDigest: { items: items.length, day } },
    }).catch(() => ({ failed: 1, delivered: 0 }))
    if (result.failed > 0) {
      // Give the claim back so the next run retries today's digest.
      await prisma.sportsDataCache.delete({ where: { cacheKey: claimKey } }).catch(() => {})
      continue
    }
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: lastKey },
      update: { data: { at: now.toISOString() } as Prisma.InputJsonValue, expiresAt: new Date(now.getTime() + 30 * 86_400_000) },
      create: { cacheKey: lastKey, data: { at: now.toISOString() } as Prisma.InputJsonValue, expiresAt: new Date(now.getTime() + 30 * 86_400_000) },
    }).catch(() => {})
    report.sent++
  }
  return report
}
