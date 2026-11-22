import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

import { draftReminderDue } from './draftSchedule'

/**
 * Hourly: the day-before and hour-before draft reminders, in each member's own time zone.
 *
 * `notifyDraftStartingSoon` existed with no scheduled caller, so nobody was reminded of a draft unless
 * they happened to open the app. This is that caller.
 *
 * ⚠ ONCE PER (DRAFT TIME, WINDOW), RECORDED UNDER A ROW LOCK. The dispatcher's dedupe key only stops a
 * second in-app row; push and email would go twice. So the reminder is claimed in
 * `League.settings.draft_reminders_sent` first, and a second run (or a retried one) finds it taken. Moving
 * the draft changes the key, so the new time gets its own pair.
 */
const REMINDERS_KEY = 'draft_reminders_sent'

export async function runDraftStartReminders(now = new Date(), limit = 200): Promise<{ leagues: number; reminded: number; failures: string[] }> {
  const out = { leagues: 0, reminded: 0, failures: [] as string[] }
  const rows = await prisma.leagueSettings
    .findMany({
      where: { draftDateUtc: { gt: now, lte: new Date(now.getTime() + 25 * 60 * 60 * 1000) } },
      select: { leagueId: true, draftDateUtc: true },
      take: limit,
    })
    .catch(() => [] as Array<{ leagueId: string; draftDateUtc: Date | null }>)

  for (const row of rows) {
    if (!row.draftDateUtc) continue
    const window = draftReminderDue(row.draftDateUtc, now)
    if (!window) continue
    out.leagues += 1
    try {
      // A draft already running or finished needs no reminder.
      const session = await prisma.draftSession.findFirst({ where: { leagueId: row.leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } })
      if (session && session.status !== 'pre_draft') continue

      const key = `${row.draftDateUtc.toISOString()}:${window}`
      const claimed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${row.leagueId} FOR UPDATE`
        const league = await tx.league.findUnique({ where: { id: row.leagueId }, select: { settings: true } })
        if (!league) return false
        const settings = (league.settings as Record<string, unknown>) ?? {}
        const sent = (settings[REMINDERS_KEY] && typeof settings[REMINDERS_KEY] === 'object' ? settings[REMINDERS_KEY] : {}) as Record<string, string>
        if (sent[key]) return false
        // Keep the record small: only the last few drafts' keys.
        const kept = Object.fromEntries(Object.entries(sent).slice(-10))
        await tx.league.update({ where: { id: row.leagueId }, data: { settings: { ...settings, [REMINDERS_KEY]: { ...kept, [key]: now.toISOString() } } as Prisma.InputJsonValue } })
        return true
      })
      if (!claimed) continue
      const { notifyDraftStartsIn } = await import('@/lib/draft-notifications')
      out.reminded += await notifyDraftStartsIn(row.leagueId, row.draftDateUtc, window, now)
    } catch (e) {
      out.failures.push(`${row.leagueId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}
