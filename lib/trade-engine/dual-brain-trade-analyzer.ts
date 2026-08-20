import { openaiChatJson, parseJsonContentFromChatCompletion } from "@/lib/openai-client";
import { X_SEARCH_ALLOWED_HANDLES } from '@/lib/news/beatReporterHandles'
import { xaiChatJson, parseTextFromXaiChatCompletion } from "@/lib/xai-client";
import {
  PEER_REVIEW_PROMPT_CONTRACT,
  PEER_REVIEW_TEMPERATURE,
  PEER_REVIEW_MAX_TOKENS,
  validateAndParsePeerReview,
  mergePeerReviews,
  type PeerReviewProviderResult,
  type PeerReviewConsensus,
  TradeAnalysisSchema,
  validateAndParseAnalysis,
  scoreProviderResult,
  mergeAnalyses,
  type TradeAnalysis,
  type ProviderResult,
  type ConsensusAnalysis,
} from "./trade-analysis-schema";

export type TradeAiMode = "openai" | "grok" | "both" | "off";
export type TradeAiPrimary = "openai" | "grok";

/**
 * Strict JSON contract injected into every dual-brain trade analysis call.
 * Both OpenAI and Grok MUST return this exact shape.
 */
export const DUAL_BRAIN_JSON_CONTRACT = `
You MUST return ONLY valid JSON matching this exact schema — no markdown, no commentary:

{
  "winner": "Team A" | "Team B" | "Even" | "Slight edge to Team A" | "Slight edge to Team B",
  "confidence": <number 0-100>,
  "reasoning": "<2-4 sentence explanation grounding your verdict in the provided data>",
  "key_factors": ["<factor 1>", "<factor 2>", ...],
  "risk_flags": ["<risk 1>", ...],
  "counter_suggestions": ["<counter trade idea 1>", ...],
  "news_impact": ["<news item affecting this trade>", ...],
  "confidence_breakdown": {
    "data_quality": <0-100>,
    "market_alignment": <0-100>,
    "risk_weighting": <0-100>
  }
}

ANTI-HALLUCINATION RULES (CRITICAL):
1. You MUST NOT invent stats, player values, ADP numbers, or trade volumes.
2. You may ONLY use data explicitly provided in the structured trade payload.
3. If information is missing, say so in risk_flags and REDUCE confidence accordingly.
4. news_impact MUST be empty ([]) unless you have verified real-time data with confidence >70%.
5. Every key_factor MUST reference specific data from the payload (values, ages, positions, roster needs).
6. counter_suggestions MUST only reference players/picks that exist in the provided roster/league data.
7. DO NOT override or contradict the deterministic fairness score — only interpret and explain it.
`;

/**
 * Grok-specific addendum granting web/X search for news_impact.
 */
export const GROK_NEWS_ADDENDUM = `
NEWS ENRICHMENT (Grok only):
- You have access to web_search and x_search tools.
- The NEWS INTELLIGENCE block in the context contains pre-scored, time-decayed news with value adjustments.
- Use web/X search to VERIFY those items and find any BREAKING news missed by the cache (last 2 hours).
- Populate news_impact with verified items. Include source and date for each.
- Only include news items if your confidence in the overall analysis is >70%.
- If confidence is ≤70%, set news_impact to an empty array.
- If you find breaking news that contradicts a cached item, note the conflict in risk_flags.
- NEWS VALUE ADJUSTMENTS in the intelligence block are AUTHORITATIVE — do not override them, only interpret.
`;

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface DualBrainRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  mode?: TradeAiMode;
  primary?: TradeAiPrimary;
  timeoutMs?: number;
}

export interface PeerReviewRequest {
  factLayerPrompt: string;
  dataGapsPrompt?: string;
  mode?: TradeAiMode;
  timeoutMs?: number;
  /** Appended to peer-review system prompt (e.g. player value reference docs). */
  referenceContext?: string;
}

function envStr(name: string, fallback: string): string {
  const v = (process.env[name] ?? "").trim();
  return v || fallback;
}

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return isNaN(v) ? fallback : v;
}

function resolveMode(explicit?: TradeAiMode): TradeAiMode {
  if (explicit) return explicit;
  const m = envStr("TRADE_AI_MODE", "both").toLowerCase();
  if (m === "off" || m === "openai" || m === "grok" || m === "both") return m as TradeAiMode;
  return "both";
}

function resolvePrimary(explicit?: TradeAiPrimary): TradeAiPrimary {
  if (explicit) return explicit;
  const p = envStr("TRADE_AI_PRIMARY", "openai").toLowerCase();
  return p === "grok" ? "grok" : "openai";
}

