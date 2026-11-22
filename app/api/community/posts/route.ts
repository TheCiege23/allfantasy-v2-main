/**
 * POST /api/community/posts — start a Clubhouse thread. Reads are server-rendered by the
 * /clubhouse pages, so there is no GET here.
 */
import { NextResponse } from 'next/server'
import { createPost } from '@/lib/community/service'
import {
  communityRateLimitResponse,
  parseOr400,
  readJson,
  requireSignedIn,
  withCommunityViewer,
} from '@/lib/community/http'
import { createPostSchema } from '@/lib/community/validation'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return withCommunityViewer(async (viewer) => {
    const unauth = requireSignedIn(viewer)
    if (unauth) return unauth
    const limited = communityRateLimitResponse(viewer.userId!, 'post_create')
    if (limited) return limited
    const parsed = parseOr400(createPostSchema, await readJson(req))
    if (!parsed.ok) return parsed.res
    const post = await createPost(viewer, parsed.data)
    return NextResponse.json({ ok: true, id: post.id }, { status: 201 })
  })
}
