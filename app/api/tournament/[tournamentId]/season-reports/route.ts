import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { getSeasonReport, getSeasonReportAccess, listSeasonReportVersions, seasonReportView } from '@/lib/tournament/seasonReportAccess'
import { deliverSeasonReport, seasonReportAudience } from '@/lib/tournament/seasonReportChat'
import { seasonReportCsv } from '@/lib/tournament/seasonReportFormat'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }
type Context = { params: Promise<{ tournamentId: string }> }
const id = z.string().min(1).max(200)
const requestSchema = z.object({ reportId: id, audience: seasonReportAudience }).strict()

export async function GET(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers })
  const { tournamentId } = await context.params
  const access = await getSeasonReportAccess(tournamentId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Report not found.' }, { status: 404, headers })
  const params = request.nextUrl.searchParams
  if (params.get('live') === '1') {
    const { loadSeasonLiveCut } = await import('@/lib/tournament/seasonLiveCut')
    return NextResponse.json({ cut: await loadSeasonLiveCut(tournamentId, access) }, { headers })
  }
  const reportId = params.get('reportId')
  const leagueId = params.get('leagueId')
  const format = params.get('format')
  if (reportId === null && leagueId === null && format === null) {
    return NextResponse.json({ reports: await listSeasonReportVersions(tournamentId, access), canPost: access.canPost }, { headers })
  }
  if (!id.safeParse(reportId).success || (leagueId !== null && !id.safeParse(leagueId).success) || (format !== null && format !== 'csv')) {
    return NextResponse.json({ error: 'Choose a report and supported format.' }, { status: 400, headers })
  }
  const result = await getSeasonReport(tournamentId, reportId!, access, leagueId ?? undefined)
  if (!result) return NextResponse.json({ error: 'Report not found.' }, { status: 404, headers })
  if (format === 'csv') {
    const { report, rows } = result
    return new Response(seasonReportCsv(report, rows), { headers: {
      ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'attachment; filename="stage-' + report.stage + '-period-' + report.period + '-v' + report.revision + '.csv"',
    } })
  }
  return NextResponse.json(seasonReportView(result), { headers })
}

export async function POST(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers })
  const { tournamentId } = await context.params
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose a report and a valid chat audience.' }, { status: 400, headers })
  const { reportId, audience } = parsed.data
  try {
    const result = await deliverSeasonReport(tournamentId, reportId, audience, new Date(), session.user.id)
    return result.ok ? NextResponse.json(result, { headers }) : NextResponse.json({ error: result.error }, { status: result.status, headers })
  } catch {
    return NextResponse.json({ error: 'Chat delivery could not be confirmed. Retry this version.' }, { status: 503, headers })
  }
}
