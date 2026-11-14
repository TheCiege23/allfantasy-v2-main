/**
 * AI Social Clip Engine — provider-safe orchestration (PROMPT 146).
 * xAI (narrative) → DeepSeek (fact check) → OpenAI (polish). Retry and fallback.
 */

import { xaiChatJson, parseTextFromXaiChatCompletion } from "@/lib/xai-client";
import { openaiChatText } from "@/lib/openai-client";
import { deepseekChat } from "@/lib/deepseek-client";
import { normalizeToSupportedSport } from "@/lib/sport-scope";
import {
  isOpenAIAvailable,
  isXaiAvailable,
  isDeepSeekAvailable,
} from "@/lib/provider-config";
import type {
  AIClipGenerateInput,
  AIClipResult,
  ProviderStepResult,
  ProviderRole,
  DeterministicFacts,
} from "./types";
import {
  buildXaiSystemPrompt,
  buildXaiUserPrompt,
  buildDeepSeekSystemPrompt,
  buildDeepSeekUserPrompt,
  buildOpenAISystemPrompt,
  buildOpenAIUserPrompt,
} from "./prompts";
import { moderateAIClipResult } from "./moderation";

const MAX_RETRIES = 2;

function parseJsonFromContent(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}") + 1;
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeToClipResult(parsed: Record<string, unknown>): AIClipResult {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 10) : [];
  const str = (v: unknown, fallback: string): string =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : fallback;

  const platformVariants: Record<string, { caption: string; hashtags: string[] }> = {};
  const pv = parsed.platformVariants;
  if (pv && typeof pv === "object" && !Array.isArray(pv)) {
    for (const [k, v] of Object.entries(pv)) {
      if (v && typeof v === "object" && v !== null && "caption" in v) {
        const cap = typeof (v as any).caption === "string" ? (v as any).caption : "";
        const tags = arr((v as any).hashtags);
        platformVariants[k] = { caption: cap.slice(0, 300), hashtags: tags };
      }
    }
  }

  const thread = parsed.thread;
  const threadArr = Array.isArray(thread)
    ? (thread as unknown[]).filter((x): x is string => typeof x === "string").map((s) => s.slice(0, 280))
    : undefined;

  return {
    shortCaption: str(parsed.shortCaption, "Fantasy recap from AllFantasy."),
    headline: str(parsed.headline, "Fantasy Recap"),
    ctaText: str(parsed.ctaText, "Get more at AllFantasy"),
    hashtags: arr(parsed.hashtags),
    socialCardCopy: str(parsed.socialCardCopy, "AllFantasy"),
    clipTitle: str(parsed.clipTitle, "Fantasy Clip"),
    platformVariants: Object.keys(platformVariants).length > 0 ? platformVariants : undefined,
    thread: threadArr?.length ? threadArr : undefined,
    providersUsed: [],
    factCheckPassed: undefined,
  };
}

/** Step 1: xAI — narrative framing, viral angle. */
async function runXaiStep(input: AIClipGenerateInput): Promise<ProviderStepResult> {
  try {
    const res = await xaiChatJson({
      messages: [
        { role: "system", content: buildXaiSystemPrompt(input) },
        { role: "user", content: buildXaiUserPrompt(input) },
      ],
      temperature: 0.6,
      maxTokens: 1200,
      responseFormat: { type: "json_object" },
    });
    if (!res.ok) {
      return { provider: "xai", success: false, error: res.details };
    }
    const text = parseTextFromXaiChatCompletion(res.json);
    const parsed = text ? parseJsonFromContent(text) : null;
    if (!parsed) return { provider: "xai", success: false, error: "Invalid JSON" };
    return { provider: "xai", success: true, json: parsed };
  } catch (e: any) {
    return { provider: "xai", success: false, error: e?.message ?? "xAI error" };
  }
}

