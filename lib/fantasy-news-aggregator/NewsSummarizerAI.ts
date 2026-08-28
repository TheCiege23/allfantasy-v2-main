/**
 * AI-summarized headlines for fantasy news (Prompt 118).
 * Batches titles and returns short summarized headlines.
 */

import OpenAI from 'openai';
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard';

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  // PROVIDER BOUNDARY. Guard form matches this function's own contract: it
  // already returns null when the key is absent, so a spend refusal behaves
  // identically to an unconfigured provider. Above the key check because when
  // both are missing the switch is the actionable one.
  if (!isAiSpendEnabled()) return null;

  if (!apiKey) return null;
  if (!openai) {
    openai = new OpenAI({
      apiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });
  }
  return openai;
}

const MAX_BATCH = 15;
const SUMMARIZE_PROMPT = `You are a fantasy sports editor. For each news headline below, output a very short summarized headline (one line, under 80 chars) that keeps the fantasy-relevant takeaway. Keep player/team names and key facts. Output only the summarized headlines, one per line, in the same order as the input. No numbering or bullets.`;

export interface ItemForSummary {
  id: string;
  title: string;
}

/**
 * Returns a map of item id -> summarized headline. Missing or failed entries fall back to original title.
 */
export async function summarizeHeadlines(
  items: ItemForSummary[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (items.length === 0) return result;

  const batch = items.slice(0, MAX_BATCH);
  const titles = batch.map((i) => i.title);
  const byId = new Map(batch.map((i) => [i.id, i.title]));

  for (const item of items) {
    result[item.id] = item.title;
  }

  const client = getOpenAIClient();
  if (!client) {
    return result;
  }

  try {
    const inputText = titles.join('\n');
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: `${SUMMARIZE_PROMPT}\n\nInput headlines:\n${inputText}` },
      ],
      max_tokens: 1024,
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return result;

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    batch.forEach((item, idx) => {
      const summarized = lines[idx];
      if (summarized) {
        result[item.id] = summarized.length > 120 ? summarized.slice(0, 117) + '...' : summarized;
      }
    });
  } catch (e) {
    console.error('[NewsSummarizerAI]', e);
  }

  return result;
}
