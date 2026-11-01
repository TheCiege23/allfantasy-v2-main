/**
 * PATCH  /api/community/replies/:replyId — the author edits ({ body }).
 * DELETE /api/community/replies/:replyId — the author or a moderator takes it down.
 */
import { NextResponse } from 'next/server'
import { deleteReply, editReply } from '@/lib/community/service'
import {
  communityRateLimitResponse,
  parseOr400,
  readJson,
  requireSignedIn,
  withCommunityViewer,
} from '@/lib/community/http'
import { replySchema } from '@/lib/community/validation'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ replyId: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  const { replyId } = await ctx.params
  return withCommunityViewer(async (viewer) => {
    const unauth = requireSignedIn(viewer)
    if (unauth) return unauth
    const limited = communityRateLimitResponse(viewer.userId!, 'edit')
    if (limited) return limited
    const parsed = parseOr400(replySchema, await readJson(req))
    if (!parsed.ok) return parsed.res
    await editReply(viewer, replyId, parsed.data.body)
    return NextResponse.json({ ok: true })
  })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { replyId } = await ctx.params
  return withCommunityViewer(async (viewer) => {
    await deleteReply(viewer, replyId)
    return NextResponse.json({ ok: true })
  })
}
