import { NextRequest, NextResponse } from 'next/server'
import { createStoryApiDeps } from '@/lib/story/api/deps'
import { storyTypesHandler } from '@/lib/story/api/handlers'

export const dynamic = 'force-dynamic'

// GET /api/v1/stories/leagues/[leagueId]/types — member-readable
export async function GET(_req: NextRequest, ctx: { params: { leagueId: string } }) {
  const r = await storyTypesHandler(ctx.params.leagueId, createStoryApiDeps())
  return NextResponse.json(r.body, { status: r.status })
}
