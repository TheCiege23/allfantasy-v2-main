/**
 * Grok-generated share copy for viral moments (Prompt 121).
 * Server-only; uses XAI_API_KEY or GROK_API_KEY from env.
 */

import OpenAI from 'openai';
import { buildShareCopySystemPrompt, buildShareCopyUserPrompt } from './SocialSharePromptBuilder';
import type { AchievementShareType, AchievementShareContext } from './types';
import { getShareContent } from './AchievementShareGenerator';
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard';

const GROK_BASE = 'https://api.x.ai/v1';
const GROK_MODEL = 'grok-4-0709';

export interface GrokShareCopyOutput {
  caption: string;
  headline: string;
  cta: string;
  hashtags: string[];
  platformVariants?: Record<string, { caption: string; hashtags: string[] }>;
}

function getApiKey(): string | null {
  const key = process.env.XAI_API_KEY ?? process.env.GROK_API_KEY;
  return key?.trim() || null;
}

function getClient(): OpenAI | null {
  const apiKey = getApiKey();
  // PROVIDER BOUNDARY. Guard form matches this function's own contract: it
  // already returns null when the key is absent, so a spend refusal behaves
  // identically to an unconfigured provider. Above the key check because when
  // both are missing the switch is the actionable one.
  if (!isAiSpendEnabled()) return null;

  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: GROK_BASE });
}

export function isGrokShareConfigured(): boolean {
  return !!getApiKey();
}

export async function generateShareCopy(
  shareType: AchievementShareType,
  context: AchievementShareContext,
  sport: string
): Promise<GrokShareCopyOutput | null> {
  const client = getClient();
  if (!client) {
    console.error('[GrokShareCopy] XAI_API_KEY/GROK_API_KEY not set');
    return null;
  }

  const systemPrompt = buildShareCopySystemPrompt(shareType, context, sport);
  const userPrompt = buildShareCopyUserPrompt(shareType, context);

  try {
    const response = await client.chat.completions.create({
      model: GROK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 600,
    });

    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;

    const parsed = parseJsonContent(content);
    if (!parsed) return null;

    return normalizeShareCopyOutput(parsed);
  } catch (err) {
    console.error('[GrokShareCopy] Grok request failed', err);
    return null;
  }
}

/**
 * Fallback to template content when Grok is unavailable.
 */
export function getTemplateShareCopy(
  shareType: AchievementShareType,
  context: AchievementShareContext
): GrokShareCopyOutput {
  const content = getShareContent(shareType, context);
  const hashtags = content.hashtags.map((h) => (h.startsWith('#') ? h.slice(1) : h));
  return {
    caption: content.text,
    headline: content.title,
    cta: 'Join the action on AllFantasy',
    hashtags,
    platformVariants: {
      x: { caption: content.text.slice(0, 260), hashtags },
      instagram: { caption: content.text, hashtags },
    },
  };
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

function normalizeShareCopyOutput(parsed: Record<string, unknown>): GrokShareCopyOutput {
  const str = (v: unknown, fallback: string) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : fallback;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 12) : [];

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
    caption: str(parsed.caption, 'Check out my fantasy moment on AllFantasy!'),
    headline: str(parsed.headline, 'Fantasy Win'),
    cta: str(parsed.cta, 'Join AllFantasy'),
    hashtags: arr(parsed.hashtags),
    platformVariants: Object.keys(platformVariants).length > 0 ? platformVariants : undefined,
  };
}
