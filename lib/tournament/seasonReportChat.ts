import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { lockSeasonShell } from './seasonRounds'
import { SEASON_REPORT_PUBLISHED } from './seasonReportPublication'
import { seasonReportSummary, type SeasonReportSnapshot } from './seasonReportFormat'
import { can, isSeasonLiveStaff } from './tournamentPermissions'

export const SEASON_REPORT_CHAT_RECEIPT = 'season_report_chat_delivered'
const COMPLETE = 'season_report_chat_complete'
export const seasonReportAudience = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('stage') }).strict(),
  z.object({ scope: z.literal('division'), target: z.string().min(1).max(40) }).strict(),
  z.object({ scope: z.literal('league'), target: z.string().min(1).max(200) }).strict(),
])
type Audience = z.infer<typeof seasonReportAudience>

export async function deliverSeasonReport(tournamentId: string, reportId: string, audience: Audience, now: Date, userId?: string) {
  return prisma.$transaction(async tx => {
    const shell = await lockSeasonShell(tx, tournamentId)
    if (!shell) return { ok: false as const, status: 404, error: 'Report not found.' }
    if (userId) {
      const grant = userId === shell.commissionerId ? null : await tx.tournamentShellGrant.findUnique({
        where: { tournamentId_userId: { tournamentId, userId } },
      })
      if (!can({ userId, commissionerId: shell.commissionerId, grant }, 'broadcast') && !isSeasonLiveStaff(grant)) {
        return { ok: false as const, status: 404, error: 'Report not found.' }
      }
    }
    const report = await tx.tournamentAuditLog.findFirst({
      where: { id: reportId, tournamentId, action: SEASON_REPORT_PUBLISHED, targetType: 'round' },
    })
    const data = report?.data as SeasonReportSnapshot | undefined
    if (!report?.targetId || data?.schemaVersion !== 1) return { ok: false as const, status: 404, error: 'Report not found.' }
    const selected = data.leagues.filter(league => audience.scope === 'stage'
      || (audience.scope === 'division' ? league.division === audience.target : league.id === audience.target))
    if (!selected.length) return { ok: false as const, status: 400, error: 'Choose a league or division in this report.' }
    const destinations = selected.map(league => ({
      ...league,
      messageId: seasonResourceId(report.id, 'league-chat:' + league.id),
      receiptId: seasonResourceId(report.id, 'league-chat-receipt:' + league.id),
    }))
    const existing = new Set((await tx.tournamentAuditLog.findMany({
      where: { id: { in: destinations.map(item => item.receiptId) }, tournamentId, action: SEASON_REPORT_CHAT_RECEIPT },
      select: { id: true },
    })).map(item => item.id))
    const bindings = await tx.tournamentLeague.findMany({
      where: { tournamentId, roundId: report.targetId, leagueId: { in: selected.map(league => league.id) } },
      select: { leagueId: true, slug: true, league: { select: { userId: true } } },
    })
    const pending = destinations.flatMap(destination => {
      if (existing.has(destination.receiptId)) return []
      const binding = bindings.find(league => league.leagueId === destination.id && league.slug === destination.key)
      return binding?.league ? [{ ...destination, sender: binding.league.userId }] : []
    })
    const caption = 'Stage ' + data.stage + ' · Period ' + data.period + ' · v' + data.revision + ' · ' + data.status
    if (pending.length) {
      await tx.leagueChatMessage.createMany({
        data: pending.map(league => {
          const rows = data.rows.filter(row => row.leagueId === league.id)
          const leaders = rows.filter(row => row.weekPoints !== null).sort((a, b) => b.weekPoints! - a.weekPoints!).slice(0, 3)
          const lines = [
            data.tournamentName + ' standings · ' + caption,
            league.name + (league.division ? ' · ' + league.division : ''),
            seasonReportSummary(rows),
            leaders.length ? 'Period leaders · ' + leaders.map(row => row.manager + ' ' + row.weekPoints).join(' · ') : 'Period scores are pending.',
            'Report ' + report.id,
          ]
          return {
            id: league.messageId, leagueId: league.id, userId: league.sender, message: lines.join('\n'), type: 'scoring_notice',
            source: null, messageSubtype: 'season_report', createdAt: now,
            metadata: { tournamentId, reportId: report.id, leagueId: league.id, stage: data.stage, period: data.period, revision: data.revision },
          }
        }),
        skipDuplicates: true,
      })
      await tx.tournamentAuditLog.createMany({
        data: pending.map(league => ({
          id: league.receiptId, tournamentId, roundNumber: data.stage, action: SEASON_REPORT_CHAT_RECEIPT,
          actorType: userId ? 'user' : 'system', actorId: userId, targetType: 'report', targetId: report.id, createdAt: now,
          data: { leagueId: league.id, channel: 'league_chat', messageId: league.messageId, audience },
        })),
        skipDuplicates: true,
      })
    }
    if (audience.scope === 'stage') {
      const id = seasonResourceId(report.id, 'league-chat-complete')
      await tx.tournamentAuditLog.upsert({
        where: { id }, update: {},
        create: { id, tournamentId, roundNumber: data.stage, action: COMPLETE, actorType: 'system', targetType: 'report', targetId: report.id, createdAt: now },
      })
    }
    return { ok: true as const, posted: pending.length, alreadyPosted: existing.size, unavailable: selected.length - pending.length - existing.size }
  }, { maxWait: 5_000, timeout: 12_000 })
}

export async function deliverPendingSeasonReports(now: Date) {
  const pending = await prisma.$queryRaw<{ id: string; tournamentId: string }[]>`
    SELECT id, "tournamentId" FROM (
      SELECT DISTINCT ON (report."tournamentId") report.id, report."tournamentId", report."createdAt"
      FROM tournament_shell_audit_logs report
      WHERE report.action = ${SEASON_REPORT_PUBLISHED}
        AND NOT EXISTS (
          SELECT 1 FROM tournament_shell_audit_logs receipt
          WHERE receipt."tournamentId" = report."tournamentId" AND receipt."targetId" = report.id AND receipt.action = ${COMPLETE}
        )
      ORDER BY report."tournamentId", report."createdAt", (report.data->>'period')::int, (report.data->>'revision')::int
    ) pending
    ORDER BY "createdAt", id LIMIT 6
  `
  const results = await Promise.allSettled(pending.map(report => deliverSeasonReport(report.tournamentId, report.id, { scope: 'stage' }, now)))
  return results.reduce((summary, result, i) => {
    if (result.status === 'fulfilled' && result.value.ok) summary.posted += result.value.posted
    else summary.errors.push(pending[i]!.id + ' report chat delivery will retry.')
    return summary
  }, { posted: 0, errors: [] as string[] })
}
