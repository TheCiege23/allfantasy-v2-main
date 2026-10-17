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
} from "./trade-analysis-schema";

export type TradeAiMode = "openai" | "grok" | "both" | "off";

/*
 * ⚠ `runDualBrainTradeAnalysis`, its JSON contract and its Grok news addendum were DELETED 2026-09-27
 * (trade engine Phase 4). They had no caller anywhere, and they asked two models for their own trade
 * winner and confidence — the pattern the one engine replaces. The peer review below is the live path
 * (`/api/dynasty-trade-analyzer`); converting it to explain the engine receipt is a listed follow-up.
 */

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface PeerReviewRequest {
  factLayerPrompt: string;
  dataGapsPrompt?: string;
  mode?: TradeAiMode;
  timeoutMs?: number;
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

  const systemPrompt = `${PEER_REVIEW_PROMPT_CONTRACT}${req.dataGapsPrompt ? `\n\n${req.dataGapsPrompt}` : ""}`;
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
