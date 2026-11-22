/**
 * AI commentary for power rankings (Prompt 132):
 * - DeepSeek: interpret ranking math
 * - Grok/xAI: narrative explanations
 * - OpenAI: clear ranking summary
 */

import { deepseekChat } from '@/lib/deepseek-client';
import { xaiChatJson, parseTextFromXaiChatCompletion } from '@/lib/xai-client';
import { openaiChatText } from '@/lib/openai-client';
import { isDeepSeekAvailable, isOpenAIAvailable, isXaiAvailable } from '@/lib/provider-config';
import type { PowerRankingsOutput } from './types';

interface PowerRankingsCommentary {
  formulaExplanation: string | null;
  narrativeExplanation: string | null;
  rankingSummary: string | null;
  providerStatus: {
    deepseek: boolean;
    grok: boolean;
    openai: boolean;
  };
}

function buildContext(data: PowerRankingsOutput): string {
  const top = data.teams.slice(0, 5).map((t, i) => {
    const r = t.record;
    return `${i + 1}. ${t.displayName || t.username || `Team ${t.rosterId}`}: ${r.wins}-${r.losses}${r.ties > 0 ? `-${r.ties}` : ''}, PF ${t.pointsFor.toFixed(1)}, PA ${t.pointsAgainst.toFixed(1)}, SOS ${(t.strengthOfSchedule * 100).toFixed(0)}, Recent ${t.recentPerformanceScore.toFixed(0)}, Roster ${t.rosterStrengthScore.toFixed(0)}, Projection ${t.projectionStrengthScore.toFixed(0)}, PowerScore ${t.powerScore.toFixed(1)}${t.rankDelta != null ? ` (${t.rankDelta > 0 ? '+' : ''}${t.rankDelta} vs last week)` : ''}`;
  });
  return `League: ${data.leagueName}, Season ${data.season}, Week ${data.week}.
Formula weights:
- record ${Math.round(data.formula.recordWeight * 100)}%
- recent performance ${Math.round(data.formula.recentPerformanceWeight * 100)}%
- roster strength ${Math.round(data.formula.rosterStrengthWeight * 100)}%
- projection strength ${Math.round(data.formula.projectionStrengthWeight * 100)}%

Top 5:
${top.join('\n')}`;
}

/** DeepSeek: interpret ranking math / formula. */
async function interpretRankingMath(data: PowerRankingsOutput): Promise<string | null> {
  if (!isDeepSeekAvailable()) return null;
  const context = buildContext(data);
  const result = await deepseekChat({
    systemPrompt: 'You explain fantasy league ranking math clearly. Focus on deterministic weighting and the biggest score drivers.',
    prompt: `Explain this ranking math in 2-3 concise sentences. Mention how record, recent performance, roster strength, and projection strength drive the final PowerScore.\n\n${context}`,
    temperature: 0.2,
    maxTokens: 280,
  });
  if (result.error || !result.content?.trim()) return null;
  return result.content.trim();
}

/** Narrative explanation (Grok role). */
async function summarizeNarrative(data: PowerRankingsOutput): Promise<string | null> {
  if (!isXaiAvailable()) return null;
  const context = buildContext(data);
  try {
    const completion = await xaiChatJson({
      model: process.env.XAI_MODEL || process.env.GROK_MODEL || 'grok-2-latest',
      temperature: 0.4,
      maxTokens: 220,
      messages: [
        {
          role: 'system',
          content:
            'You are Grok writing fantasy league storyline blurbs. Highlight momentum, surprises, and context in 2-3 sentences. No bullets.',
        },
        {
          role: 'user',
          content: `Write the narrative storyline for these rankings:\n\n${context}`,
        },
      ],
    });
    if (!completion.ok) return null;
    const text = parseTextFromXaiChatCompletion(completion.json)?.trim();
    return text || null;
  } catch (e) {
    console.error('[PowerRankingsCommentaryAI] narrative', e);
    return null;
  }
}

/** OpenAI: clear ranking summary for users. */
async function buildRankingSummary(data: PowerRankingsOutput): Promise<string | null> {
  if (!isOpenAIAvailable()) return null;
  const context = buildContext(data);
  try {
    const completion = await openaiChatText({
      temperature: 0.3,
      maxTokens: 200,
      messages: [
        {
          role: 'system',
          content:
            'You write a clear fantasy power rankings summary. State #1 team and the most important movement/takeaway in one concise paragraph.',
        },
        { role: 'user', content: context },
      ],
    });
    if (!completion.ok) return null;
    const text = completion.text.trim();
    return text || null;
  } catch (e) {
    console.error('[PowerRankingsCommentaryAI] summary', e);
    return null;
  }
}

/** Full commentary pipeline. */
export async function getPowerRankingsCommentary(data: PowerRankingsOutput): Promise<PowerRankingsCommentary> {
  const providerStatus = {
    deepseek: isDeepSeekAvailable(),
    grok: isXaiAvailable(),
    openai: isOpenAIAvailable(),
  };

  const [formulaExplanation, narrativeExplanation, rankingSummary] = await Promise.all([
    interpretRankingMath(data),
    summarizeNarrative(data),
    buildRankingSummary(data),
  ]);

  return {
    formulaExplanation,
    narrativeExplanation,
    rankingSummary,
    providerStatus,
  };
}
