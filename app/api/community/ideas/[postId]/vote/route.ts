/** POST /api/community/ideas/:postId/vote — toggle the viewer's upvote on an idea. */
import { NextResponse } from 'next/server'
import { toggleIdeaVote } from '@/lib/community/service'
import { communityRateLimitResponse, requireSignedIn, withCommunityViewer } from '@/lib/community/http'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ postId: string }> }

export async function POST(_req: Request, ctx: Ctx) {
  const { postId } = await ctx.params
  return withCommunityViewer(async (viewer) => {
    const unauth = requireSignedIn(viewer)
    if (unauth) return unauth
    const limited = communityRateLimitResponse(viewer.userId!, 'reaction')
    if (limited) return limited
    const result = await toggleIdeaVote(viewer, postId)
    return NextResponse.json({ ok: true, ...result })
  })
}
