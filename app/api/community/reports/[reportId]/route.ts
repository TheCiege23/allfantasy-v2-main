/** PATCH /api/community/reports/:reportId — a moderator dismisses it or removes what it flagged. */
import { NextResponse } from 'next/server'
import { resolveReport } from '@/lib/community/service'
import { parseOr400, readJson, withCommunityViewer } from '@/lib/community/http'
import { resolveReportSchema } from '@/lib/community/validation'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, ctx: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await ctx.params
  return withCommunityViewer(async (viewer) => {
    const parsed = parseOr400(resolveReportSchema, await readJson(req))
    if (!parsed.ok) return parsed.res
    await resolveReport(viewer, reportId, parsed.data.action)
    return NextResponse.json({ ok: true })
  })
}
