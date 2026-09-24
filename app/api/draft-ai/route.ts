/**
 * POST /api/draft-ai — Draft AI Assistant (PROMPT 240).
 * Deterministic: best available player, roster needs. AI optional: explanation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runDraftAIAssist } from '@/lib/draft-ai-engine'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import { resolveSportForAI } from '@/lib/ai/AISportContextResolver'
import { buildDraftRecommendationContext } from '@/lib/ai/SportAwareRecommendationService'
import { resolveSportVariantContext } from '@/lib/league-defaults-orchestrator/SportVariantContextResolver'
import { assertLeagueMember } from '@/lib/league-access'
import { logAiOutput } from '@/lib/ai/output-logger'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gated = await aiCostGate(req, 'draft_ai', session.user.id)
  if (gated) return gated

  const body = await req.json().catch(() => ({}))
  const available = Array.isArray(body.available) ? body.available : []
  const teamRoster = Array.isArray(body.teamRoster) ? body.teamRoster : []
  const rosterSlots = Array.isArray(body.rosterSlots) ? body.rosterSlots : []
  const round = Math.max(1, Number(body.round) || 1)
  const pick = Math.max(1, Number(body.pick) || 1)
  const totalTeams = Math.max(2, Math.min(24, Number(body.totalTeams) || 12))
  const leagueVariant =
    typeof body.leagueVariant === 'string'
      ? body.leagueVariant
      : typeof body.league_variant === 'string'
        ? body.league_variant
        : null
  const variantContext = resolveSportVariantContext(resolveSportForAI(body as Record<string, unknown>), leagueVariant)
  const sport = variantContext.sport
  const isDynasty = Boolean(body.isDynasty)
  const isSF = Boolean(body.isSF)
  const isIdp = variantContext.isFootballIdp || variantContext.isNflIdp || Boolean(body.idp) || Boolean(body.is_idp)
  const mode: 'bpa' | 'needs' = body.mode === 'bpa' ? 'bpa' : 'needs'
  const aiAdpByKey = body.aiAdpByKey && typeof body.aiAdpByKey === 'object' ? body.aiAdpByKey : undefined
  const byeByKey = body.byeByKey && typeof body.byeByKey === 'object' ? body.byeByKey : undefined
  const explanation = Boolean(body.explanation)
  const leagueId = body.leagueId ?? undefined

  if (typeof leagueId === 'string' && leagueId.trim().length > 0) {
    try {
      await assertLeagueMember(leagueId, session.user.id)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const normalized = available.slice(0, 200).map((p: Record<string, unknown>) => ({
    name: String(p.name ?? p.playerName ?? ''),
    position: String(p.position ?? ''),
    team: p.team ?? null,
    adp: p.adp ?? p.rank ?? null,
    byeWeek: p.byeWeek ?? null,
  }))

  const input = {
    available: normalized,
    teamRoster,
    rosterSlots,
    round,
    pick,
    totalTeams,
    sport,
    isDynasty,
    isSF,
    mode,
    aiAdpByKey,
    byeByKey:
      byeByKey ??
      (normalized.length
        ? Object.fromEntries(
            normalized
              .filter((p: { byeWeek?: number | null }) => p.byeWeek != null)
              .map((p: { name: string; position: string; team: string | null; byeWeek: number }) => [
                `${(p.name || '').toLowerCase()}|${(p.position || '').toLowerCase()}|${(p.team || '').toLowerCase()}`,
                p.byeWeek,
              ])
          )
        : undefined),
  }

  const result = await runDraftAIAssist(input, {
    explanation,
    sport,
    idp: isIdp,
    recommendationContext: buildDraftRecommendationContext({
      sport,
      format: isDynasty ? 'dynasty' : 'redraft',
      superflex: isSF,
      idp: isIdp,
      numTeams: totalTeams,
      leagueName: typeof body.leagueName === 'string' ? body.leagueName : undefined,
    }),
    leagueId,
  })

  await logAiOutput({
    provider: 'openai',
    role: 'narrative',
    taskType: 'draft_helper',
    targetType: 'user',
    targetId: session.user.id,
    contentJson: {
      recommendation: result.recommendation.recommendation,
      alternatives: result.recommendation.alternatives,
      explanation: result.explanation ?? result.recommendation.explanation,
    },
    meta: {
      leagueId: typeof leagueId === 'string' ? leagueId : null,
      sport,
      isDynasty,
      isSF,
      idp: isIdp,
      mode,
      totalTeams,
    },
  })

  return NextResponse.json({
    ok: true,
    recommendation: result.recommendation.recommendation,
    alternatives: result.recommendation.alternatives,
    reachWarning: result.recommendation.reachWarning,
    valueWarning: result.recommendation.valueWarning,
    scarcityInsight: result.recommendation.scarcityInsight,
    byeNote: result.recommendation.byeNote,
    explanation: result.explanation ?? result.recommendation.explanation,
    caveats: result.recommendation.caveats,
  })
}
