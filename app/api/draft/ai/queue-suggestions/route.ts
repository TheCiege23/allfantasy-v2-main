import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { draftAiText } from '@/lib/draft/ai-claude'
import { requirePlanThenAiCostGate } from '@/lib/ai-protection/planCostGate'
import { loadDraftEngineGrounding } from '@/lib/draft/engineGroundingLoader'
import { ENGINE_GROUNDING_RULES, keepAvailable } from '@/lib/draft/engineGrounding'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string; email?: string | null } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // AF Pro / AF Supreme, then the shared daily cap, before any model call (owner, 2026-11-28).
  const gated = await requirePlanThenAiCostGate(req, {
    userId: session.user.id,
    email: session.user.email,
    featureId: 'pro_draft_ai',
    capKey: 'draft_ai_tools',
  })
  if (gated) return gated

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const sys =
    'You are Chimmy. Suggest a priority queue. JSON: {"queue":[{"player":"","position":"","reason":""}]}'
  try {
    const grounding = await loadDraftEngineGrounding({
      sessionId: body?.sessionId,
      userId: session.user.id,
      sport: typeof body?.sport === 'string' ? body.sport : null,
    })
    const text = await draftAiText(
      `${sys} ${ENGINE_GROUNDING_RULES}`,
      `${JSON.stringify(body ?? {})}\n${grounding.promptSection}`,
      { userId: session.user.id },
    )
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(cleaned) as { queue?: Array<{ player?: unknown }> }
    return NextResponse.json({
      result: { ...parsed, queue: keepAvailable(parsed?.queue, (q) => q?.player, grounding) },
      contextSources: { engine: grounding.available },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Chimmy error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
