import { NextResponse, type NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { searchYouTubeMusic } from '@/lib/app-music/youtubeSearch'

export const dynamic = 'force-dynamic'

/**
 * GET /api/music/youtube-search?q=… — YouTube search for the chat panel's Music tab.
 *
 * Always 200 with a `status` the panel can say out loud:
 *   ok          — `results` (possibly empty)
 *   limit       — `scope` 'user' (your 20 for today) or 'app' (music's share of
 *                 YouTube's daily allowance); stations and pasted links still work
 *   unavailable — YouTube or our budget store did not answer
 * 401 — signed out (production only; local previews have no session).
 *
 * The limits, the cache and why they exist are in lib/app-music/youtubeSearch.ts.
 */
export async function GET(req: NextRequest) {
  let userId = 'local-preview'
  if (process.env.NODE_ENV === 'production') {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    userId = session.user.id
  }

  const q = req.nextUrl.searchParams.get('q') ?? ''
  const outcome = await searchYouTubeMusic(q, userId)
  return NextResponse.json(outcome, { headers: { 'Cache-Control': 'private, no-store' } })
}
