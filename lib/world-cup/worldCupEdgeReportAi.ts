import "server-only"
/**
 * World Cup Daily Edge Report — AI coaching layer
 *
 * Takes the deterministic EdgeReport grounding and generates:
 *  - coachingInsight: 2-3 sentences of strategic coaching specific to this
 *    user's bracket situation. Grounded — no hallucinated stats.
 *  - commissionerPost: a ready-to-post pool chat message the commissioner (or
 *    any user) can share to stoke competition in their pool today.
 *
 * Billing: 1 token per call. Result cached 24h (per user per pool per UTC day).
 * Free on cache hit. The route caller handles confirmation + token commit.
 */

import { routeTextCall, type RouterMessage } from "@/lib/ai/providerRouter"
import { logAiInteraction } from "@/lib/ai/auditLogger"
import { getCachedAiResult, saveAiResult } from "@/lib/ai/ai-result-cache"
import type { WorldCupEdgeReport } from "./worldCupEdgeReport"

// ── Types ─────────────────────────────────────────────────────────────────────

export type EdgeReportCoaching = {
  coachingInsight: string
  commissionerPost: string
  generatedAt: string
  fromCache: boolean
}

export type EdgeReportCoachingResult =
  | { ok: true; coaching: EdgeReportCoaching }
  | { ok: false; reason: "provider_missing" | "parse_error" | "error"; fallback: string }

// ── Cache key ─────────────────────────────────────────────────────────────────

/**
 * Cache is per-user per-pool per UTC day.
 * Same user, same pool, same day → free repeat access.
 * New day → cache miss → new LLM call → new token charge.
 */
export function edgeReportCacheKey(challengeId: string, userId: string, utcDate: string): string {
  return `wc-edge-report-coaching:${challengeId}:${userId}:${utcDate}`
}

export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10)  // "2026-06-09"
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildCoachingPrompt(
  report: WorldCupEdgeReport,
  sections: WorldCupEdgeReport["sections"]
): string {
  const g = report.grounding
  const rankStr = g.userRank !== null ? `#${g.userRank} of ${g.totalEntries}` : "unranked"

  const pendingStr =
    g.pendingPickCount > 0
      ? `${g.pendingPickCount} pending pick${g.pendingPickCount !== 1 ? "s" : ""} worth ${g.pendingPickPoints} pts`
      : "no pending picks"

  const threatStr =
    g.topThreatName
      ? `biggest threat: ${g.topThreatName} (${g.topThreatCanReach > 0 ? `can reach ${g.topThreatCanReach} pts above current score` : "cannot overtake"})`
      : "no rivals who can pass"

  const climbStr =
    g.bestClimbSpots > 0
      ? `can climb ${g.bestClimbSpots} spot${g.bestClimbSpots !== 1 ? "s" : ""} if all remaining picks land`
      : "cannot climb — rivals ahead are out of reach"

  const championStr =
    g.userChampion
      ? `${g.userChampion} (${g.championStillAlive ? "still alive" : "ELIMINATED"})`
      : "no champion pick"

  return `You are a World Cup bracket pool coach. Write two things:

1. COACHING_INSIGHT: Two to three sentences of specific, actionable coaching for this user based only on the data provided. No filler phrases. Mention their actual rank, picks, and threats by name.

2. COMMISSIONER_POST: One to three sentences the pool commissioner could post in group chat right now to get people talking. Make it engaging and specific to the current pool state — not generic. Pool-wide perspective, not personal.

--- POOL DATA (do not invent anything beyond this) ---
Pool: ${g.poolName}
User rank: ${rankStr}
User score: ${g.userScore} pts (max possible: ${g.userMaxPossible})
Champion pick: ${championStr}
Pending picks: ${pendingStr}
${threatStr}
${climbStr}

Match that matters: ${sections.matchThatMatters.headline} — ${sections.matchThatMatters.subtext}
Root for: ${sections.rootFor.headline} — ${sections.rootFor.subtext}
Threats: ${sections.threats.headline} — ${sections.threats.subtext}
Best path: ${sections.bestPath.headline} — ${sections.bestPath.subtext}
Mistake to avoid: ${sections.mistakeToAvoid.headline} — ${sections.mistakeToAvoid.subtext}
--- END DATA ---

Respond in exactly this format (no extra text):
COACHING_INSIGHT: <coaching text>
COMMISSIONER_POST: <post text>`
}

