import { NextResponse } from "next/server"
import { z } from "zod"
import { requireWorldCupApiUser } from "../../../_utils"
import { loadMatchupEvidence, CoachAccessError } from "@/lib/playoffs/bracketCoachService"
import { withPaidToolBilling, paidToolNotDelivered } from "@/lib/tokens/paidToolBilling"
import { requireFeatureEntitlement } from "@/lib/subscription/entitlement-middleware"
import { consumeSharedRateLimit } from "@/lib/security/sharedRateLimit"
import { runUnifiedOrchestration } from "@/lib/ai-orchestration"
import { requestContractToUnified } from "@/lib/ai-tool-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const schema = z.object({ seriesId: z.string().min(1).max(128), generate: z.boolean().default(false), confirmTokenSpend: z.boolean().default(false), locale: z.enum(["en", "es"]).default("en") })
async function handle(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response
  const body = schema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: "Invalid matchup request" }, { status: 400 })
  const { challengeId } = await context.params
  try {
    const { view, evidence } = await loadMatchupEvidence({ challengeId, seriesId: body.data.seriesId, user: auth.user, locale: body.data.locale })
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" }
    if (!body.data.generate) return NextResponse.json({ evidence, generative: false, analysis: null }, { headers })
    const daily = await consumeSharedRateLimit(`bracket-coach-ai:${auth.user.id}:${new Date().toISOString().slice(0, 10)}`, 30, 86400)
    if (!daily.success) return NextResponse.json({ error: "Today's matchup analysis limit is reached. Your verified facts remain available." }, { status: 429, headers })
    const gate = await requireFeatureEntitlement({ userId: auth.user.id, userEmail: auth.user.email, featureId: "league_ai_coaching", allowTokenFallback: true,
      tokenRuleCode: "ai_chimmy_chat_message", confirmTokenSpend: body.data.confirmTokenSpend,
      tokenSourceType: "bracket_matchup_coach", tokenSourceId: `${challengeId}:${body.data.seriesId}`, tokenDescription: "Chimmy bracket matchup analysis" })
    if (!gate.ok) return gate.response
    const prompt = `Explain this bracket matchup in ${body.data.locale === "es" ? "Spanish" : "English"}. Give the evidence-backed lean, supporting facts, biggest risk and a short action. The supplied recommendation is a limited deterministic lean, never a calibrated win probability. If it is null, say there is no clear recommendation. Never invent injuries, lineups, probabilities, news, stats or qualifying teams. Data gaps must stay explicit. Injury reports do not prove lineup impact. Explain available form, rest interval and qualification stakes. Never place, change or finalize picks.`
    const unified = requestContractToUnified({ tool: "chimmy_chat", sport: view.challenge.sport === "nba_cup" ? "NBA" : view.challenge.sport.toUpperCase(),
      userMessage: prompt, userId: auth.user.id, aiMode: "single_model", deterministicContext: { tournament: view.challenge.sport, season: view.challenge.seasonYear, matchup: evidence } }, auth.user.id)
    unified.envelope.hardConstraints = [...(unified.envelope.hardConstraints ?? []), "Only the supplied matchup evidence is authoritative. Do not replace the supplied lean or turn it into win odds."]
    unified.options = { timeoutMs: 20000, maxRetries: 0 }
    const result = await runUnifiedOrchestration(unified)
    if (!result.ok) return NextResponse.json({ error: result.error.userMessage || "Chimmy is temporarily unavailable", evidence }, { status: result.status, headers })
    const generative = !result.response.reliability.usedDeterministicFallback && !result.response.reliability.hardViolation &&
      Boolean(result.response.primaryAnswer.trim()) && !/\d+(?:\.\d+)?\s*%/.test(result.response.primaryAnswer)
    if (!generative) paidToolNotDelivered()
    return NextResponse.json({ evidence, generative, analysis: generative ? result.response.primaryAnswer : null,
      uncertainty: result.response.uncertaintyExplanation ?? null, traceId: result.response.traceId }, { headers })
  } catch (error) {
    return NextResponse.json({ error: error instanceof CoachAccessError ? error.message : "Matchup analysis is temporarily unavailable. Your picks were not changed." },
      { status: error instanceof CoachAccessError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } })
  }
}
export const POST = withPaidToolBilling(handle)
