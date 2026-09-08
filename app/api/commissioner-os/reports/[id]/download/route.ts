import { NextResponse } from 'next/server'

import { findTemplate } from '@/lib/commissioner-reports/reportCatalog'
import { readReportContent } from '@/lib/commissioner-reports/reportStore'
import { isLiveReady } from '@/lib/commissioner-ui/liveReadiness'
import { resolveActiveLeagueId } from '@/lib/commissioner-ui/resolveActiveLeagueId'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Commissioner OS · GET /api/commissioner-os/reports/[id]/download
 *
 * Serves the stored artifact.
 *
 * 🛑 A REPORT YOU CANNOT OPEN IS NOT A REPORT. Without this the history is a list of rows claiming
 * files exist, which is the same class of claim the whole module was rewritten to stop making.
 *
 * ⚠ SCOPED BY LEAGUE, NOT BY ID. The id is a uuid, but "hard to guess" is not an authorization
 * model. `readReportContent` requires the league too, and the league comes from
 * `resolveActiveLeagueId()` — the session's own commissioned set — so a report can only be fetched
 * by someone already established as commissioning the league that produced it.
 *
 * ⚠ The artifact is served from storage, never rebuilt. A CSV regenerated on download would carry
 * today's numbers under the row's original `generatedAt`, which is a different file wearing the
 * same label.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const leagueId = await resolveActiveLeagueId()
  if (!leagueId) {
    return NextResponse.json({ error: 'No commissioned league for this session.' }, { status: 403 })
  }
  if (!(await isLiveReady('reports'))) {
    return NextResponse.json({ error: 'Reports are not enabled in this environment.' }, { status: 409 })
  }

  const { id } = await context.params
  const report = await readReportContent(leagueId, id)
  if (!report) {
    /*
     * One 404 for three cases — no such report, another league's report, and a `failed` run with no
     * artifact. Distinguishing them in the response would tell an unauthorised caller that an id
     * exists, and a commissioner already sees which of their own reports failed in the history.
     */
    return NextResponse.json({ error: 'Report not found.' }, { status: 404 })
  }

  const name = findTemplate(report.templateId)?.name ?? report.templateId
  const filename = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`

  return new NextResponse(report.content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // A generated artifact is immutable, but it is also per-league private data: never let a
      // shared cache hold it.
      'Cache-Control': 'private, no-store',
    },
  })
}
