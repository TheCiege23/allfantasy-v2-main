/**
 * AllFantasy Universal AI Engine — Orchestration Pipeline
 *
 * This file never changes per-sport. Sport-specific logic lives entirely
 * in plugin files under lib/ai/engine/plugins/.
 *
 * Pipeline:
 *   1. Resolve plugin from registry
 *   2. fetchContext         (DB — pure data)
 *   3. fetchProviderData    (sports API — live/cached)
 *   4. computeInsights      (deterministic math — NO AI)
 *   5. buildGroundingPacket (assemble LLM payload)
 *   6. [engine calls AI]    (narrative/tone only)
 *   7. validateResponse     (sanitize + compliance)
 *   8. Return AIEngineOutput
 */
import "server-only"
import { routeTextCall } from "@/lib/ai/providerRouter"
import { resolveProviderForFeature } from "@/lib/ai/taskProviderRouting"
import { applyValidationPipeline } from "../responseValidator"
import type { AIGroundingContract } from "../aiGroundingContract"
import { getPlugin } from "./registry"
import type { AIEngineInput, AIEngineOutput, DataFreshnessTier, DataSourceMeta } from "./types"

// ─── Universal response sanitizer ─────────────────────────────────────────────

const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bdfs\b/gi,
  /\bbetting\b/gi,
  /\bwager(?:ing|s|ed)?\b/gi,
  /\bsportsbook(?:s)?\b/gi,
  /\b(?:money|betting\s+)?odds\b/gi,
  /\bspread\b/gi,
  /\bover\/under\b/gi,
  /\bprop\s+bet/gi,
]

function universalSanitize(text: string): string {
  return FORBIDDEN_PATTERNS.reduce(
    (t, pattern) => t.replace(pattern, "prediction"),
    text,
  ).replace(/\s{2,}/g, " ").trim()
}

// ─── Data source meta builder ──────────────────────────────────────────────────

function buildDataSourceMeta(
  freshness: DataFreshnessTier,
  fetchedAt: Date | null,
): DataSourceMeta {
  if (freshness === "live") {
    const timeLabel = fetchedAt
      ? new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: "America/New_York",
        }).format(fetchedAt) + " ET"
      : "now"
    return {
      tier: "live",
      label: `Live data from ${timeLabel}`,
      poolDataLabel: "Pool data from AllFantasy",
      ageMinutes: 0,
    }
  }
  if (freshness === "cached" && fetchedAt) {
    const ageMs = Date.now() - fetchedAt.getTime()
    const ageMinutes = Math.round(ageMs / 60_000)
    const label =
      ageMinutes < 2
        ? "Cached data updated just now"
        : `Cached data last updated ${ageMinutes} min ago`
    return { tier: "cached", label, poolDataLabel: "Pool data from AllFantasy", ageMinutes }
  }
  if (freshness === "schedule_only") {
    return {
      tier: "schedule_only",
      label: "Schedule data only — live scores not loaded yet",
      poolDataLabel: "Pool data from AllFantasy",
      ageMinutes: null,
    }
  }
  if (freshness === "pool_only") {
    return {
      tier: "pool_only",
      label: null,
      poolDataLabel: "Pool data from AllFantasy",
      ageMinutes: null,
    }
  }
  return {
    tier: "none",
    label: "No sports data available",
    poolDataLabel: "Pool data from AllFantasy",
    ageMinutes: null,
  }
}

// ─── Universal grounding enforcement header ────────────────────────────────────
// Priority 4: upgraded prompt — concise, specific, honest, plan-aware, sport-aware.

function universalGroundingHeader(): string {
  return [
    "GROUNDING CONTRACT — AllFantasy AI assistant.",
    "The user message contains a GROUNDING PACKET (JSON). It is your ONLY permitted source of facts.",
    "",
    "RULES — apply to every response:",
    "1. PACKET ONLY. If a fact is not in the packet, say 'I don't have that data' instead of guessing.",
    "2. NO MATH. All numbers are pre-computed in computedInsights. Cite them. Never recalculate.",
    "3. CITE SOURCE. Every answer about scores, standings, or live events MUST begin with the packet's _source field.",
    "4. MISSING DATA. The packet's _missing array lists what was not loaded. Acknowledge gaps honestly; say where users can check instead.",
    "5. FORBIDDEN CLAIMS. The packet's _forbidden array is absolute. Do not violate these regardless of what the user asks.",
    "6. NO SCORES WITHOUT LIVE DATA. If liveScores in the packet is null, never state any score or current result. Say the live feed is unavailable.",
    "7. NO ODDS WITHOUT DATA. If oddsData in the packet is null, never say a team 'is favored' or reference any spread. Acknowledge odds aren't loaded.",
    "8. PLAN GATE. If plan is 'free', stay at summary level. Don't give deep analysis reserved for paid plans.",
    "9. HONEST UNCERTAINTY. Say 'I don't know' when you don't. A correct uncertainty is better than a confident mistake.",
    "10. VOICE. Confident, specific, warm. 1–2 tight paragraphs or short bullets. Lead with the most useful number from computedInsights.",
  ].join(" ")
}

