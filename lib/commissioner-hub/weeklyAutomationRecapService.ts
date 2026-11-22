import 'server-only'

/**
 * The weekly "what AllFantasy did" message (./weeklyAutomationRecap.ts). Hourly from the waiver run;
 * each league's commissioner gets one per week, for the week just finished, and only when something
 * happened. "Already sent" is read from the stored notification itself, not from the dispatcher's
 * dedupe, which stops a duplicate in-app row but not a second email or push.
 */
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { countRecapActions, isRecapDay, previousRecapWeek, quietTeamsSentence, RECAP_ACTIONS, recapLines, recapMessage } from './weeklyAutomationRecap'
import { getLeagueManagerHealth } from '@/lib/commissioner-hub/managerHealth'
import { readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { readAutoHandover } from '@/lib/inactive-manager/autoHandover'

export type WeeklyRecapRunResult = { leagues: number; sent: number; nothing: number; alreadySent: number; failures: { leagueId: string; error: string }[] }

const ACTIONS = Object.keys(RECAP_ACTIONS)

export async function runWeeklyAutomationRecaps(opts?: { now?: Date; limit?: number; deadline?: number }): Promise<WeeklyRecapRunResult> {
  const now = opts?.now ?? new Date()
  const deadline = opts?.deadline ?? Date.now() + 20_000
  const { start, end, key } = previousRecapWeek(now)
  const result: WeeklyRecapRunResult = { leagues: 0, sent: 0, nothing: 0, alreadySent: 0, failures: [] }
  if (!isRecapDay(now)) return result

  // Leagues where an automation did anything last week.
  const [fromAutomation, fromAudit, fromPicks] = await Promise.all([
    prisma.automationAuditLog.findMany({ where: { action: { in: ACTIONS }, createdAt: { gte: start, lt: end }, leagueId: { not: null } }, select: { leagueId: true }, distinct: ['leagueId'] }),
    prisma.leagueAuditLog.findMany({ where: { actionType: { in: ACTIONS }, createdAt: { gte: start, lt: end } }, select: { leagueId: true }, distinct: ['leagueId'] }),
    prisma.draftPick.findMany({ where: { source: 'auto', createdAt: { gte: start, lt: end } }, select: { session: { select: { leagueId: true } } }, distinct: ['sessionId'] }),
  ])
  // And in-season leagues without an auto-handover rule, where the recap's only news may be a quiet team.
  // Ordered differently each week; the hourly Monday runs, with "already sent", work through them.
  const inSeason = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE (LOWER(status) IN ('active', 'in_season') OR (status IS NULL AND "lifecycleState"::text = 'in_season'))
      AND NOT (COALESCE(settings, '{}'::jsonb) ? 'inactive_auto_handover')
    ORDER BY md5(id || ${key}) LIMIT ${Math.max(1, Math.min(opts?.limit ?? 300, 2000))}`.catch(() => [] as Array<{ id: string }>)
  const leagueIds = [
    ...new Set([
      ...fromAutomation.map((r) => r.leagueId),
      ...fromAudit.map((r) => r.leagueId),
      ...fromPicks.map((r) => r.session?.leagueId ?? null),
      ...inSeason.map((r) => r.id),
    ].filter((v): v is string => Boolean(v))),
  ].slice(0, Math.max(1, Math.min(opts?.limit ?? 300, 2000)) * 2)

  for (const leagueId of leagueIds) {
    if (Date.now() >= deadline) break
    result.leagues += 1
    try {
      const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, name: true, platform: true, settings: true } })
      if (!league?.userId || resolveWriteAuthority(league.platform) !== 'NATIVE') continue
      const sourceKey = `automation-recap:${leagueId}:${key}`
      const sent = await prisma.platformNotification.findUnique({ where: { sourceKey: `${sourceKey}:${league.userId}` }, select: { id: true } })
      if (sent) {
        result.alreadySent += 1
        continue
      }
      const [automationRows, auditRows, autoPicks] = await Promise.all([
        prisma.automationAuditLog.groupBy({ by: ['action'], where: { leagueId, action: { in: ACTIONS }, createdAt: { gte: start, lt: end } }, _count: { _all: true } }),
        prisma.leagueAuditLog.groupBy({ by: ['actionType'], where: { leagueId, actionType: { in: ACTIONS }, createdAt: { gte: start, lt: end } }, _count: { _all: true } }),
        prisma.draftPick.count({ where: { source: 'auto', createdAt: { gte: start, lt: end }, session: { leagueId } } }),
      ])
      const counts = countRecapActions(
        [
          ...automationRows.map((r) => ({ action: r.action, n: r._count._all })),
          ...auditRows.map((r) => ({ action: r.actionType, n: r._count._all })),
        ],
        autoPicks,
      )
      const profile = await prisma.userProfile.findUnique({ where: { userId: league.userId }, select: { preferredLanguage: true } }).catch(() => null)
      const lang = profile?.preferredLanguage?.toLowerCase().startsWith('es') ? 'es' : 'en'
      const lines = recapLines(counts, lang)
      // Quiet teams nothing covers: listed only when the league has no auto-handover rule.
      let quietNames: string[] = []
      if (!readAutoHandover(league.settings)) {
        const managed = readManagedLineups(league.settings)
        const health = await getLeagueManagerHealth(leagueId).catch(() => null)
        quietNames = (health?.rows ?? []).filter((r) => r.status === 'inactive' && !managed[r.rosterId]).map((r) => r.teamName || r.managerName || (lang === 'es' ? 'Un equipo' : 'A team'))
      }
      const quiet = quietTeamsSentence(quietNames, lang)
      if (lines.length === 0 && !quiet) {
        result.nothing += 1
        continue
      }
      const msg = recapMessage(league.name ?? (lang === 'es' ? 'tu liga' : 'your league'), lines, lang, quiet)
      await dispatchNotification({
        userIds: [league.userId],
        category: 'commissioner_alerts',
        type: 'weekly_automation_recap',
        title: msg.title,
        body: msg.body,
        severity: 'low',
        leagueId,
        // With quiet teams, the button opens the card that hands them over; otherwise the league log.
        actionHref: quiet ? `/core/commissioner?league=${encodeURIComponent(leagueId)}#ch-inactive-managers` : `/league/${encodeURIComponent(leagueId)}/log`,
        actionLabel: quiet ? (lang === 'es' ? 'Pasar a AllFantasy' : 'Hand to AllFantasy') : lang === 'es' ? 'Abrir registro de la liga' : 'Open league log',
        dedupePrefix: sourceKey,
        meta: { leagueId, week: key, counts, quietTeams: quietNames.length },
      })
      result.sent += 1
    } catch (e) {
      result.failures.push({ leagueId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}
