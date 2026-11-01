import 'server-only'

import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import {
  dueReminders,
  manualReminderAllowed,
  parseCustomDeadlines,
  pruneSent,
  readAutopilotSettings,
  reminderCopy,
  withAutopilotSettings,
  type AutopilotSettings,
  type LeagueDeadline,
} from './autopilot'

/**
 * Deadline autopilot — reads, sends, records. Rules live in ./autopilot.
 *
 * Runs as a phase of `/api/cron/alert-sweep` (every five minutes), so the 1 h reminder lands
 * between 60 and 55 minutes out. 🛑 OFF until `DEADLINE_AUTOPILOT_ENABLED=1` — the commissioner's
 * switch records their choice; nothing is sent to a real league until the platform turns this on.
 *
 * ⚠ THE PLAN IS RE-CHECKED AT SEND TIME, NOT ONLY WHEN THE SWITCH IS SAVED. A lapsed Commissioner
 * plan stops the automatic reminders on the next run; the switch stays on and resumes on renewal.
 * The plan checked is the league owner's (`League.userId`), the person who pays for the league.
 *
 * ⚠ SENT-MARKERS ARE WRITTEN UNDER A ROW LOCK, AFTER THE SEND. A crash between the two re-sends
 * one reminder on the next run rather than silently dropping it; `dedupePrefix` keeps that from
 * becoming a duplicate in-app row.
 */

export const AUTOPILOT_FEATURE = 'commissioner_automation'
export const AUTOPILOT_FLAG = 'DEADLINE_AUTOPILOT_ENABLED'

export function autopilotSendEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[AUTOPILOT_FLAG] === '1'
}

export async function autopilotEntitled(ownerUserId: string): Promise<boolean> {
  try {
    const decision = await new FeatureGateService().evaluateUserFeatureAccess(ownerUserId, AUTOPILOT_FEATURE)
    return decision.allowed
  } catch (e) {
    console.warn('[deadline-autopilot] plan check failed; treating as no plan', e instanceof Error ? e.message : e)
    return false
  }
}

async function updateLocked(leagueId: string, mutate: (current: AutopilotSettings) => AutopilotSettings | null): Promise<AutopilotSettings | null> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!league) return null
    const next = mutate(readAutopilotSettings(league.settings))
    if (!next) return null
    await tx.league.update({ where: { id: leagueId }, data: { settings: withAutopilotSettings(league.settings, next) as Prisma.InputJsonValue } })
    return next
  })
}

/**
 * Keeper sessions: the managers whose roster has no keeper submitted.
 *
 * ⚠ SUBMISSIONS ARE LOOKED FOR UNDER BOTH SEASONS. `KeeperSelectionSession.seasonId` is the
 * INCOMING season, while the selections route records `KeeperRecord` under whatever season the
 * client sent — in practice the outgoing one, whose roster holds the players. Reading only one
 * would remind a manager who already submitted.
 */
