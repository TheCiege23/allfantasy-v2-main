import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { draftAiText } from '@/lib/draft/ai-claude'
import { buildDraftAiContext, collectAiContextPlayerNames } from '@/lib/draft/ai-context'
import { loadDraftEngineGrounding } from '@/lib/draft/engineGroundingLoader'
import { ENGINE_GROUNDING_RULES } from '@/lib/draft/engineGrounding'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const sport = typeof body?.sport === 'string' ? body.sport : null
  const [enrichment, grounding] = await Promise.all([
    buildDraftAiContext({ sport, playerNames: collectAiContextPlayerNames(body) }),
    loadDraftEngineGrounding({ sessionId: body?.sessionId, userId: session.user.id, sport }),
  ])

  const sys =
    'You are Chimmy. Analyze positional scarcity, factoring in the supplied news and injury report (a star going to IR shifts scarcity). JSON: {"hotPositions":[],"recommendedAction":"","notes":"","alert":""}'
  try {
    const text = await draftAiText(
      `${sys} ${ENGINE_GROUNDING_RULES}`,
      `Draft context:\n${JSON.stringify(body ?? {})}\n${grounding.promptSection}\n${enrichment.promptSection}`,
      { userId: session.user.id },
    )
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim()
    return NextResponse.json({
      result: JSON.parse(cleaned),
      contextSources: { news: enrichment.news.length, injuries: enrichment.injuries.length, engine: grounding.available },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