function resolveTimeout(explicit?: number): number {
  return explicit ?? envInt("TRADE_AI_TIMEOUT_MS", 15000);
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function parseJsonFromText(text: string | null): any {
  if (!text) return null;
  try {
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {}
    }
  }
  return null;
}

async function callProviderForPeerReview(
  provider: "openai" | "grok",
  messages: ChatMessage[],
  timeoutMs: number
): Promise<PeerReviewProviderResult> {
  const start = Date.now();
  try {
    let parsed: any = null;

    if (provider === "openai") {
      const result = await withTimeout(
        openaiChatJson({ messages, temperature: PEER_REVIEW_TEMPERATURE, maxTokens: PEER_REVIEW_MAX_TOKENS }),
        timeoutMs,
        "OpenAI"
      );
      if (!result.ok) {
        return { provider, verdict: null, raw: null, latencyMs: Date.now() - start, error: result.details, schemaValid: false };
      }
      parsed = parseJsonContentFromChatCompletion(result.json);
    } else {
      const result = await withTimeout(
        xaiChatJson({
          messages,
          temperature: PEER_REVIEW_TEMPERATURE,
          maxTokens: PEER_REVIEW_MAX_TOKENS,
          tools: [
            { type: 'web_search', user_location_country: 'US' },
            // Same trust boundary as the news aggregator — this output
            // feeds a trade verdict, so the source of a rumour matters.
            { type: 'x_search', allowed_x_handles: X_SEARCH_ALLOWED_HANDLES },
          ],
        }),
        timeoutMs,
        "Grok"
      );
      if (!result.ok) {
        return { provider, verdict: null, raw: null, latencyMs: Date.now() - start, error: result.details, schemaValid: false };
      }
      const text = parseTextFromXaiChatCompletion(result.json);
      parsed = parseJsonFromText(text);
    }

    const latencyMs = Date.now() - start;
    const { valid, verdict } = validateAndParsePeerReview(parsed);

    return { provider, verdict, raw: parsed, latencyMs, schemaValid: valid };
  } catch (e: any) {
    return { provider, verdict: null, raw: null, latencyMs: Date.now() - start, error: String(e?.message || e), schemaValid: false };
  }
}

export async function runPeerReviewAnalysis(
  req: PeerReviewRequest
): Promise<PeerReviewConsensus | null> {
  const mode = resolveMode(req.mode);
  const timeoutMs = resolveTimeout(req.timeoutMs);

  if (mode === "off") return null;

  const systemPrompt = `${PEER_REVIEW_PROMPT_CONTRACT}${req.dataGapsPrompt ? `\n\n${req.dataGapsPrompt}` : ""}${req.referenceContext ? `\n\n${req.referenceContext}\n\nUse these player values when evaluating trade value and rankings. Prefer them over general training knowledge when they conflict.` : ""}`;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: req.factLayerPrompt },
  ];

  const results: PeerReviewProviderResult[] = [];

  if (mode === "both") {
    const [openaiResult, grokResult] = await Promise.allSettled([
      callProviderForPeerReview("openai", messages, timeoutMs),
      callProviderForPeerReview("grok", messages, timeoutMs),
    ]);

    results.push(
      openaiResult.status === "fulfilled"
        ? openaiResult.value
        : { provider: "openai", verdict: null, raw: null, latencyMs: 0, error: String(openaiResult.reason), schemaValid: false }
    );
    results.push(
      grokResult.status === "fulfilled"
        ? grokResult.value
        : { provider: "grok", verdict: null, raw: null, latencyMs: 0, error: String(grokResult.reason), schemaValid: false }
    );
  } else {
    const primary: "openai" | "grok" = mode === "openai" ? "openai" : "grok";
    const fallback: "openai" | "grok" = primary === "openai" ? "grok" : "openai";

    const result = await callProviderForPeerReview(primary, messages, timeoutMs);
    results.push(result);

    if (!result.verdict) {
      console.warn(`[peer-review] ${primary} failed, attempting ${fallback} fallback`);
      const fb = await callProviderForPeerReview(fallback, messages, timeoutMs);
      results.push(fb);
    }
  }

  const consensus = mergePeerReviews(results);

  if (consensus) {
    console.log(
      `[peer-review] ${consensus.meta.consensusMethod} | verdict=${consensus.verdict} conf=${consensus.confidence}% | adj=${consensus.meta.confidenceAdjustment}`
    );
  }

  return consensus;
}

