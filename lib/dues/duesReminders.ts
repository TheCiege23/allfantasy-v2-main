import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

import { readDuesConfig, reminderDue, reminderText, teamPaid } from './duesTracker'

/**
 * Hourly: remind managers who have not paid their league dues — a week before the due date, the day
 * before, and once when overdue (`reminderDue`). TRACKING ONLY: the reminder points at the league's own
 * payment links; AllFantasy never collects anything.
 *
 * Each reminder goes out once per season, recorded in `dues_tracker.remindersSent` under a row lock, so
 * two overlapping runs cannot both send it. A manager who already tapped "I paid" is not chased: that
 * is for the commissioner to confirm, not a reason to nag.
 */
export async function runDuesReminders(now = new Date(), limit = 200): Promise<{ leagues: number; reminded: number; failures: string[] }> {
  const out = { leagues: 0, reminded: 0, failures: [] as string[] }
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE settings ? 'dues_tracker'
      AND (settings -> 'dues_tracker' ->> 'dueDate') IS NOT NULL
    ORDER BY id LIMIT ${limit}`.catch(() => [] as Array<{ id: string }>)

  for (const { id: leagueId } of rows) {
    out.leagues += 1
    try {
      const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { name: true, season: true, isDynasty: true, settings: true, teams: { select: { id: true, claimedByUserId: true } } },
      })
      if (!league) continue
      const season = league.season
      const config = readDuesConfig(((league.settings as Record<string, unknown>) ?? {}).dues_tracker)
      const kind = reminderDue(config, season, now)
      if (!kind) continue

      // Claim the reminder first, under a lock: the second of two overlapping runs finds it taken.
      const claimed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
        const fresh = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
        const settings = (fresh?.settings as Record<string, unknown>) ?? {}
        const current = readDuesConfig(settings.dues_tracker)
        const key = `${season}:${kind}`
        if (current.remindersSent[key]) return false
        await tx.league.update({
          where: { id: leagueId },
          data: { settings: { ...settings, dues_tracker: { ...current, remindersSent: { ...current.remindersSent, [key]: now.toISOString() } } } as Prisma.InputJsonValue },
        })
        return true
      })
      if (!claimed) continue

      const unpaid = league.teams.filter((t) => {
        if (!t.claimedByUserId) return false
        if (teamPaid(config, t.id, season, Boolean(league.isDynasty))) return false
        return !config.entries.find((e) => e.teamId === t.id)?.selfReportedAt
      })
      const userIds = [...new Set(unpaid.map((t) => t.claimedByUserId!))]
      if (userIds.length === 0) continue
      const { title, body } = reminderText(config, kind, league.name ?? 'your league')
      const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
      await dispatchNotification({
        userIds,
        category: 'league_announcements',
        productType: 'app',
        type: `dues_reminder_${kind}`,
        title,
        body,
        actionHref: `/league/${encodeURIComponent(leagueId)}`,
        actionLabel: 'Open the league',
        meta: { leagueId, kind, season },
        severity: kind === 'overdue' ? 'medium' : 'low',
      } as never)
      out.reminded += userIds.length
    } catch (e) {
      out.failures.push(`${leagueId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}
