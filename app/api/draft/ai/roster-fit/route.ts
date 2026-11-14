import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { draftAiText } from '@/lib/draft/ai-claude'
import { buildDraftAiContext, collectAiContextPlayerNames } from '@/lib/draft/ai-context'
import { loadDraftEngineGrounding } from '@/lib/draft/engineGroundingLoader'
import { ENGINE_GROUNDING_RULES, keepAvailable } from '@/lib/draft/engineGrounding'

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
    'You are Chimmy. Pick the best roster fit, weighing the supplied news and injury report. JSON: {"bestPlayer":"","reason":"","alternatives":[{"player":"","reason":""}]}'
  try {
    const text = await draftAiText(
      `${sys} ${ENGINE_GROUNDING_RULES}`,
      `Draft state + roster:\n${JSON.stringify(body ?? {})}\n${grounding.promptSection}\n${enrichment.promptSection}`,
      { userId: session.user.id },
    )
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(cleaned) as { bestPlayer?: unknown; alternatives?: Array<{ player?: unknown }> }
    // A "best fit" who is not on the board is not advice; fall back to the engine's top choice.
    const bestOnBoard = keepAvailable([parsed?.bestPlayer], (n) => n, grounding).length > 0
    const alternatives = keepAvailable(parsed?.alternatives, (a) => a?.player, grounding)
    const result =
      bestOnBoard || !grounding.topPick
        ? { ...parsed, alternatives }
        : { ...parsed, bestPlayer: grounding.topPick.player, reason: grounding.topPick.reason, alternatives }
    return NextResponse.json({
      result,
      contextSources: { news: enrichment.news.length, injuries: enrichment.injuries.length, engine: grounding.available },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