/** Step 2: DeepSeek — fact consistency check. */
async function runDeepSeekStep(
  facts: DeterministicFacts | undefined,
  copyToCheck: string
): Promise<{ pass: boolean; issues: string[] }> {
  if (!facts || Object.keys(facts).length === 0) {
    return { pass: true, issues: [] };
  }
  try {
    const res = await deepseekChat({
      prompt: buildDeepSeekUserPrompt(facts, copyToCheck),
      systemPrompt: buildDeepSeekSystemPrompt(),
      temperature: 0.1,
      maxTokens: 400,
    });
    if (res.error || !res.content) return { pass: true, issues: [] };
    const parsed = parseJsonFromContent(res.content);
    if (!parsed) return { pass: true, issues: [] };
    const pass = parsed.pass === true;
    const issues = Array.isArray(parsed.issues)
      ? (parsed.issues as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    return { pass, issues };
  } catch {
    return { pass: true, issues: [] };
  }
}

/** Step 3: OpenAI — polished final copy. */
async function runOpenAIStep(draftJson: string, input: AIClipGenerateInput): Promise<ProviderStepResult> {
  try {
    const res = await openaiChatText({
      messages: [
        { role: "system", content: buildOpenAISystemPrompt(input) },
        { role: "user", content: buildOpenAIUserPrompt(draftJson) },
      ],
      temperature: 0.4,
      maxTokens: 1200,
    });
    if (!res.ok) {
      return { provider: "openai", success: false, error: res.details };
    }
    const parsed = res.text ? parseJsonFromContent(res.text) : null;
    if (!parsed) return { provider: "openai", success: false, error: "Invalid JSON" };
    return { provider: "openai", success: true, json: parsed };
  } catch (e: any) {
    return { provider: "openai", success: false, error: e?.message ?? "OpenAI error" };
  }
}

function isOpenAIConfigured(): boolean {
  return isOpenAIAvailable();
}

function isXaiConfigured(): boolean {
  return isXaiAvailable();
}

function isDeepSeekConfigured(): boolean {
  return isDeepSeekAvailable();
}

interface OrchestratorResult {
  success: boolean;
  result: AIClipResult | null;
  error?: string;
  providerStatus: { xai: boolean; openai: boolean; deepseek: boolean };
}

/**
 * Run the full pipeline: xAI → (optional DeepSeek fact check) → OpenAI polish.
 * Fallback: if xAI fails, try OpenAI-only generation; if OpenAI fails, use xAI output as final.
 */
export async function runAISocialClipPipeline(
  input: AIClipGenerateInput
): Promise<OrchestratorResult> {
  const sport = normalizeToSupportedSport(input.sport);
  const providerStatus = {
    xai: isXaiConfigured(),
    openai: isOpenAIConfigured(),
    deepseek: isDeepSeekConfigured(),
  };

  if (!providerStatus.xai && !providerStatus.openai) {
    return {
      success: false,
      result: null,
      error: "No AI provider available. Configure XAI_API_KEY or OPENAI_API_KEY.",
      providerStatus,
    };
  }

  let draft: Record<string, unknown> | null = null;
  const providersUsed: ProviderRole[] = [];

  // Step 1: xAI narrative (or skip if not configured)
  if (providerStatus.xai) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const step = await runXaiStep(input);
      if (step.success && step.json) {
        draft = step.json;
        providersUsed.push("xai");
        break;
      }
      if (attempt === MAX_RETRIES && !draft && providerStatus.openai) {
        // Fallback: ask OpenAI to generate from scratch
        const openaiOnly = await runOpenAIStep(
          JSON.stringify({
            shortCaption: "Fantasy insight from AllFantasy.",
            headline: "Fantasy Recap",
            ctaText: "Get more at AllFantasy",
            hashtags: ["AllFantasy", "FantasySports"],
            socialCardCopy: "AllFantasy",
            clipTitle: "Fantasy Clip",
          }),
          input
        );
        if (openaiOnly.success && openaiOnly.json) {
          draft = openaiOnly.json;
          providersUsed.push("openai");
        }
      }
    }
  }

  if (!draft && providerStatus.openai) {
    const step = await runOpenAIStep(
      JSON.stringify({
        shortCaption: "Fantasy insight from AllFantasy.",
        headline: "Fantasy Recap",
        ctaText: "Get more at AllFantasy",
        hashtags: ["AllFantasy", "FantasySports"],
        socialCardCopy: "AllFantasy",
        clipTitle: "Fantasy Clip",
      }),
      input
    );
    if (step.success && step.json) {
      draft = step.json;
      if (!providersUsed.includes("openai")) providersUsed.push("openai");
    }
  }

  if (!draft) {
    return {
      success: false,
      result: null,
      error: "Generation failed. Try again or check provider configuration.",
      providerStatus,
    };
  }

  // Step 2: DeepSeek fact check (optional)
  let factCheckPassed: boolean | undefined;
  if (providerStatus.deepseek && input.deterministicFacts && Object.keys(input.deterministicFacts).length > 0) {
    const copyToCheck = [
      draft.shortCaption,
      draft.headline,
      draft.socialCardCopy,
    ]
      .filter(Boolean)
      .map((v) => String(v))
      .join("\n");
    const { pass } = await runDeepSeekStep(input.deterministicFacts, copyToCheck);
    factCheckPassed = pass;
  }

  // Step 3: OpenAI polish (if we have draft from xAI and OpenAI is available)
  let final = normalizeToClipResult(draft);
  if (providerStatus.openai && draft && providersUsed.includes("xai")) {
    const polish = await runOpenAIStep(JSON.stringify(draft), input);
    if (polish.success && polish.json) {
      final = normalizeToClipResult(polish.json);
      if (!providersUsed.includes("openai")) providersUsed.push("openai");
    }
  }

  final.providersUsed = providersUsed;
  final.factCheckPassed = factCheckPassed;

  // Moderation
  const mod = moderateAIClipResult(final);
  if (!mod.passed) {
    return {
      success: false,
      result: null,
      error: mod.reason ?? "Output did not pass moderation.",
      providerStatus,
    };
  }

  return { success: true, result: final, providerStatus };
}

export { isXaiConfigured, isOpenAIConfigured, isDeepSeekConfigured };
