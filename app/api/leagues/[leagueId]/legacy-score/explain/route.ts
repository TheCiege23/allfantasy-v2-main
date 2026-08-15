import { NextResponse } from "next/server"
import { getLegacyScoreByEntity } from "@/lib/legacy-score-engine/LegacyRankingService"
import {
  buildLegacyExplanationContext,
  buildLegacyExplanationNarrative,
} from "@/lib/legacy-score-engine/AILegacyExplanationService"
import { DEFAULT_SPORT, normalizeToSupportedSport } from "@/lib/sport-scope"
import { runUnifiedOrchestration } from "@/lib/ai-orchestration"
import { buildEnvelopeForTool, formatToolResult, validateToolOutput } from "@/lib/ai-tool-layer"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = "force-dynamic"

function getStructuredCandidate(response: {
  modelOutputs?: Array<{ model?: string; structured?: unknown }>
}): Record<string, unknown> | null {
  const openaiStructured = response.modelOutputs?.find(
    (item) => item.model === "openai" && item.structured && typeof item.structured === "object"
  )?.structured
  if (openaiStructured && typeof openaiStructured === "object") {
    return openaiStructured as Record<string, unknown>
  }
  const anyStructured = response.modelOutputs?.find(
    (item) => item.structured && typeof item.structured === "object"
  )?.structured
  return anyStructured && typeof anyStructured === "object"
    ? (anyStructured as Record<string, unknown>)
    : null
}

/**
 * POST /api/leagues/[leagueId]/legacy-score/explain
 * Body: { entityType, entityId, sport? }. Returns narrative for "Why is this score high?" / AI explain.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })
    // Membership gate. This route was reachable by anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response

    const body = await req.json().catch(() => ({}))
    const entityType = body.entityType as string
    const entityId = body.entityId as string
    const sport = normalizeToSupportedSport((body.sport as string) ?? DEFAULT_SPORT)

    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: "entityType and entityId are required" },
        { status: 400 }
      )
    }

    const record = await getLegacyScoreByEntity(
      entityType,
      entityId,
      sport,
      leagueId
    )
    if (!record) {
      return NextResponse.json({
        leagueId,
        entityType,
        entityId,
        narrative:
          "No legacy score yet. Run the legacy score engine in the Legacy tab to generate scores from championships, playoffs, and consistency.",
        source: "none",
      })
    }

    const context = buildLegacyExplanationContext(record)
    const fallback = buildLegacyExplanationNarrative(context)
    const envelope = buildEnvelopeForTool("legacy_score", {
      sport,
      leagueId,
      deterministicPayload: {
        leagueId,
        entityType,
        entityId,
        score: record.overallLegacyScore,
        breakdown: context.breakdown,
        context,
      },
      userMessage:
        "Explain this legacy score in 3-5 concise sentences. Mention strongest dimensions, one weaker dimension, and one practical improvement path.",
    })
    const orchestration = await runUnifiedOrchestration({
      envelope,
      mode: "consensus",
      options: { timeoutMs: 20_000, maxRetries: 1 },
    })

    let narrative = fallback
    let source: "legacy_score_engine" | "unified_ai" = "legacy_score_engine"
    let verdict: string | null = null
    let sections:
      | Array<{
          id: string
          title: string
          content: string
          type: "verdict" | "evidence" | "confidence" | "risks" | "next_action" | "alternate" | "narrative"
        }>
      | undefined
    let factGuardWarnings: string[] | undefined

    if (orchestration.ok) {
      const formatted = formatToolResult({
        toolKey: "legacy_score",
        primaryAnswer: orchestration.response.primaryAnswer || fallback,
        structured: getStructuredCandidate(orchestration.response),
        envelope,
        factGuardWarnings: orchestration.response.factGuardWarnings,
      })
      const factGuard = validateToolOutput(formatted.output, envelope)
      const warnings = Array.from(
        new Set([
          ...formatted.factGuardWarnings,
          ...factGuard.warnings,
          ...factGuard.errors.map((error) => `Fact guard: ${error}`),
        ])
      )
      narrative = formatted.output.narrative || orchestration.response.primaryAnswer || fallback
      source = "unified_ai"
      verdict = formatted.output.verdict
      sections = formatted.sections
      factGuardWarnings = warnings.length ? warnings : undefined
    }

    return NextResponse.json({
      leagueId,
      entityType,
      entityId,
      narrative,
      source,
      verdict,
      sections,
      factGuardWarnings,
      overallLegacyScore: record.overallLegacyScore,
      breakdown: context.breakdown,
    })
  } catch (e) {
    console.error("[legacy-score/explain POST]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to explain legacy score" },
      { status: 500 }
    )
  }
}
