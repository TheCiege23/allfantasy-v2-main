import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { draftAiText } from '@/lib/draft/ai-claude'
import { buildDraftAiContext, collectAiContextPlayerNames } from '@/lib/draft/ai-context'
import { loadDraftEngineGrounding } from '@/lib/draft/engineGroundingLoader'
import { ENGINE_GROUNDING_RULES, engineBestPickFallback, keepAvailable } from '@/lib/draft/engineGrounding'

export const dynamic = 'force-dynamic'

const SYS = `You are Chimmy, AllFantasy's AI draft assistant. Weigh the supplied news and injury report when ranking. Reply with JSON only: {"recommendations":[{"player":"","reason":""}],"summary":""} with top 3 picks. Reasons should reference the latest news/injury context when it is relevant.`

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
  const contextSources = { news: enrichment.news.length, injuries: enrichment.injuries.length, engine: grounding.available }
  const fallback = engineBestPickFallback(grounding)

  const ctx = JSON.stringify(body ?? {})
  try {
    const text = await draftAiText(
      `${SYS} ${ENGINE_GROUNDING_RULES}`,
      `Draft context (state, picks, queue, etc.):\n${ctx}\n${grounding.promptSection}\n${enrichment.promptSection}`,
      { userId: session.user.id },
    )
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(cleaned) as { recommendations?: Array<{ player?: unknown }>; summary?: unknown }
    // Whatever the prompt said, a player who is not on the board is not a recommendation.
    const recommendations = keepAvailable(parsed?.recommendations, (r) => r?.player, grounding)
    if (recommendations.length === 0 && fallback) return NextResponse.json({ result: fallback, contextSources, source: 'engine' })
    return NextResponse.json({ result: { ...parsed, recommendations }, contextSources })
  } catch (e) {
    // Claude down or unparseable: the engine's own pick is still a real answer.
    if (fallback) return NextResponse.json({ result: fallback, contextSources, source: 'engine' })
    const msg = e instanceof Error ? e.message : 'AI error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
