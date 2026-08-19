import { NextRequest, NextResponse } from 'next/server'
import { createStoryApiDeps } from '@/lib/story/api/deps'
import { storyPreviewHandler } from '@/lib/story/api/handlers'

export const dynamic = 'force-dynamic'

// GET /api/v1/stories/leagues/[leagueId]/preview?type=<storyType>
export async function GET(req: NextRequest, ctx: { params: { leagueId: string } }) {
  const type = new URL(req.url).searchParams.get('type')
  const r = await storyPreviewHandler(ctx.params.leagueId, type, createStoryApiDeps())
  return NextResponse.json(r.body, { status: r.status })
}
