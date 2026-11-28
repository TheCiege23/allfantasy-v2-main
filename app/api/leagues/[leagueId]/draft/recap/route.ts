/**
 * POST: Generate AI draft recap for a completed draft.
 * Auth: canAccessLeagueDraft.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { openaiChatText } from '@/lib/openai-client'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import { getProviderStatus } from '@/lib/provider-config'
import {
  buildDraftExecutionMetadata,
  evaluateAIInvocationPolicy,
  withTimeout,
} from '@/lib/draft-automation-policy'
import { buildDeterministicPostDraftRecap, type PostDraftRecapSections } from '@/lib/post-draft'
import {
  API_CACHE_TTL,
  dedupeInFlight,
  getApiCached,
  setApiCached,
} from '@/lib/api-performance'

export const dynamic = 'force-dynamic'
const DRAFT_RECAP_CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=120'

function parseAiSectionOverrides(input: string): Partial<PostDraftRecapSections> | null {
  const trimmed = input.trim()
  const jsonCandidate = trimmed.startsWith('{')
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0] ?? null
  if (!jsonCandidate) return null
  try {
    const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>
    const overrides: Partial<PostDraftRecapSections> = {}
    if (typeof parsed.leagueNarrativeRecap === 'string') overrides.leagueNarrativeRecap = parsed.leagueNarrativeRecap
    if (typeof parsed.strategyRecap === 'string') overrides.strategyRecap = parsed.strategyRecap
    if (typeof parsed.bestWorstValueExplanation === 'string') overrides.bestWorstValueExplanation = parsed.bestWorstValueExplanation
    if (typeof parsed.chimmyDraftDebrief === 'string') overrides.chimmyDraftDebrief = parsed.chimmyDraftDebrief
    return Object.keys(overrides).length > 0 ? overrides : null
  } catch {
    return null
  }
}

function hashString(input: string): string {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24)
  }
  return (hash >>> 0).toString(16)
}

function jsonFromCacheEntry(entry: { body: unknown; status: number; headers: Record<string, string> }) {
  const response = NextResponse.json(entry.body, { status: entry.status })
  for (const [header, value] of Object.entries(entry.headers)) {
    response.headers.set(header, value)
  }
  if (!entry.headers['Cache-Control']) {
    response.headers.set('Cache-Control', DRAFT_RECAP_CACHE_CONTROL)
  }
  return response
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const includeAiExplanation = Boolean(
    body?.includeAiExplanation ?? body?.include_ai_explanation ?? false
  )
  const deterministicCacheKey = `draft_recap_det:${leagueId}`
  const cachedDeterministic = !includeAiExplanation ? getApiCached(deterministicCacheKey) : null
  if (cachedDeterministic) {
    return jsonFromCacheEntry(cachedDeterministic)
  }

  try {
    const deterministic = await buildDeterministicPostDraftRecap(leagueId)
    if (!deterministic) {
      return NextResponse.json({ error: 'Draft is not completed' }, { status: 400 })
    }
    const deterministicSections = deterministic.sections
    const deterministicRecap = deterministicSections.leagueNarrativeRecap

    if (!includeAiExplanation) {
      const deterministicResponse = {
        recap: deterministicRecap,
        deterministicRecap,
        sections: deterministicSections,
        fallback: false,
        execution: buildDraftExecutionMetadata({
          feature: 'post_draft_summary_calculations',
          aiUsed: false,
          aiEligible: false,
          reasonCode: 'deterministic_recap_default',
        }),
      }
      setApiCached(deterministicCacheKey, deterministicResponse, {
        ttlMs: API_CACHE_TTL.DEFAULT,
        status: 200,
        headers: { 'Cache-Control': DRAFT_RECAP_CACHE_CONTROL },
      })
      const response = NextResponse.json(deterministicResponse)
      response.headers.set('Cache-Control', DRAFT_RECAP_CACHE_CONTROL)
      return response
    }

    const invocation = evaluateAIInvocationPolicy({
      feature: 'explain_draft_recap',
      scopeId: leagueId,
      requestAI: includeAiExplanation,
      aiEnabled: true,
      providerAvailable: getProviderStatus().anyAi,
    })

    if (invocation.decision !== 'allow_ai') {
      return NextResponse.json({
        recap: deterministicRecap,
        deterministicRecap,
        fallback: true,
        execution: buildDraftExecutionMetadata({
          feature: 'explain_draft_recap',
          aiUsed: false,
          aiEligible: invocation.canShowAIButton,
          reasonCode: invocation.reasonCode,
          fallbackToDeterministic: true,
        }),
      })
    }

    const aiCacheFingerprint = hashString(
      JSON.stringify({
        leagueId: deterministic.leagueId,
        sections: deterministicSections,
      })
    )
    const aiCacheKey = `draft_recap_ai:${leagueId}:${aiCacheFingerprint}`
    const cachedAi = getApiCached(aiCacheKey)
    if (cachedAi) {
      return jsonFromCacheEntry(cachedAi)
    }

    // Owner, 2026-11-28: every model call is signed in and capped. After the AI cache (a hit costs nothing),
    // before the model call. The deterministic recap above stays free and uncapped.
    const gated = await aiCostGate(req, 'draft_recap_ai', userId)
    if (gated) return gated

    const aiResponse = await dedupeInFlight(aiCacheKey, async () => {
      const hotCachedAi = getApiCached(aiCacheKey)
      if (hotCachedAi) return hotCachedAi.body as Record<string, unknown>

      const aiResult = await withTimeout(
        openaiChatText({
          messages: [
            {
              role: 'system',
              content: 'You are a concise fantasy sports analyst and Chimmy assistant. Rewrite draft recap sections in a calm, factual tone. Return STRICT JSON only with keys: leagueNarrativeRecap, strategyRecap, bestWorstValueExplanation, chimmyDraftDebrief. Do not include markdown fences or extra keys.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                leagueId: deterministic.leagueId,
                leagueName: deterministic.leagueName,
                sport: deterministic.sport,
                deterministicSections,
                teamGradeExplanations: deterministicSections.teamGradeExplanations.slice(0, 6),
              }),
            },
          ],
          temperature: 0.5,
          maxTokens: 600,
        }),
        invocation.maxLatencyMs
      )

      if (!aiResult.ok || !aiResult.value.ok) {
        const fallbackResponse = {
          recap: deterministicRecap,
          deterministicRecap,
          sections: deterministicSections,
          fallback: true,
          execution: buildDraftExecutionMetadata({
            feature: 'explain_draft_recap',
            aiUsed: false,
            aiEligible: invocation.canShowAIButton,
            reasonCode: !aiResult.ok ? 'ai_timeout_deterministic_fallback' : 'ai_error_deterministic_fallback',
            fallbackToDeterministic: true,
          }),
        }
        // Short-lived fallback cache prevents burst retries from over-calling providers.
        setApiCached(aiCacheKey, fallbackResponse, {
          ttlMs: API_CACHE_TTL.SHORT,
          status: 200,
          headers: { 'Cache-Control': DRAFT_RECAP_CACHE_CONTROL },
        })
        return fallbackResponse
      }

      const aiOverrides = parseAiSectionOverrides(aiResult.value.text)
      const sections: PostDraftRecapSections = aiOverrides
        ? { ...deterministicSections, ...aiOverrides }
        : {
            ...deterministicSections,
            leagueNarrativeRecap: aiResult.value.text.trim(),
          }
      const responsePayload = {
        recap: sections.leagueNarrativeRecap,
        deterministicRecap,
        sections,
        deterministicSections,
        fallback: false,
        execution: buildDraftExecutionMetadata({
          feature: 'explain_draft_recap',
          aiUsed: true,
          aiEligible: true,
          reasonCode: 'ai_recap_generated',
        }),
      }
      setApiCached(aiCacheKey, responsePayload, {
        ttlMs: API_CACHE_TTL.MEDIUM,
        status: 200,
        headers: { 'Cache-Control': DRAFT_RECAP_CACHE_CONTROL },
      })
      return responsePayload
    })

    const response = NextResponse.json(aiResponse)
    response.headers.set('Cache-Control', DRAFT_RECAP_CACHE_CONTROL)
    return response
  } catch (e) {
    console.error('[draft/recap POST]', e)
    return NextResponse.json(
      { error: (e as Error).message ?? 'Server error' },
      { status: 500 }
    )
  }
}
