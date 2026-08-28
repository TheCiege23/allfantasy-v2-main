/**
 * Calls Grok API to generate social content (Prompt 116).
 * Server-only; loads credentials via centralized provider config.
 */

import OpenAI from 'openai';
import { buildSocialSystemPrompt, buildSocialUserPrompt } from './SocialPromptBuilder';
import type { SocialPromptBuildInput, GrokSocialOutput } from './types';
import { getXaiConfigFromEnv } from '@/lib/provider-config';
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard';

const DEFAULT_GROK_MODEL = 'grok-4-0709';

function getClient(): { client: OpenAI; model: string } | null {
  // PROVIDER BOUNDARY. Found by the census scan below, not by either list —
  // it was on no ratchet and in no GUARDED entry, so nothing was watching it.
  // Non-throwing to match the contract: this already returns null when the
  // provider is unconfigured, and every caller handles that.
  if (!isAiSpendEnabled()) return null;

  const cfg = getXaiConfigFromEnv();
  if (!cfg) return null;
  return {
    client: new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl,
    }),
    model: cfg.model || DEFAULT_GROK_MODEL,
  };
}

export function isGrokConfigured(): boolean {
  return !!getXaiConfigFromEnv();
}

export async function generateSocialContent(
  input: SocialPromptBuildInput
): Promise<GrokSocialOutput | null> {
  const runtime = getClient();
  if (!runtime) {
    console.error('[GrokSocialContent] xAI provider is not configured');
    return null;
  }
  const { client, model } = runtime;

  const systemPrompt = buildSocialSystemPrompt(input);
  const userPrompt = buildSocialUserPrompt(input);

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1200,
    });

    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;

    const parsed = parseJsonContent(content);
    if (!parsed) return null;

    return normalizeGrokOutput(parsed);
  } catch (err) {
    console.error('[GrokSocialContent] Grok request failed', err);
    return null;
  }
}

function parseJsonContent(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}') + 1;
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeGrokOutput(parsed: Record<string, unknown>): GrokSocialOutput {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
  const str = (v: unknown, fallback: string): string =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : fallback;

  const platformVariants: Record<string, { caption: string; hashtags: string[] }> = {};
  const pv = parsed.platformVariants;
  if (pv && typeof pv === 'object' && !Array.isArray(pv)) {
    for (const [k, v] of Object.entries(pv)) {
      if (v && typeof v === 'object' && v !== null && 'caption' in v) {
        const cap = typeof (v as any).caption === 'string' ? (v as any).caption : '';
        const tags = arr((v as any).hashtags);
        platformVariants[k] = { caption: cap.slice(0, 300), hashtags: tags };
      }
    }
  }

  return {
    shortCaption: str(parsed.shortCaption, 'Fantasy recap from AllFantasy.'),
    shortScriptOverlay: str(parsed.shortScriptOverlay, 'AllFantasy Game Break'),
    headline: str(parsed.headline, 'Fantasy Recap'),
    ctaText: str(parsed.ctaText, 'Get more at AllFantasy'),
    hashtags: arr(parsed.hashtags),
    socialCardCopy: str(parsed.socialCardCopy, 'AllFantasy'),
    clipTitle: str(parsed.clipTitle, 'Fantasy Clip'),
    platformVariants: Object.keys(platformVariants).length > 0 ? platformVariants : undefined,
  };
}