// ── Response parser ───────────────────────────────────────────────────────────

function parseCoachingResponse(raw: string): { coachingInsight: string; commissionerPost: string } | null {
  const coachingMatch = raw.match(/COACHING_INSIGHT:\s*(.+?)(?=COMMISSIONER_POST:|$)/s)
  const postMatch = raw.match(/COMMISSIONER_POST:\s*(.+?)$/s)

  const coaching = coachingMatch?.[1]?.trim()
  const post = postMatch?.[1]?.trim()

  if (!coaching || !post) return null
  return { coachingInsight: coaching, commissionerPost: post }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateEdgeReportCoaching(input: {
  report: WorldCupEdgeReport
  userId: string
  challengeId: string
  plan: string | null
  /** The committed token spend callback — called only on successful LLM + parse. */
  commitTokenSpend: (() => Promise<unknown>) | null
}): Promise<EdgeReportCoachingResult> {
  const { report, userId, challengeId, plan, commitTokenSpend } = input
  const utcDate = todayUtcDate()
  const cacheKey = edgeReportCacheKey(challengeId, userId, utcDate)

  // ── Cache check (free on hit) ──────────────────────────────────────────────
  // Cache is keyed by feature + per-user/pool/day scopeId — same key the save uses.
  const cached = await getCachedAiResult({
    feature: "world_cup_daily_edge_report",
    scopeType: "user_pool_day",
    scopeId: cacheKey,
    payload: {},
  }).catch(() => null)
  if (cached?.resultText) {
    try {
      const parsed = JSON.parse(cached.resultText) as {
        coachingInsight: string
        commissionerPost: string
      }
      logAiInteraction({
        userId,
        sport: "world_cup",
        feature: "world_cup_daily_edge_report",
        route: "/api/brackets/world-cup/[challengeId]/edge-report",
        plan,
        providerSource: "cache",
        freshnessTier: "static",
        promptIntent: "coaching",
        missingData: [],
        allowedClaims: [],
        validatorResult: "clean",
        blockedReason: null,
        modelUsed: "cache",
        tokenCost: 0,
        wasDeterministic: false,
        billingReason: "cache_hit",
        shouldChargeToken: false,
        tokenCharged: false,
        tokenChargeStatus: "cache_no_charge",
      })
      return {
        ok: true,
        coaching: {
          coachingInsight: parsed.coachingInsight,
          commissionerPost: parsed.commissionerPost,
          generatedAt: cached.resultText ? utcDate : new Date().toISOString(),
          fromCache: true,
        },
      }
    } catch {
      // Corrupt cache entry — fall through to LLM
    }
  }

  // ── LLM call ──────────────────────────────────────────────────────────────
  const prompt = buildCoachingPrompt(report, report.sections)
  const messages: RouterMessage[] = [{ role: "user", content: prompt }]

  const llmResult = await routeTextCall({
    messages,
    maxTokens: 400,
    temperature: 0.4,
  }).catch(() => null)

  if (!llmResult || !llmResult.ok) {
    logAiInteraction({
      userId,
      sport: "world_cup",
      feature: "world_cup_daily_edge_report",
      route: "/api/brackets/world-cup/[challengeId]/edge-report",
      plan,
      providerSource: "unavailable",
      freshnessTier: "static",
      promptIntent: "coaching",
      missingData: [],
      allowedClaims: [],
      validatorResult: "unavailable",
      blockedReason: null,
      modelUsed: "unavailable",
      tokenCost: 0,
      wasDeterministic: false,
      billingReason: "provider_missing",
      shouldChargeToken: false,
      tokenCharged: false,
      tokenChargeStatus: "not_applicable",
    })
    return {
      ok: false,
      reason: "provider_missing",
      fallback: "AI coaching is temporarily unavailable. Your deterministic report above is always accurate.",
    }
  }

  // ── Parse LLM output ───────────────────────────────────────────────────────
  const parsed = parseCoachingResponse(llmResult.text)
  if (!parsed) {
    logAiInteraction({
      userId,
      sport: "world_cup",
      feature: "world_cup_daily_edge_report",
      route: "/api/brackets/world-cup/[challengeId]/edge-report",
      plan,
      providerSource: llmResult.provider,
      freshnessTier: "static",
      promptIntent: "coaching",
      missingData: [],
      allowedClaims: [],
      validatorResult: "warned",
      blockedReason: null,
      modelUsed: llmResult.model ?? "unknown",
      tokenCost: llmResult.tokensUsed ?? 0,
      wasDeterministic: false,
      billingReason: "error",
      shouldChargeToken: false,
      tokenCharged: false,
      tokenChargeStatus: "not_applicable",
    })
    return {
      ok: false,
      reason: "parse_error",
      fallback: "Coaching response was in an unexpected format. Try again in a moment.",
    }
  }

  // ── Token spend — committed AFTER successful parse ─────────────────────────
  let tokenCharged = false
  let tokenChargeStatus = "not_applicable"

  const shouldCharge = !plan || !["pro", "supreme", "commissioner", "war_room"].includes(plan)
  if (shouldCharge && commitTokenSpend) {
    try {
      await commitTokenSpend()
      tokenCharged = true
      tokenChargeStatus = "charged"
    } catch (err) {
      // Spend failed after valid LLM — log and propagate
      logAiInteraction({
        userId,
        sport: "world_cup",
        feature: "world_cup_daily_edge_report",
        route: "/api/brackets/world-cup/[challengeId]/edge-report",
        plan,
        providerSource: llmResult.provider,
        freshnessTier: "static",
        promptIntent: "coaching",
        missingData: [],
        allowedClaims: [],
        validatorResult: "clean",
        blockedReason: null,
        modelUsed: llmResult.model ?? "unknown",
        tokenCost: llmResult.tokensUsed ?? 0,
        wasDeterministic: false,
        billingReason: "llm_required",
        shouldChargeToken: true,
        tokenCharged: false,
        tokenChargeStatus: "spend_failed",
      })
      throw err  // Route catches this and returns 402
    }
  } else if (!shouldCharge) {
    tokenChargeStatus = "covered_by_plan"
  }

  // ── Cache the result (keyed to today — expires naturally at day rollover) ──
  await saveAiResult({
    feature: "world_cup_daily_edge_report",
    scopeType: "user_pool_day",
    scopeId: cacheKey,
    provider: llmResult.provider,
    model: llmResult.model ?? null,
    payload: {},
    resultText: JSON.stringify(parsed),
    ttlSeconds: 86400,  // 24h — daily report
  }).catch(() => undefined)  // cache write failure must never block the response

  logAiInteraction({
    userId,
    sport: "world_cup",
    feature: "world_cup_daily_edge_report",
    route: "/api/brackets/world-cup/[challengeId]/edge-report",
    plan,
    providerSource: llmResult.provider,
    freshnessTier: "static",
    promptIntent: "coaching",
    missingData: [],
    allowedClaims: [],
    validatorResult: "clean",
    blockedReason: null,
    modelUsed: llmResult.model ?? "unknown",
    tokenCost: llmResult.tokensUsed ?? 0,
    wasDeterministic: false,
    billingReason: shouldCharge ? "llm_required" : "premium_plan_included",
    shouldChargeToken: shouldCharge,
    tokenCharged,
    tokenChargeStatus,
  })

  return {
    ok: true,
    coaching: {
      coachingInsight: parsed.coachingInsight,
      commissionerPost: parsed.commissionerPost,
      generatedAt: new Date().toISOString(),
      fromCache: false,
    },
  }
}
