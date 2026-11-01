/** POST /api/community/reactions — toggle one reaction; returns the target's new counts. */
import { NextResponse } from 'next/server'
import { toggleReaction } from '@/lib/community/service'
import {
  communityRateLimitResponse,
  parseOr400,
  readJson,
  requireSignedIn,
  withCommunityViewer,
} from '@/lib/community/http'
import { reactionSchema } from '@/lib/community/validation'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return withCommunityViewer(async (viewer) => {
    const unauth = requireSignedIn(viewer)
    if (unauth) return unauth
    const limited = communityRateLimitResponse(viewer.userId!, 'reaction')
    if (limited) return limited
    const parsed = parseOr400(reactionSchema, await readJson(req))
    if (!parsed.ok) return parsed.res
    const reactions = await toggleReaction(viewer, parsed.data)
    return NextResponse.json({ ok: true, reactions })
  })
}