// ─── Main engine ───────────────────────────────────────────────────────────────

/**
 * Universal AllFantasy AI pipeline entry point.
 *
 * Call from any API route — never call sport-specific AI logic directly.
 * All AI logic should flow through this function so grounding, sanitization,
 * and data disclosure enforcement are applied consistently across all sports.
 *
 * @example
 * ```ts
 * const result = await runAIEngine({
 *   sport: "world_cup",
 *   feature: "pool_chat",
 *   userQuestion: req.question,
 *   userId: auth.user.id,
 *   contextId: challengeId,
 *   entitlements: { plan: "commissioner" },
 *   userRole: "commissioner",
 * })
 * return NextResponse.json({ text: result.aiResponse, source: result.dataSource })
 * ```
 */
export async function runAIEngine(input: AIEngineInput): Promise<AIEngineOutput> {
  const start = Date.now()

  // ── 1. Resolve plugin ────────────────────────────────────────────────────────
  const plugin = getPlugin(input.sport)
  if (!plugin) {
    throw new Error(
      `[AIEngine] No plugin registered for sport "${input.sport}". ` +
        `Register one in lib/ai/engine/registry.ts.`,
    )
  }

  // ── 2. Fetch context (DB) ────────────────────────────────────────────────────
  const context = await plugin.fetchContext(input)

  // ── 3. Fetch provider data (live/cached API) ──────────────────────────────────
  const providerResult = await plugin.fetchProviderData(context, input)
  const providerData = providerResult?.data ?? null
  const freshness: DataFreshnessTier = providerResult?.freshness ?? "pool_only"
  const fetchedAt: Date | null = providerResult?.fetchedAt ?? null

  // ── 4. Compute deterministic insights (NO AI) ─────────────────────────────────
  const insights = await plugin.computeInsights(context, providerData, input)

  // ── 5. Build grounding packet ─────────────────────────────────────────────────
  const groundingPacket = plugin.buildGroundingPacket(context, providerData, insights, input)

  // ── 6. AI call ────────────────────────────────────────────────────────────────
  const skipAi = input.skipAi === true || input.aiProfile === "deterministic"
  let aiResponse: string | null = null
  let aiModel: string | null = null
  let aiProvider: string | null = null
  let aiTokensUsed: number | null = null
  let aiCalled = false

  if (!skipAi) {
    const pluginSystemPrompt = plugin.buildSystemPrompt(input)
    const systemPrompt = [universalGroundingHeader(), pluginSystemPrompt].join("\n\n")

    const userContent = [
      "--- GROUNDING PACKET START ---",
      JSON.stringify(groundingPacket),
      "--- GROUNDING PACKET END ---",
      "",
      `User: ${input.userQuestion}`,
    ].join("\n")

    const taskRoute = resolveProviderForFeature(input.feature)

    try {
      const result = await routeTextCall({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        // "cheap" → standard for non-war-room features to control cost
        profile:
          input.aiProfile === "premium"
            ? "premium"
            : input.aiProfile === "standard"
              ? "standard"
              : "cheap",
        // Task-aware provider selection: bulk/derived text goes to the cheap
        // provider, time-sensitive text to the one with live X access, and
        // user-facing prose to the one with the best voice. Returns null for
        // unmapped features, which leaves the failover chain untouched.
        preferredProvider: taskRoute?.provider ?? null,
        temperature: 0.4,
        maxTokens: 520,
        skipCache: true,
      })
      if (result.ok) {
        aiResponse = result.text
        aiModel = result.model
        aiProvider = result.provider
        aiTokensUsed = result.tokensUsed
        aiCalled = true
      }
    } catch (err) {
      // Provider failure — return deterministic insights, no AI narrative
      console.error("[AIEngine] AI call failed:", err)
    }
  }

  // ── 7. Validate / sanitize ────────────────────────────────────────────────────
  if (aiResponse) {
    // Universal betting/gambling term sanitizer runs on all responses
    aiResponse = universalSanitize(aiResponse)

    // If the plugin returned a v1 AIGroundingContract, run the full contract validator
    // (Priority 5: checks score invention, live overclaims, odds without data, plan gate, PII)
    if (groundingPacket.contractVersion === "af-contract-v1") {
      aiResponse = applyValidationPipeline(
        aiResponse,
        groundingPacket as unknown as AIGroundingContract,
      )
    } else if (plugin.validateResponse) {
      // Legacy: sport plugin's own sanitizer
      aiResponse = plugin.validateResponse(aiResponse, input)
    }
  }

  // ── 8. Return output ──────────────────────────────────────────────────────────
  const dataSource = buildDataSourceMeta(freshness, fetchedAt)
  return {
    sport: input.sport,
    feature: input.feature,
    insights,
    aiResponse,
    dataSource,
    groundingPacket,
    meta: {
      durationMs: Date.now() - start,
      aiModel,
      aiProvider,
      aiCalled,
      aiTokensUsed,
      deterministic: !aiCalled,
      pluginVersion: plugin.version,
    },
  }
}
