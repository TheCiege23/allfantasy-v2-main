/** POST /api/community/reports — flag a post or reply for the moderators. */
import { NextResponse } from 'next/server'
import { createReport } from '@/lib/community/service'
import {
  communityRateLimitResponse,
  parseOr400,
  readJson,
  requireSignedIn,
  withCommunityViewer,
} from '@/lib/community/http'
import { reportSchema } from '@/lib/community/validation'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return withCommunityViewer(async (viewer) => {
    const unauth = requireSignedIn(viewer)
    if (unauth) return unauth
    const limited = communityRateLimitResponse(viewer.userId!, 'report')
    if (limited) return limited
    const parsed = parseOr400(reportSchema, await readJson(req))
    if (!parsed.ok) return parsed.res
    await createReport(viewer, parsed.data)
    return NextResponse.json({ ok: true })
  })
}
