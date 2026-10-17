import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueAccess } from '@/lib/ai/league-settings-ai/access'
import { callClaudeJson } from '@/lib/ai/league-settings-ai/claude'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import { buildLeagueContext } from '@/lib/league/buildLeagueContext'
import { evaluateTrade } from '@/lib/decision-os/trade/evaluateTrade'
import { receiptGradeFields } from '@/lib/decision-os/trade/receiptViews'
import { gradeInputsFromAssetLabels } from '@/lib/decision-os/trade/tradeGradeInputs'

export const dynamic = 'force-dynamic'

type Side = { name?: string; playerId?: string; pos?: string; team?: string }

/**
 * 🛑 THE GRADE IS THE ONE TRADE ENGINE'S (2026-09-29). The league settings "AI trade" panel prints this
 * response as-is, and it used to carry a Win / Loss / Fair verdict and a fairness score from
 * `runTradeAnalysis` (lib/engine/trade) — a scale no other trade screen uses, beside a Trade Center that
 * grades the same deal with a letter. Now `evaluateTrade()` grades it in this league, with a receipt,
 * and the model only writes prose ABOUT that grade. Its own verdict or fairness keys are never passed on.
 *
 * `viewerSide: false`: the panel takes names typed as "you give", which proves nothing about whose
 * roster they are on, so roster need is not priced — the same call the dynasty analyzer makes.
 */
function gradeInputs(side: Side[]) {
  // Untyped, so "2026 1st" typed into the box reads as a pick rather than a player search.
  return gradeInputsFromAssetLabels(side.map((s) => ({ name: (s.name ?? s.playerId ?? '').trim(), type: null })))
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Claude on every call; the sibling /api/trade-evaluator already required trade_analyzer.
  const gated = await aiCostGate(req, 'trade_ai', userId)
  if (gated) return gated

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
  // Only a league the caller commissions or has a team in is graded in; anything else is withheld.
  let gradeLeagueId: string | null = null
  if (body.leagueId) {
    const league = await assertLeagueAccess(body.leagueId, userId)
    if (league) {
      gradeLeagueId = league.id
      leagueBlock = `League: ${league.name ?? league.id}\nSport: ${league.sport}\nPlatform: ${league.platform}\n`
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

  // Never throws: a grade that cannot be taken is a withheld grade with the reason.
  const receipt = await evaluateTrade({
    surface: 'league-settings-ai-trade',
    leagueId: gradeLeagueId,
    userId,
    give: gradeInputs(give),
    get: gradeInputs(get),
    viewerSide: false,
  })
  const tradeGrade = receiptGradeFields(receipt)

  // No letter, no prose: a narrative with no grade under it would be the model's own verdict.
  if (!tradeGrade.grade) {
    return NextResponse.json({ ok: true, tradeGrade, shortTerm: null, longTerm: null, advice: null, narrativeSource: 'not_graded' })
  }

  const system = `You are Chimmy, AllFantasy's trade analyst. AllFantasy's trade grade has ALREADY graded this trade. Your job is to explain that grade in plain language — never to re-decide it.

THE GRADE (authoritative, do not contradict or restate differently):
- The trading manager's letter: ${tradeGrade.grade} (the other side: ${tradeGrade.partnerGrade})
- ${tradeGrade.gradeLabel ?? ''}${tradeGrade.recommendation ? ` — ${tradeGrade.recommendation}` : ''}

Respond with ONLY valid JSON (no markdown):
{"shortTerm":string,"longTerm":string,"advice":string}
Keep each field concise and consistent with the grade above. Do NOT output a verdict, a letter, a fairness number, or any contradicting judgement.
${historyBlock ? `\n\nLEAGUE HISTORY (context for tone and leverage only):\n${historyBlock}` : ''}`

  const userPayload = `${leagueBlock}You give up: ${JSON.stringify(give)}
You receive: ${JSON.stringify(get)}`

  try {
    const raw = (await callClaudeJson({ system, user: userPayload, userId })) as Record<string, unknown>
    // Only the three prose fields are read, so no verdict, letter or fairness key the model adds is passed on.
    return NextResponse.json({
      ok: true,
      tradeGrade,
      shortTerm: typeof raw.shortTerm === 'string' ? raw.shortTerm : null,
      longTerm: typeof raw.longTerm === 'string' ? raw.longTerm : null,
      advice: typeof raw.advice === 'string' ? raw.advice : null,
      narrativeSource: 'ai',
    })
  } catch (e) {
    // Prose failed, but the grade is still real — return it without narrative.
    console.error('[api/ai/trade-analysis] narrative generation failed', e)
    return NextResponse.json({ ok: true, tradeGrade, shortTerm: null, longTerm: null, advice: null, narrativeSource: 'unavailable' })
  }
}