async function keeperDeadlines(leagueId: string, now: Date): Promise<LeagueDeadline[]> {
  const sessions = await prisma.keeperSelectionSession.findMany({
    where: { leagueId, status: 'open', deadline: { gt: now } },
    select: { id: true, seasonId: true, deadline: true },
  })
  const out: LeagueDeadline[] = []
  for (const s of sessions) {
    const outgoing = await prisma.redraftSeason.findFirst({
      where: { leagueId, NOT: { id: s.seasonId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    const seasonIds = [s.seasonId, ...(outgoing ? [outgoing.id] : [])]
    const [rosters, records] = await Promise.all([
      prisma.redraftRoster.findMany({ where: { leagueId, seasonId: outgoing?.id ?? s.seasonId }, select: { id: true, ownerId: true } }),
      prisma.keeperRecord.findMany({ where: { leagueId, seasonId: { in: seasonIds }, status: { not: 'rejected' } }, select: { rosterId: true } }),
    ])
    const submitted = new Set(records.map((r) => r.rosterId))
    const pending = [...new Set(rosters.filter((r) => !submitted.has(r.id) && r.ownerId).map((r) => r.ownerId))]
    out.push({ key: `keeper:${s.id}`, kind: 'keeper', label: 'Keeper deadline', at: s.deadline, recipientUserIds: pending, targeted: true })
  }
  return out
}

/** Every claimed manager in the league — custom deadlines go to all of them. */
async function managerIds(leagueId: string, ownerUserId: string | null): Promise<string[]> {
  const teams = await prisma.leagueTeam.findMany({ where: { leagueId, claimedByUserId: { not: null } }, select: { claimedByUserId: true } })
  const ids = new Set<string>()
  for (const t of teams) if (t.claimedByUserId) ids.add(t.claimedByUserId)
  if (ids.size === 0 && ownerUserId) ids.add(ownerUserId)
  return [...ids]
}

export async function readLeagueDeadlines(
  league: { id: string; userId: string | null; settings: unknown },
  now: Date,
): Promise<LeagueDeadline[]> {
  const settings = readAutopilotSettings(league.settings)
  const keeper = await keeperDeadlines(league.id, now)
  const future = settings.custom.filter((c) => Date.parse(c.at) > now.getTime())
  const everyone = future.length > 0 ? await managerIds(league.id, league.userId) : []
  const custom: LeagueDeadline[] = future.map((c) => ({
    key: `custom:${c.id}`,
    kind: c.kind,
    label: c.label,
    at: new Date(c.at),
    recipientUserIds: everyone,
    targeted: false,
  }))
  return [...keeper, ...custom].sort((a, b) => a.at.getTime() - b.at.getTime())
}

async function send(leagueId: string, leagueName: string, d: LeagueDeadline, now: Date, dedupe: string): Promise<void> {
  const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
  const copy = reminderCopy(d, now, leagueName)
  await dispatchNotification({
    userIds: d.recipientUserIds,
    category: 'league_announcements',
    type: 'league_deadline_reminder',
    title: copy.title,
    body: copy.body,
    // The label is commissioner-written text: SMS says only that a deadline is coming.
    smsBody: `AllFantasy: a ${leagueName} deadline is coming up. Open the app for details.`,
    actionHref: `/league/${encodeURIComponent(leagueId)}`,
    actionLabel: 'Open league',
    leagueId,
    severity: 'medium',
    dedupePrefix: `deadline-autopilot:${leagueId}:${dedupe}`,
    meta: { deadlineKey: d.key, at: d.at.toISOString() },
  })
}

export type AutopilotRun = {
  ran: true
  leagues: number
  notEntitled: number
  reminders: number
  recipients: number
  budgetStopped: boolean
  errors: Array<{ leagueId: string; error: string }>
}

/** The cron phase: every league with the switch on, its due reminders sent and recorded. */
export async function runDeadlineAutopilot(opts: { dryRun: boolean; budgetMs: number; now?: Date }): Promise<AutopilotRun> {
  const started = Date.now()
  const now = opts.now ?? new Date()
  const leagues = await prisma.league.findMany({
    where: { settings: { path: ['deadline_autopilot', 'enabled'], equals: true } },
    select: { id: true, name: true, userId: true, settings: true },
  })
  const run: AutopilotRun = { ran: true, leagues: leagues.length, notEntitled: 0, reminders: 0, recipients: 0, budgetStopped: false, errors: [] }
  for (const league of leagues) {
    if (Date.now() - started > opts.budgetMs) {
      run.budgetStopped = true
      break
    }
    try {
      if (!league.userId || !(await autopilotEntitled(league.userId))) {
        run.notEntitled++
        continue
      }
      const deadlines = await readLeagueDeadlines(league, now)
      const due = dueReminders(deadlines, readAutopilotSettings(league.settings).sent, now)
      if (due.length === 0) continue
      run.reminders += due.length
      run.recipients += due.reduce((n, r) => n + r.deadline.recipientUserIds.length, 0)
      if (opts.dryRun) continue
      const at = now.toISOString()
      for (const r of due) await send(league.id, league.name ?? 'Your league', r.deadline, now, `${r.deadline.key}:${r.stage}`)
      const liveKeys = deadlines.map((d) => d.key)
      await updateLocked(league.id, (cur) => {
        const sent = pruneSent(cur.sent, liveKeys)
        for (const r of due) for (const m of r.marks) sent[m] = sent[m] ?? at
        return { ...cur, sent }
      })
    } catch (e) {
      run.errors.push({ leagueId: league.id, error: (e instanceof Error ? e.message : String(e)).slice(0, 160) })
    }
  }
  return run
}

// ── Commissioner surface ────────────────────────────────────────────────────

export type AutopilotView = {
  enabled: boolean
  entitled: boolean
  sendEnabled: boolean
  custom: AutopilotSettings['custom']
  deadlines: Array<{ key: string; kind: string; label: string; at: string; recipients: number; targeted: boolean; manualAllowed: boolean; lastSent: string | null }>
}

export async function readAutopilotView(leagueId: string, now = new Date()): Promise<AutopilotView | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, userId: true, settings: true } })
  if (!league) return null
  const settings = readAutopilotSettings(league.settings)
  const [deadlines, entitled] = await Promise.all([
    readLeagueDeadlines(league, now),
    league.userId ? autopilotEntitled(league.userId) : Promise.resolve(false),
  ])
  return {
    enabled: settings.enabled,
    entitled,
    sendEnabled: autopilotSendEnabled(),
    custom: settings.custom,
    deadlines: deadlines.map((d) => {
      const stamps = Object.entries(settings.sent).filter(([k]) => k.startsWith(`${d.key}:`)).map(([, v]) => v).sort()
      return {
        key: d.key,
        kind: d.kind,
        label: d.label,
        at: d.at.toISOString(),
        recipients: d.recipientUserIds.length,
        targeted: d.targeted,
        manualAllowed: manualReminderAllowed(settings.sent, d.key, now),
        lastSent: stamps.at(-1) ?? null,
      }
    }),
  }
}

