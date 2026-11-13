import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { readDuesConfig } from '@/lib/dues/duesTracker'
import { readAmendments } from '@/lib/constitution/constitutionBuilder'
import { readTradeValueAudits, tradeValueAuditsReady } from '@/lib/integrity/tradeValueAudit'
import { messagesFor } from '@/lib/i18n/messages'
import { commissionerWeeklyDigestMessages, digestLanguage, type DigestLanguage } from '@/lib/core-app/messages/commissionerWeeklyDigest'

/**
 * The weekly commissioner digest: ONE notification on Tuesday, after Monday night's game, rolling up
 * what is waiting on the commissioner instead of a ping per item.
 *
 *   open integrity cases · trades audited this week · "I paid" claims to confirm ·
 *   rule changes waiting for approval · an open draft-time poll
 *
 * Runs inside the daily `commissioner-workspace-refresh` cron (08:40 UTC): the cron registry is at its
 * 60-entry ceiling (scripts/cron-budget-check.mjs), so it piggybacks rather than adding a schedule.
 * Tuesday is the send day; Wednesday is the catch-up if Tuesday's run did not reach a league.
 *
 * ⚠ ONCE PER WEEK, CLAIMED BEFORE SENDING. `League.settings.commish_digest.weekKey` is set with a
 * conditional `jsonb_set` — atomic, and it touches no other settings key — and only the run that wins
 * the claim sends. A re-fire or an overlapping run cannot send twice. A dispatch that fails after the
 * claim loses that week's digest rather than risking a duplicate; the items stay on the hub either way.
 *
 * ⚠ NOTHING TO SAY, NOTHING SENT. A quiet league gets no digest and no marker.
 * Preferences: `commissioner_alerts`, so the dispatcher's category opt-out and per-league mute apply.
 * Chat is never read (League Health privacy boundary).
 */

const DAY_MS = 86_400_000
const KEY = 'commish_digest'

export type DigestCounts = {
  openCases: number
  tradesAudited: number
  widestGapPct: number | null
  duesClaims: number
  pendingRuleChanges: number
  draftPollOpen: boolean
}

/** Tuesday (send) and Wednesday (catch-up), UTC. */
export function isDigestDay(now: Date): boolean {
  const d = now.getUTCDay()
  return d === 2 || d === 3
}

/** The week's key: the UTC date of this week's Tuesday. Wednesday maps to the same key. */
export function digestWeekKey(now: Date): string {
  const back = (now.getUTCDay() - 2 + 7) % 7
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - back * DAY_MS).toISOString().slice(0, 10)
}

/** The digest's lines in the commissioner's language, most urgent first. `null` when there is nothing to say. Pure. */
export function buildDigestLines(c: DigestCounts, lang: DigestLanguage = 'en'): string[] | null {
  const m = messagesFor(commissionerWeeklyDigestMessages, lang)
  const lines: string[] = []
  if (c.openCases > 0) lines.push(m.openCases(c.openCases))
  if (c.pendingRuleChanges > 0) lines.push(m.ruleChanges(c.pendingRuleChanges))
  if (c.duesClaims > 0) lines.push(m.duesClaims(c.duesClaims))
  if (c.draftPollOpen) lines.push(m.draftPoll)
  if (c.tradesAudited > 0) {
    const gap = c.widestGapPct != null && c.widestGapPct > 0 ? m.widestGap(Math.round(c.widestGapPct)) : ''
    lines.push(`${m.tradesAudited(c.tradesAudited)}${gap}`)
  }
  return lines.length ? lines : null
}

type LeagueRow = { id: string; name: string | null; userId: string | null; settings: unknown }

export type DigestDeps = {
  candidates: (now: Date) => Promise<string[]>
  league: (leagueId: string) => Promise<LeagueRow | null>
  openCases: (leagueId: string) => Promise<number>
  audits: (leagueId: string, since: Date) => Promise<Array<{ gapPct: number }>>
  claim: (leagueId: string, weekKey: string, now: Date) => Promise<boolean>
  /** The commissioner's `UserProfile.preferredLanguage`, or null. */
  language: (userId: string) => Promise<string | null>
  send: (args: { userId: string; leagueId: string; leagueName: string | null; lines: string[]; lang: DigestLanguage }) => Promise<unknown>
}

/** Counts from the league row's own settings: dues claims, pending rule changes, the draft poll. */
export function settingsCounts(settings: unknown): Pick<DigestCounts, 'duesClaims' | 'pendingRuleChanges' | 'draftPollOpen'> {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>
  const dues = readDuesConfig(s.dues_tracker)
  const poll = s.draft_schedule_poll as { status?: unknown } | null | undefined
  return {
    // A claim the commissioner has not acted on: the manager said they paid and the entry is still unpaid.
    duesClaims: dues.entries.filter((e) => e.selfReportedAt && !e.paid).length,
    pendingRuleChanges: readAmendments(s.constitution_amendments).filter((a) => a.status === 'pending_approval').length,
    draftPollOpen: !!poll && typeof poll === 'object' && poll.status === 'open',
  }
}

