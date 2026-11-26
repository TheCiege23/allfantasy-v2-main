/**
 * POST /api/community/ideas/:postId/plan — starts the staff build plan for an idea.
 *
 * The idea form calls it once the files are uploaded, so the plan reads them; staff call it from
 * the idea page to write a fresh plan. The work runs after the response (`after`), so neither
 * waits on Chimmy. If this never arrives — a closed tab, a deploy — the cron sweep picks it up.
 */
import { NextResponse, after } from 'next/server'
import { generateIdeaPlan, requestIdeaPlan } from '@/lib/community/ideaPlanRunner'
import { communityRateLimitResponse, requireSignedIn, withCommunityViewer } from '@/lib/community/http'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ postId: string }> }

export async function POST(_req: Request, ctx: Ctx) {
  const { postId } = await ctx.params
  return withCommunityViewer(async (viewer) => {
    const unauth = requireSignedIn(viewer)
    if (unauth) return unauth
    const limited = communityRateLimitResponse(viewer.userId!, 'edit')
    if (limited) return limited
    const { force } = await requestIdeaPlan(viewer, postId)
    after(async () => {
      await generateIdeaPlan(postId, { force })
    })
    return NextResponse.json({ ok: true, queued: true }, { status: 202 })
  })
}
