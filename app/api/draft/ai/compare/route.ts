import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { draftAiText } from '@/lib/draft/ai-claude'
import { requirePlanThenAiCostGate } from '@/lib/ai-protection/planCostGate'

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
    'You are Chimmy. Compare two players for fantasy. Reply with JSON: {"recommendation":"A|B","reasoning":"","categories":{"floor":"","ceiling":"","schedule":""}}'
  try {
    const text = await draftAiText(sys, JSON.stringify(body ?? {}), { userId: session.user.id })
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim()
    return NextResponse.json({ result: JSON.parse(cleaned) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Chimmy error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
