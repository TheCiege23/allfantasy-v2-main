/**
 * POST /api/community/ideas — pitch a League Lab idea with the short form. The board is
 * server-rendered by /clubhouse/league-lab, so there is no GET here.
 */
import { NextResponse } from 'next/server'
import { createIdea } from '@/lib/community/service'
import { communityRateLimitResponse, readJson, requireSignedIn, withCommunityViewer } from '@/lib/community/http'
import { createIdeaSchema, ideaIssueMessage } from '@/lib/community/ideas'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return withCommunityViewer(async (viewer) => {
    const unauth = requireSignedIn(viewer)
    if (unauth) return unauth
    const limited = communityRateLimitResponse(viewer.userId!, 'post_create')
    if (limited) return limited
    const parsed = createIdeaSchema.safeParse(await readJson(req))
    if (!parsed.success) return NextResponse.json({ error: ideaIssueMessage(parsed.error) }, { status: 400 })
    const idea = await createIdea(viewer, parsed.data)
    return NextResponse.json({ ok: true, id: idea.id }, { status: 201 })
  })
}
