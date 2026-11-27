/**
 * AI explanation of the League Intelligence Graph.
 * DeepSeek: metrics/interpretation. Grok: momentum/storyline. OpenAI: readable summary.
 *
 * 🛑 AF COMMISSIONER FOR THE WHOLE LEAGUE (owner, 2026-11-27). Every insight type (summary, rivalry,
 * manager, timeline, unified) is the same three-model consensus call, so every type is gated: it runs only
 * when the league's COMMISSIONER holds AF Commissioner or AF Supreme, at most
 * LEAGUE_STORY_AI_DAILY_LIMITS.graph_insight times a league a day (lib/league-story-ai/leagueStoryAiGate.ts).
 * Locked or capped, the fact-built graph summary is served with `aiLocked` and no model is called.
 *
 * Membership is checked too: this used to accept any signed-in user for any league id, which would let an
 * outsider spend an entitled league's daily allowance.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireLeagueApiAccess } from "@/lib/api/require-league-access";
import { checkLeagueStoryAiGate } from "@/lib/league-story-ai/leagueStoryAiGate";
import {
  buildLeagueRelationshipProfile,
  normalizeSportForGraph,
} from "@/lib/league-intelligence-graph";
import { buildAIPrestigeContext } from "@/lib/prestige-governance/AIPrestigeContextResolver";
import { buildAIRelationshipContext } from "@/lib/relationship-insights";
import { runUnifiedOrchestration } from "@/lib/ai-orchestration";
import { buildEnvelopeForTool, formatToolResult, validateToolOutput } from "@/lib/ai-tool-layer";

export const dynamic = "force-dynamic";

type InsightType = "summary" | "rivalry" | "manager" | "timeline" | "unified";

function profileToSummaryLines(profile: {
  strongestRivalries: unknown[];
  tradeClusters: unknown[];
  influenceLeaders: unknown[];
  centralManagers: unknown[];
  isolatedManagers: unknown[];
  dynastyPowerTransitions: unknown[];
}): string {
  const lines: string[] = [];
  if (profile.strongestRivalries?.length) {
    lines.push(`Strong rivalries: ${profile.strongestRivalries.length} pairs.`);
  }
  if (profile.tradeClusters?.length) {
    lines.push(`Trade clusters: ${profile.tradeClusters.length} (alliance-like trading groups).`);
  }
  if (profile.influenceLeaders?.length) {
    lines.push(`Influence leaders: ${profile.influenceLeaders.length} managers with high centrality or impact.`);
  }
  if (profile.centralManagers?.length) {
    lines.push(`Central managers: ${profile.centralManagers.length} highly connected.`);
  }
  if (profile.isolatedManagers?.length) {
    lines.push(`Isolated managers: ${profile.isolatedManagers.length} with few graph connections.`);
  }
  if (profile.dynastyPowerTransitions?.length) {
    lines.push(`Power transitions: ${profile.dynastyPowerTransitions.length} dynasty-era shifts.`);
  }
  return lines.join(" ");
}

function getProviderRaw(
  modelOutputs: Array<{ model?: string; raw?: string; skipped?: boolean; error?: string }>,
  provider: "openai" | "deepseek" | "grok"
): string {
  const hit = modelOutputs.find((item) => item.model === provider && !item.skipped && !item.error && item.raw?.trim())
  return hit?.raw?.trim() ?? ""
}

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
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params;
    if (!leagueId) {
      return NextResponse.json({ error: "Missing leagueId" }, { status: 400 });
    }
    // 401 signed out, 404 no such league, 403 not a member.
    const access = await requireLeagueApiAccess(leagueId);
    if (!access.ok) return access.response;
    const sessionUserId = access.userId;

    let body: {
      type?: InsightType;
      season?: number | null;
      sport?: string | null;
      focusEntityId?: string;
      lang?: unknown;
    } = {};
    try {
      body = await req.json().catch(() => ({}));
    } catch {}
    const type = body.type ?? "summary";
    const season = body.season ?? null;
    const sport = normalizeSportForGraph(body.sport ?? null);

    const [profile, prestigeContext, unifiedContext] = await Promise.all([
      buildLeagueRelationshipProfile({
        leagueId,
        season,
        sport,
        limits: { rivalries: 15, clusters: 8, influence: 12, central: 20, transitions: 15, elimination: 15 },
      }),
      buildAIPrestigeContext(leagueId, sport).catch(() => null),
      buildAIRelationshipContext({
        leagueId,
        sport,
        season,
        focusManagerId: type === "manager" ? body.focusEntityId : null,
        focusRivalryId: type === "rivalry" ? body.focusEntityId : null,
        focusDramaEventId: type === "timeline" ? body.focusEntityId : null,
      }).catch(() => null),
    ]);

    const summaryForAI = profileToSummaryLines(profile);
    const topRival = profile.strongestRivalries[0];
    const topInfluence = profile.influenceLeaders[0];
    const focusNote =
      type === "summary"
        ? "Provide a league-wide overview."
        : `Focus on ${type} with target: ${body.focusEntityId ?? "none"}.`;

    const envelope = buildEnvelopeForTool("rivalries", {
      sport: sport ?? undefined,
      leagueId,
      userId: sessionUserId,
      deterministicPayload: {
        graphSummary: summaryForAI,
        focusType: type,
        focusEntityId: body.focusEntityId ?? null,
        profile,
        topRival: topRival
          ? { nodeA: topRival.nodeA, nodeB: topRival.nodeB, intensityScore: topRival.intensityScore }
          : null,
        topInfluence: topInfluence
          ? { entityId: topInfluence.entityId, compositeScore: topInfluence.compositeScore }
          : null,
        compositeScore:
          Number(
            topRival?.intensityScore ??
              topInfluence?.compositeScore ??
              profile?.strongestRivalries?.[0]?.intensityScore ??
              0
          ) || 0,
        transitionCount: profile.dynastyPowerTransitions.length,
        prestigeHint: prestigeContext?.combinedHint ?? null,
        unifiedContext: unifiedContext?.payload ?? null,
      },
      userMessage:
        `League graph insight request. ${focusNote} Explain key rivalries, relationship clusters, and power shifts with deterministic evidence only.`,
    })

    // Locked or capped → the fact-built summary below, no model call.
    const aiGate = await checkLeagueStoryAiGate({ leagueId: access.leagueId, kind: "graph_insight", lang: body.lang });
    const orchestration = aiGate.ok
      ? await runUnifiedOrchestration({
          envelope,
          mode: "consensus",
          options: { timeoutMs: 20_000, maxRetries: 1 },
        })
      : null

    let metricsInterpretation = "";
    let momentumStoryline = "";
    let readableSummary = "";
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
        toolKey: "rivalries",
        primaryAnswer:
          orchestration.response.primaryAnswer ||
          `League graph summary: ${summaryForAI || "Relationship context is limited."}`,
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
      const providerOutputs = orchestration.response.modelOutputs ?? []
      metricsInterpretation = getProviderRaw(providerOutputs, "deepseek")
      momentumStoryline = getProviderRaw(providerOutputs, "grok")
      readableSummary =
        getProviderRaw(providerOutputs, "openai") ||
        formatted.output.narrative ||
        orchestration.response.primaryAnswer ||
        ""
      verdict = formatted.output.verdict
      sections = formatted.sections
      factGuardWarnings = warnings.length ? warnings : undefined
    } else {
      readableSummary = `League graph summary: ${summaryForAI || "Relationship context is limited."}`
    }

    return NextResponse.json({
      leagueId,
      season: profile.season,
      type,
      metricsInterpretation: metricsInterpretation || null,
      momentumStoryline: momentumStoryline || null,
      readableSummary: readableSummary || null,
      verdict,
      sections,
      factGuardWarnings,
      generatedAt: new Date().toISOString(),
      source: orchestration?.ok ? "ai" : "template",
      aiLocked: aiGate.ok ? null : aiGate.body,
      unifiedStorylineCount:
        Array.isArray((unifiedContext?.payload as { storylines?: unknown[] } | undefined)?.storylines)
          ? ((unifiedContext?.payload as { storylines?: unknown[] }).storylines?.length ?? 0)
          : 0,
    });
  } catch (e) {
    console.error("[graph-insight POST]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Graph insight failed" },
      { status: 500 }
    );
  }
}
