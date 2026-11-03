/** PATCH /api/community/ideas/:postId/status — staff set Under review / Building / Shipped (or clear it). */
import { NextResponse } from 'next/server'
import { setIdeaStatus } from '@/lib/community/service'
import { parseOr400, readJson, requireSignedIn, withCommunityViewer } from '@/lib/community/http'
import { ideaStatusSchema } from '@/lib/community/ideas'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ postId: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  const { postId } = await ctx.params
  return withCommunityViewer(async (viewer) => {
    const unauth = requireSignedIn(viewer)
    if (unauth) return unauth
    const parsed = parseOr400(ideaStatusSchema, await readJson(req))
    if (!parsed.ok) return parsed.res
    await setIdeaStatus(viewer, postId, parsed.data.status)
    return NextResponse.json({ ok: true })
  })
}