export type SaveError = 'too_many' | 'label_required' | 'invalid_time' | 'not_entitled' | 'not_found'

/** Save the switch and/or the custom list. Turning the switch ON needs the plan; OFF never does. */
export async function saveAutopilotSettings(
  leagueId: string,
  body: { enabled?: unknown; custom?: unknown },
): Promise<{ ok: true } | { ok: false; error: SaveError }> {
  let custom: AutopilotSettings['custom'] | undefined
  if (body.custom !== undefined) {
    const parsed = parseCustomDeadlines(body.custom, () => randomUUID())
    if (!parsed.ok) return parsed
    custom = parsed.custom
  }
  const enable = typeof body.enabled === 'boolean' ? body.enabled : undefined
  if (enable === true) {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
    if (!league) return { ok: false, error: 'not_found' }
    if (!league.userId || !(await autopilotEntitled(league.userId))) return { ok: false, error: 'not_entitled' }
  }
  const saved = await updateLocked(leagueId, (cur) => ({ ...cur, enabled: enable ?? cur.enabled, custom: custom ?? cur.custom }))
  return saved ? { ok: true } : { ok: false, error: 'not_found' }
}

export type ManualError = 'not_found' | 'cooldown' | 'no_recipients'

/** Free: one reminder by hand, now, to the same managers the autopilot would tell. */
export async function sendManualReminder(leagueId: string, deadlineKey: string, now = new Date()): Promise<{ ok: true; recipients: number } | { ok: false; error: ManualError }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, name: true, userId: true, settings: true } })
  if (!league) return { ok: false, error: 'not_found' }
  const d = (await readLeagueDeadlines(league, now)).find((x) => x.key === deadlineKey)
  if (!d) return { ok: false, error: 'not_found' }
  if (d.recipientUserIds.length === 0) return { ok: false, error: 'no_recipients' }
  // Claim the slot under the lock BEFORE sending, so two quick clicks cannot both send.
  let claimed = false
  await updateLocked(leagueId, (cur) => {
    if (!manualReminderAllowed(cur.sent, deadlineKey, now)) return null
    claimed = true
    return { ...cur, sent: { ...cur.sent, [`${deadlineKey}:manual`]: now.toISOString() } }
  })
  if (!claimed) return { ok: false, error: 'cooldown' }
  await send(leagueId, league.name ?? 'Your league', d, now, `${deadlineKey}:manual:${now.toISOString()}`)
  return { ok: true, recipients: d.recipientUserIds.length }
}
