/**
 * GET  /api/community/posts/:postId/replies?after=ISO — replies since `after`, for the
 *      polling game-day chat. Public, like the thread page it mirrors.
 * POST /api/community/posts/:postId/replies — reply to a Clubhouse thread.
 */
import { NextResponse } from 'next/server'
import { createReply, listRepliesSince } from '@/lib/community/service'
import {
  communityRateLimitResponse,
  parseOr400,
  readJson,
  requireSignedIn,
  withCommunityViewer,
} from '@/lib/community/http'
import { replySchema } from '@/lib/community/validation'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ postId: string }> }) {
  const { postId } = await ctx.params
  const after = new URL(req.url).searchParams.get('after')
  return withCommunityViewer(async (viewer) => {
    const messages = await listRepliesSince(viewer, postId, after)
    return NextResponse.json({ ok: true, messages }, { headers: { 'Cache-Control': 'no-store' } })
  })
}

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
