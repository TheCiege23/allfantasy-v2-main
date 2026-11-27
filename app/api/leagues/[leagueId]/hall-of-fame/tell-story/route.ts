/**
 * POST /api/leagues/[leagueId]/hall-of-fame/tell-story
 * Body: { type: 'entry' | 'moment', id: string }
 * Returns narrative for "Tell me why this matters" button.
 *
 * 🛑 THE MODEL WRITE-UP IS AF COMMISSIONER (owner, 2026-11-27): it runs only when the league's commissioner
 * holds AF Commissioner or AF Supreme, and at most LEAGUE_STORY_AI_DAILY_LIMITS.hall_of_fame times a league a
 * day (lib/league-story-ai/leagueStoryAiGate.ts). Otherwise the fact-built narrative below is served, free,
 * with `aiLocked` saying why (the standard paywall body), and no model is called.
 */
import { NextResponse } from "next/server"
import {
  getEntryByIdScoped,
  getMomentByIdScoped,
} from "@/lib/hall-of-fame-engine/HallOfFameQueryService"
import {
  entryToNarrativeContext,
  momentToNarrativeContext,
  buildWhyInductedPromptContext,
} from "@/lib/hall-of-fame-engine/AIHallOfFameNarrativeAdapter"
import { runUnifiedOrchestration } from "@/lib/ai-orchestration"
import { buildEnvelopeForTool, formatToolResult, validateToolOutput } from "@/lib/ai-tool-layer"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'
import { checkLeagueStoryAiGate } from '@/lib/league-story-ai/leagueStoryAiGate'

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
    const type = body.type as string
    const id = body.id as string
    if (!id || !type || (type !== "entry" && type !== "moment")) {
      return NextResponse.json(
        { error: "Body must include type: 'entry' | 'moment' and id" },
        { status: 400 }
      )
    }

    if (type === "entry") {
      const entry = await getEntryByIdScoped({ entryId: id, leagueId })
      if (!entry) {
        return NextResponse.json({ error: "Entry not found" }, { status: 404 })
      }
      const context = entryToNarrativeContext(entry)
      const prompt = buildWhyInductedPromptContext(context)
      const fallback = [
        context.title,
        context.summary || "",
        `Sport: ${context.sportLabel}. Category: ${context.category}.`,
        `Induction score: ${context.score.toFixed(2)}.`,
      ]
        .filter(Boolean)
        .join(" ")
      const envelope = buildEnvelopeForTool("legacy_score", {
        sport: context.sport,
        leagueId,
        deterministicPayload: {
          type: "entry",
          entryId: entry.id,
          headline: entry.title,
          category: entry.category,
          score: context.score,
          context,
          promptContext: prompt,
        },
        userMessage:
          "In 3-5 concise sentences, explain why this Hall of Fame induction matters and which deterministic evidence most supports it.",
      })
      const aiGate = await checkLeagueStoryAiGate({ leagueId: gate.leagueId, kind: "hall_of_fame", lang: body.lang })
      const orchestration = aiGate.ok
        ? await runUnifiedOrchestration({
            envelope,
            mode: "consensus",
            options: { timeoutMs: 20_000, maxRetries: 1 },
          })
        : null

      let narrative = fallback
      let source: "ai" | "template" = "template"
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

      if (orchestration?.ok) {
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
        source = "ai"
        verdict = formatted.output.verdict
        sections = formatted.sections
        factGuardWarnings = warnings.length ? warnings : undefined
      }

      return NextResponse.json({
        type: "entry",
        id: entry.id,
        leagueId,
        narrative,
        headline: entry.title,
        category: entry.category,
        score: entry.score,
        whyInductedPrompt: prompt,
        source,
        verdict,
        sections,
        factGuardWarnings,
        aiLocked: aiGate.ok ? null : aiGate.body,
      })
    }

    const moment = await getMomentByIdScoped({ momentId: id, leagueId })
    if (!moment) {
      return NextResponse.json({ error: "Moment not found" }, { status: 404 })
    }
    const context = momentToNarrativeContext(moment)
    const prompt = buildWhyInductedPromptContext(context)
    const fallback = [
      context.title,
      context.summary || "",
      `Sport: ${context.sportLabel}. Season: ${context.season}.`,
      `Significance: ${context.score.toFixed(2)}.`,
    ]
      .filter(Boolean)
      .join(" ")
    const envelope = buildEnvelopeForTool("legacy_score", {
      sport: context.sport,
      leagueId,
      deterministicPayload: {
        type: "moment",
        momentId: moment.id,
        headline: moment.headline,
        season: moment.season,
        score: context.score,
        significanceScore: moment.significanceScore,
        context,
        promptContext: prompt,
      },
      userMessage:
        "In 3-5 concise sentences, explain why this Hall of Fame moment matters and its long-term impact, grounded in deterministic context.",
    })
    const aiGate = await checkLeagueStoryAiGate({ leagueId: gate.leagueId, kind: "hall_of_fame", lang: body.lang })
    const orchestration = aiGate.ok
      ? await runUnifiedOrchestration({
          envelope,
          mode: "consensus",
          options: { timeoutMs: 20_000, maxRetries: 1 },
        })
      : null

    let narrative = fallback
    let source: "ai" | "template" = "template"
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

    if (orchestration?.ok) {
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
      source = "ai"
      verdict = formatted.output.verdict
      sections = formatted.sections
      factGuardWarnings = warnings.length ? warnings : undefined
    }

    return NextResponse.json({
      type: "moment",
      id: moment.id,
      leagueId,
      narrative,
      headline: moment.headline,
      season: moment.season,
      significanceScore: moment.significanceScore,
      whyInductedPrompt: prompt,
      source,
      verdict,
      sections,
      factGuardWarnings,
      aiLocked: aiGate.ok ? null : aiGate.body,
    })
  } catch (e) {
    console.error("[hall-of-fame/tell-story POST]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build story" },
      { status: 500 }
    )
  }
}
