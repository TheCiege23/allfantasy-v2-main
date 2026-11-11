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
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'

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
    const aiExplainRequested = ['1', 'true', 'yes', 'on'].includes(
      (url.searchParams?.get('aiExplain') ?? '').toLowerCase()
    )
    /*
     * Draft Rankings (`draft_rankings`, AF Commissioner) is the AI read of these rankings. The rankings
     * themselves are deterministic and stay free; the AI explanations ran OpenAI for anyone who added
     * `?aiExplain=1`. Without the plan they are skipped and `aiExplainLocked` says why.
     */
    let aiExplainLocked: { message: string; upgradePath: string | null } | null = null
    if (aiExplainRequested) {
      const plan = await requireFeatureEntitlement({
        userId,
        userEmail: (session?.user as { email?: string | null } | undefined)?.email ?? null,
        featureId: 'draft_rankings',
      })
      if (!plan.ok) {
        const refusal = (await plan.response.json().catch(() => ({}))) as Record<string, unknown>
        aiExplainLocked = {
          message:
            typeof refusal.message === 'string' && refusal.message.trim()
              ? refusal.message
              : 'AI draft rankings explanations are part of AF Commissioner.',
          upgradePath: typeof refusal.upgradePath === 'string' ? refusal.upgradePath : null,
        }
      }
    }
    const responsePayload = await maybeEnhanceDraftResultsWithAi(payload, aiExplainRequested && !aiExplainLocked)
    return NextResponse.json({ ...responsePayload, aiExplainLocked })
  } catch (e) {
    console.error('[draft-results]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to compute draft results' },
      { status: 500 }
    )
  }
}
