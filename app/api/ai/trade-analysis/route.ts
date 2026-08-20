import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueAccess } from '@/lib/ai/league-settings-ai/access'
import { callClaudeJson } from '@/lib/ai/league-settings-ai/claude'
import { buildLeagueContext } from '@/lib/league/buildLeagueContext'
import { runTradeAnalysis } from '@/lib/engine/trade'
import type { TradeAssetUnion, LeagueFormat, SportKey } from '@/lib/engine/trade-types'

export const dynamic = 'force-dynamic'

type Side = { name?: string; playerId?: string; pos?: string; team?: string }

/**
 * HONESTY PASS (slice 12): this route used to ask the LLM for a
 * Win / Loss / Fair verdict from nothing but player NAMES — no valuation, no
 * projections, no roster context. The verdict was language, not analysis.
 *
 * Now the deterministic engine (`runTradeAnalysis`, the same one behind
 * /api/trades/analyze) produces the verdict and fairness, and the model is
 * restricted to writing prose ABOUT that verdict — the pattern
 * TradeAnalyzerAIService already established ("do not override the fairness
 * score"). Every field is tagged with its source so no consumer can confuse
 * a computed number with generated text.
 */
function toEngineAssets(side: Side[]): TradeAssetUnion[] {
  return side
    .filter((s) => (s.name ?? s.playerId ?? '').trim().length > 0)
    .map((s) => ({
      type: 'player' as const,
      player: {
        id: (s.playerId ?? s.name ?? '').trim(),
        name: (s.name ?? s.playerId ?? '').trim(),
        ...(s.pos ? { pos: s.pos } : {}),
        ...(s.team ? { team: s.team } : {}),
      },
    }))
}

const VERDICT_LABEL: Record<string, string> = {
  accept: 'Win',
  reject: 'Loss',
  counter: 'Fair',
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { leagueId?: string; give?: Side[]; get?: Side[] }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const give = Array.isArray(body.give) ? body.give : []
  const get = Array.isArray(body.get) ? body.get : []
  if (give.length === 0 && get.length === 0) {
    return NextResponse.json({ error: 'give and get arrays cannot both be empty' }, { status: 400 })
  }

  let leagueBlock = ''
  let historyBlock = ''
  let sport: SportKey = 'NFL'
  let format: LeagueFormat = 'redraft'
  if (body.leagueId) {
    const league = await assertLeagueAccess(body.leagueId, userId)
    if (league) {
      leagueBlock = `League: ${league.name ?? league.id}\nSport: ${league.sport}\nPlatform: ${league.platform}\n`
      const rawSport = String(league.sport ?? '').toUpperCase()
      if (['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'].includes(rawSport)) {
        sport = rawSport as SportKey
      }
      if ((league as { isDynasty?: boolean }).isDynasty) format = 'dynasty'
      try {
        historyBlock = await buildLeagueContext(
          body.leagueId,
          give[0]?.name ?? give[0]?.playerId,
        )
      } catch {
        historyBlock = ''
      }
    }
  }

  // Deterministic first. The engine owns the verdict; a failure here means we
  // report that we could not evaluate — never that we fall back to guessing.
  let engine: Awaited<ReturnType<typeof runTradeAnalysis>> | null = null
  try {
    engine = await runTradeAnalysis({
      sport,
      format,
      assetsA: toEngineAssets(give),
      assetsB: toEngineAssets(get),
      ...(body.leagueId ? { leagueId: body.leagueId, league_id: body.leagueId } : {}),
    })
  } catch (e) {
    console.error('[api/ai/trade-analysis] deterministic engine failed', e)
    engine = null
  }

  if (!engine) {
    return NextResponse.json(
      {
        ok: false,
        verdict: null,
        verdictSource: 'unavailable',
        error: 'Could not evaluate this trade — the valuation engine had no usable data for these assets.',
      },
      { status: 422 },
    )
  }

  const deterministicVerdict = VERDICT_LABEL[engine.verdict] ?? 'Fair'
  const fairnessScore = engine.fairness?.score ?? null

  const system = `You are Chimmy, AllFantasy's trade analyst. A deterministic valuation engine has ALREADY graded this trade. Your job is to explain that grade in plain language — never to re-decide it.

DETERMINISTIC RESULT (authoritative, do not contradict or restate differently):
- Verdict from the trading manager's perspective: ${deterministicVerdict}
- Fairness score: ${fairnessScore ?? 'unavailable'}
${engine.fairness?.explanations?.length ? `- Engine reasoning: ${engine.fairness.explanations.slice(0, 4).join('; ')}` : ''}

Respond with ONLY valid JSON (no markdown):
{"shortTerm":string,"longTerm":string,"recommendation":string}
Keep each field concise and consistent with the verdict above. Do NOT output a verdict field, a different fairness number, or any contradicting judgement.
${historyBlock ? `\n\nLEAGUE HISTORY (context for tone and leverage only):\n${historyBlock}` : ''}`

  const userPayload = `${leagueBlock}You give up: ${JSON.stringify(give)}
You receive: ${JSON.stringify(get)}`

  try {
    const raw = (await callClaudeJson({ system, user: userPayload, userId })) as Record<string, unknown>
    // The model cannot override the engine: its verdict/fairness keys are dropped.
    delete raw.verdict
    delete raw.fairness
    delete raw.fairnessScore
    return NextResponse.json({
      ok: true,
      verdict: deterministicVerdict,
      verdictSource: 'deterministic_engine',
      fairnessScore,
      fairnessConfidence: engine.fairness?.confidence ?? null,
      shortTerm: typeof raw.shortTerm === 'string' ? raw.shortTerm : null,
      longTerm: typeof raw.longTerm === 'string' ? raw.longTerm : null,
      recommendation: typeof raw.recommendation === 'string' ? raw.recommendation : null,
      narrativeSource: 'ai',
    })
  } catch (e) {
    // Prose failed, but the deterministic verdict is still real — return it
    // without narrative rather than failing the whole request.
    console.error('[api/ai/trade-analysis] narrative generation failed', e)
    return NextResponse.json({
      ok: true,
      verdict: deterministicVerdict,
      verdictSource: 'deterministic_engine',
      fairnessScore,
      fairnessConfidence: engine.fairness?.confidence ?? null,
      shortTerm: null,
      longTerm: null,
      recommendation: null,
      narrativeSource: 'unavailable',
    })
  }
}
