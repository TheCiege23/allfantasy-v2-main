/**
 * PATCH  /api/community/posts/:postId — the author edits ({ title, body, tags }), or a
 *        moderator acts ({ action: pin|unpin|lock|unlock|remove|restore }).
 * DELETE /api/community/posts/:postId — the author or a moderator takes it down.
 */
import { NextResponse } from 'next/server'
import { deletePost, editPost, moderatePost } from '@/lib/community/service'
import {
  communityRateLimitResponse,
  parseOr400,
  readJson,
  requireSignedIn,
  withCommunityViewer,
} from '@/lib/community/http'
import { editPostSchema, moderatePostSchema } from '@/lib/community/validation'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ postId: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  const { postId } = await ctx.params
  return withCommunityViewer(async (viewer) => {
    const unauth = requireSignedIn(viewer)
    if (unauth) return unauth
    const limited = communityRateLimitResponse(viewer.userId!, 'edit')
    if (limited) return limited
    const raw = await readJson(req)
    if (raw && typeof raw === 'object' && 'action' in raw) {
      const parsed = parseOr400(moderatePostSchema, raw)
      if (!parsed.ok) return parsed.res
      await moderatePost(viewer, postId, parsed.data.action)
      return NextResponse.json({ ok: true })
    }
    const parsed = parseOr400(editPostSchema, raw)
    if (!parsed.ok) return parsed.res
    await editPost(viewer, postId, parsed.data)
    return NextResponse.json({ ok: true })
  })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { postId } = await ctx.params
  return withCommunityViewer(async (viewer) => {
    await deletePost(viewer, postId)
    return NextResponse.json({ ok: true })
  })
}
