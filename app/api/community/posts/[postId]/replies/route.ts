/** POST /api/community/posts/:postId/replies — reply to a Clubhouse thread. */
import { NextResponse } from 'next/server'
import { createReply } from '@/lib/community/service'
import {
  communityRateLimitResponse,
  parseOr400,
  readJson,
  requireSignedIn,
  withCommunityViewer,
} from '@/lib/community/http'
import { replySchema } from '@/lib/community/validation'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ postId: string }> }) {
  const { postId } = await ctx.params
  return withCommunityViewer(async (viewer) => {
    const unauth = requireSignedIn(viewer)
    if (unauth) return unauth
    const limited = communityRateLimitResponse(viewer.userId!, 'reply_create')
    if (limited) return limited
    const parsed = parseOr400(replySchema, await readJson(req))
    if (!parsed.ok) return parsed.res
    const reply = await createReply(viewer, postId, parsed.data.body)
    return NextResponse.json({ ok: true, id: reply.id }, { status: 201 })
  })
}