const defaultDeps: DigestDeps = {
  async candidates(now) {
    const since = new Date(now.getTime() - 7 * DAY_MS)
    // Cheap, indexed sources only; a league with none of these has nothing for the digest to say.
    const [flags, audits, featured] = await Promise.all([
      prisma.integrityFlag.findMany({ where: { status: 'open' }, select: { leagueId: true }, distinct: ['leagueId'], take: 1000 }).catch(() => []),
      tradeValueAuditsReady()
        .then((ok) => (ok ? prisma.$queryRaw<Array<{ league_id: string }>>`SELECT DISTINCT league_id FROM trade_value_audits WHERE created_at >= ${since} LIMIT 1000` : []))
        .catch(() => []),
      prisma
        .$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM leagues WHERE settings ?| array['dues_tracker','constitution_amendments','draft_schedule_poll'] LIMIT 2000`,
        )
        .catch(() => []),
    ])
    return [...new Set([...flags.map((f) => f.leagueId), ...audits.map((a) => a.league_id), ...featured.map((l) => l.id)])].sort()
  },
  league: (leagueId) => prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, name: true, userId: true, settings: true } }),
  openCases: (leagueId) => prisma.integrityFlag.count({ where: { leagueId, status: 'open' } }),
  audits: (leagueId, since) => readTradeValueAudits(leagueId, { since }),
  async claim(leagueId, weekKey, now) {
    const marker = JSON.stringify({ weekKey, sentAt: now.toISOString() })
    const n = await prisma.$executeRaw`
      UPDATE leagues
         SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), ${'{' + KEY + '}'}::text[], ${marker}::jsonb, true)
       WHERE id = ${leagueId}
         AND (settings -> ${KEY}::text ->> 'weekKey') IS DISTINCT FROM ${weekKey}::text`
    return n === 1
  },
  language: (userId) =>
    prisma.userProfile
      .findUnique({ where: { userId }, select: { preferredLanguage: true } })
      .then((p) => p?.preferredLanguage ?? null)
      .catch(() => null),
  send: ({ userId, leagueId, leagueName, lines, lang }) =>
    dispatchNotification({
      userIds: [userId],
      category: 'commissioner_alerts',
      type: 'commissioner_weekly_digest',
      title: messagesFor(commissionerWeeklyDigestMessages, lang).title(leagueName),
      body: lines.join('\n'),
      smsBody: lines[0],
      severity: 'low',
      leagueId,
      actionHref: `/core/commissioner?league=${encodeURIComponent(leagueId)}`,
      actionLabel: messagesFor(commissionerWeeklyDigestMessages, lang).action,
      meta: { leagueId, digest: 'weekly' },
    }),
}

export type DigestRunResult = { day: boolean; weekKey: string; candidates: number; sent: number; quiet: number; alreadySent: number; failed: number }

export async function runWeeklyCommishDigests(opts: { now?: Date; leagueId?: string; deadline?: number } = {}, deps: DigestDeps = defaultDeps): Promise<DigestRunResult> {
  const now = opts.now ?? new Date()
  const weekKey = digestWeekKey(now)
  const out: DigestRunResult = { day: isDigestDay(now), weekKey, candidates: 0, sent: 0, quiet: 0, alreadySent: 0, failed: 0 }
  if (!out.day) return out
  const deadline = opts.deadline ?? Date.now() + 60_000
  const ids = opts.leagueId ? [opts.leagueId] : await deps.candidates(now)
  out.candidates = ids.length
  const since = new Date(now.getTime() - 7 * DAY_MS)

  for (const leagueId of ids) {
    if (Date.now() >= deadline) break
    try {
      const league = await deps.league(leagueId)
      if (!league?.userId) continue
      const marker = (league.settings as Record<string, unknown> | null)?.[KEY] as { weekKey?: string } | undefined
      if (marker?.weekKey === weekKey) {
        out.alreadySent += 1
        continue
      }
      const [openCases, audits, preferred] = await Promise.all([deps.openCases(leagueId), deps.audits(leagueId, since), deps.language(league.userId)])
      const lang = digestLanguage(preferred)
      const lines = buildDigestLines({
        openCases,
        tradesAudited: audits.length,
        widestGapPct: audits.length ? Math.max(...audits.map((a) => Math.abs(a.gapPct))) : null,
        ...settingsCounts(league.settings),
      }, lang)
      if (!lines) {
        out.quiet += 1
        continue
      }
      if (!(await deps.claim(leagueId, weekKey, now))) {
        out.alreadySent += 1
        continue
      }
      await deps.send({ userId: league.userId, leagueId, leagueName: league.name, lines, lang })
      out.sent += 1
    } catch (e) {
      out.failed += 1
      console.error('[commish-digest] league failed', { leagueId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}