async function callOpenAI(
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
  timeoutMs: number
): Promise<ProviderResult> {
  const start = Date.now();
  try {
    const result = await withTimeout(
      openaiChatJson({ messages, temperature, maxTokens }),
      timeoutMs,
      "OpenAI"
    );

    const latencyMs = Date.now() - start;

    if (!result.ok) {
      return {
        provider: "openai",
        analysis: null,
        raw: null,
        latencyMs,
        error: result.details,
        schemaValid: false,
        confidenceScore: 0,
      };
    }

    const parsed = parseJsonContentFromChatCompletion(result.json);
    const { valid, analysis } = validateAndParseAnalysis(parsed);

    const providerResult: ProviderResult = {
      provider: "openai",
      analysis,
      raw: parsed,
      latencyMs,
      schemaValid: valid,
      confidenceScore: 0,
    };
    providerResult.confidenceScore = scoreProviderResult(providerResult);
    return providerResult;
  } catch (e: any) {
    return {
      provider: "openai",
      analysis: null,
      raw: null,
      latencyMs: Date.now() - start,
      error: String(e?.message || e),
      schemaValid: false,
      confidenceScore: 0,
    };
  }
}

async function callGrok(
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
  timeoutMs: number
): Promise<ProviderResult> {
  const start = Date.now();
  try {
    const result = await withTimeout(
      xaiChatJson({ messages, temperature, maxTokens }),
      timeoutMs,
      "Grok"
    );

    const latencyMs = Date.now() - start;

    if (!result.ok) {
      return {
        provider: "grok",
        analysis: null,
        raw: null,
        latencyMs,
        error: result.details,
        schemaValid: false,
        confidenceScore: 0,
      };
    }

    const text = parseTextFromXaiChatCompletion(result.json);
    const parsed = parseJsonFromText(text);
    const { valid, analysis } = validateAndParseAnalysis(parsed);

    const providerResult: ProviderResult = {
      provider: "grok",
      analysis,
      raw: parsed,
      latencyMs,
      schemaValid: valid,
      confidenceScore: 0,
    };
    providerResult.confidenceScore = scoreProviderResult(providerResult);
    return providerResult;
  } catch (e: any) {
    return {
      provider: "grok",
      analysis: null,
      raw: null,
      latencyMs: Date.now() - start,
      error: String(e?.message || e),
      schemaValid: false,
      confidenceScore: 0,
    };
  }
}

export async function runDualBrainTradeAnalysis(
  req: DualBrainRequest
): Promise<ConsensusAnalysis | null> {
  const mode = resolveMode(req.mode);
  const primary = resolvePrimary(req.primary);
  const timeoutMs = resolveTimeout(req.timeoutMs);
  const temperature = req.temperature ?? 0.45;
  const maxTokens = req.maxTokens ?? 2000;

  if (mode === "off") {
    return null;
  }

  // Build provider-specific message arrays with the JSON contract injected
  const openaiMessages: ChatMessage[] = [
    { role: "system", content: `${req.systemPrompt}\n\n${DUAL_BRAIN_JSON_CONTRACT}` },
    { role: "user", content: req.userPrompt },
  ];

  const grokMessages: ChatMessage[] = [
    { role: "system", content: `${req.systemPrompt}\n\n${DUAL_BRAIN_JSON_CONTRACT}\n\n${GROK_NEWS_ADDENDUM}` },
    { role: "user", content: req.userPrompt },
  ];

  const results: ProviderResult[] = [];

  if (mode === "both") {
    const [openaiResult, grokResult] = await Promise.allSettled([
      callOpenAI(openaiMessages, temperature, maxTokens, timeoutMs),
      callGrok(grokMessages, temperature, maxTokens, timeoutMs),
    ]);

    if (openaiResult.status === "fulfilled") results.push(openaiResult.value);
    else
      results.push({
        provider: "openai",
        analysis: null,
        raw: null,
        latencyMs: 0,
        error: String(openaiResult.reason),
        schemaValid: false,
        confidenceScore: 0,
      });

    if (grokResult.status === "fulfilled") results.push(grokResult.value);
    else
      results.push({
        provider: "grok",
        analysis: null,
        raw: null,
        latencyMs: 0,
        error: String(grokResult.reason),
        schemaValid: false,
        confidenceScore: 0,
      });
  } else if (mode === "openai") {
    const result = await callOpenAI(openaiMessages, temperature, maxTokens, timeoutMs);
    results.push(result);

    if (!result.analysis) {
      console.warn("[dual-brain] OpenAI failed, attempting Grok fallback");
      const fallback = await callGrok(grokMessages, temperature, maxTokens, timeoutMs);
      results.push(fallback);
    }
  } else if (mode === "grok") {
    const result = await callGrok(grokMessages, temperature, maxTokens, timeoutMs);
    results.push(result);

    if (!result.analysis) {
      console.warn("[dual-brain] Grok failed, attempting OpenAI fallback");
      const fallback = await callOpenAI(openaiMessages, temperature, maxTokens, timeoutMs);
      results.push(fallback);
    }
  }

  return mergeAnalyses(results, primary);
}
