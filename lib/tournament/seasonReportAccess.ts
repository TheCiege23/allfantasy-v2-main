import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { SEASON_REPORT_PUBLISHED } from './seasonReportPublication'
import { seasonReportSummary, type SeasonReport, type SeasonReportSnapshot, type SeasonReportVersion } from './seasonReportFormat'
import { can, isSeasonLiveStaff } from './tournamentPermissions'

export async function getSeasonReportAccess(tournamentId: string, userId: string) {
  const native = await prisma.tournamentAuditLog.findFirst({
    where: { tournamentId, action: 'season_blueprint_created' },
    select: { tournament: { select: { commissionerId: true } } },
  })
  if (!native) return null
  const { commissionerId } = native.tournament
  const grant = commissionerId === userId ? null : await prisma.tournamentShellGrant.findUnique({
    where: { tournamentId_userId: { tournamentId, userId } },
  })
  const context = { userId, commissionerId, grant }
  if (can(context, 'view')) return { staff: true, canPost: can(context, 'broadcast') || isSeasonLiveStaff(grant), entrantId: null, stages: [] as number[] }
  const entrant = await prisma.tournamentParticipant.findFirst({
    where: { tournamentId, userId, status: { in: ['registered', 'eliminated', 'champion'] } },
    select: { id: true, leagueParticipations: { select: { league: { select: { round: { select: { roundNumber: true } } } } } } },
  })
  if (!entrant) return null
  return { staff: false, canPost: false, entrantId: entrant.id, stages: [...new Set(entrant.leagueParticipations.map(row => row.league.round.roundNumber))] }
}
type Access = NonNullable<Awaited<ReturnType<typeof getSeasonReportAccess>>>

export async function listSeasonReportVersions(tournamentId: string, access: Access, latestForStage?: number) {
  if (!access.staff && (!access.stages.length || (latestForStage !== undefined && !access.stages.includes(latestForStage)))) return []
  const stage = latestForStage === undefined ? Prisma.empty : Prisma.sql`AND "roundNumber" = ${latestForStage}`
  const limit = latestForStage === undefined ? Prisma.empty : Prisma.sql`LIMIT 1`
  const scope = access.staff ? Prisma.empty : Prisma.sql`AND "roundNumber" IN (${Prisma.join(access.stages)})`
  const rows = await prisma.$queryRaw<(Omit<SeasonReportVersion, 'publishedAt'> & { publishedAt: Date })[]>`
    SELECT id, "roundNumber" AS stage, (data->>'period')::int AS period, (data->>'revision')::int AS revision,
      data->>'status' AS status, (data->>'official')::boolean AS official, data->>'previousId' AS "previousId", "createdAt" AS "publishedAt"
    FROM tournament_shell_audit_logs
    WHERE "tournamentId" = ${tournamentId} AND action = ${SEASON_REPORT_PUBLISHED} ${scope} ${stage}
    ORDER BY stage DESC, period DESC, revision DESC ${limit}
  `
  return rows.map(row => ({ ...row, publishedAt: row.publishedAt.toISOString() }))
}

export async function getSeasonReport(tournamentId: string, reportId: string, access: Access, leagueId?: string) {
  const event = await prisma.tournamentAuditLog.findFirst({
    where: { id: reportId, tournamentId, action: SEASON_REPORT_PUBLISHED },
    select: { id: true, createdAt: true, data: true },
  })
  const snapshot = event?.data as SeasonReportSnapshot | undefined
  if (!event || snapshot?.schemaVersion !== 1) return null
  const report: SeasonReport = { ...snapshot, id: event.id, publishedAt: event.createdAt.toISOString() }
  const ownLeague = access.staff ? null : report.rows.find(row => row.entrantId === access.entrantId)?.leagueId
  if (!access.staff && (!ownLeague || (leagueId && leagueId !== ownLeague))) return null
  const selected = leagueId || ownLeague
  const leagues = selected ? report.leagues.filter(league => league.id === selected) : report.leagues
  if (!leagues.length) return null
  const rows = selected ? report.rows.filter(row => row.leagueId === selected) : report.rows
  return { report, rows, leagues }
}

export function seasonReportView(result: NonNullable<Awaited<ReturnType<typeof getSeasonReport>>>) {
  const { report, rows, leagues } = result
  const { id, stage, period, revision, status, official, previousId, publishedAt, decisionId } = report
  return { id, stage, period, revision, status, official, previousId, publishedAt, decisionId, leagues,
    rows: rows.map(({ entrantId: _id, ...row }) => row), summary: seasonReportSummary(report.rows),
  }
}
