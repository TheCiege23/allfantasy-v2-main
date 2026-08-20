/**
 * GET: Post-draft manager rankings, grades, recap (PROMPT 231).
 * Deterministic; computed on-demand when draft is completed.
 * Auth: canAccessLeagueDraft.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { getDraftResults } from '@/lib/post-draft-manager-ranking'
import { maybeEnhanceDraftResultsWithAi } from '@/lib/post-draft-manager-ranking/aiExplanationService'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const payload = await getDraftResults(leagueId)
    if (!payload) {
      return NextResponse.json(
        { error: 'Draft not completed or no draft session' },
        { status: 404 }
      )
    }
    const url = new URL(req.url)
    const aiExplain = ['1', 'true', 'yes', 'on'].includes(
      (url.searchParams?.get('aiExplain') ?? '').toLowerCase()
    )
    const responsePayload = await maybeEnhanceDraftResultsWithAi(payload, aiExplain)
    return NextResponse.json(responsePayload)
  } catch (e) {
    console.error('[draft-results]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to compute draft results' },
      { status: 500 }
    )
  }
}
