/** POST /api/community/digest — { on: boolean } turns the weekly Clubhouse email on or off. */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { setDigestOptIn } from '@/lib/community/digestRunner'
import { communityRateLimitResponse, parseOr400, readJson, requireSignedIn, withCommunityViewer } from '@/lib/community/http'

export const dynamic = 'force-dynamic'

const schema = z.object({ on: z.boolean() })

export async function POST(req: Request) {
  return withCommunityViewer(async (viewer) => {
    const unauth = requireSignedIn(viewer)
    if (unauth) return unauth
    const limited = communityRateLimitResponse(viewer.userId!, 'edit')
    if (limited) return limited
    const parsed = parseOr400(schema, await readJson(req))
    if (!parsed.ok) return parsed.res
    return NextResponse.json({ ok: true, ...(await setDigestOptIn(viewer, parsed.data.on)) })
  })
}
