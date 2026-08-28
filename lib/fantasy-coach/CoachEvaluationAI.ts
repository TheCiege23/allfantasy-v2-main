/**
 * AI layer for coach evaluation.
 * DeepSeek: roster math evaluation.
 * Grok: strategy framing.
 * OpenAI: coach-style recommendation.
 * Deterministic fallbacks keep the dashboard usable if providers are unavailable.
 */

import OpenAI from 'openai';
import { deepseekChat } from '@/lib/deepseek-client';
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard';
import type { CoachEvaluationResult, CoachProviderInsights } from './types';

function getOpenAIClient(): OpenAI | null {
  /*
   * PROVIDER BOUNDARY. Three providers live in this file: deepseekChat comes
   * from the GUARDED @/lib/deepseek-client, while this OpenAI client and the
   * Grok one below were built here and metered by nothing. A census asking
   * whether a module references a guarded client answers yes and moves on —
   * ask what a file CONSTRUCTS instead.
   *
   * Non-throwing to match the contract, and to match this file's own header:
   * the factories return `OpenAI | null` and the callers fall back to
   * deterministic output when a provider is unavailable. A spend refusal is
   * exactly that case, so it degrades rather than fails.
   */
  if (!isAiSpendEnabled()) return null;

  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  return new OpenAI({
    apiKey,
    baseURL:
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      'https://api.openai.com/v1',
  });
}

function getGrokClient(): OpenAI | null {
  // Same boundary, second provider. Guarded separately because either factory
  // can be reached without the other.
  if (!isAiSpendEnabled()) return null;

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!apiKey) return null;

  return new OpenAI({
    apiKey,
    baseURL:
      process.env.GROK_BASE_URL || process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
  });
}

function buildEvalContext(evalResult: CoachEvaluationResult): string {
  const metrics = evalResult.evaluationMetrics
    .map((metric) => `${metric.label}: ${metric.score}/100 (${metric.summary})`)
    .join(' ');

  return [
    `Sport: ${evalResult.sport}.`,
    `Team: ${evalResult.teamSnapshot.teamName}.`,
    `Week: ${evalResult.teamSnapshot.week}.`,
    `Adjusted projection: ${evalResult.teamSnapshot.adjustedProjection.toFixed(1)}.`,
    `Range: ${evalResult.teamSnapshot.adjustedFloor.toFixed(1)}-${evalResult.teamSnapshot.adjustedCeiling.toFixed(1)}.`,
    `Schedule adjustment: ${evalResult.teamSnapshot.scheduleAdjustment >= 0 ? '+' : ''}${evalResult.teamSnapshot.scheduleAdjustment.toFixed(1)}.`,
    `Strongest slot: ${evalResult.teamSnapshot.strongestSlot}. Weakest slot: ${evalResult.teamSnapshot.weakestSlot}. Swing slot: ${evalResult.teamSnapshot.swingSlot}.`,
    `Strengths: ${evalResult.rosterStrengths.join(' ')}`,
    `Weaknesses: ${evalResult.rosterWeaknesses.join(' ')}`,
    `Lineup improvements: ${evalResult.lineupImprovements.join(' ')}`,
    `Waiver opportunities: ${evalResult.waiverOpportunities.map((item) => `${item.playerName} (${item.position ?? 'UTIL'}) - ${item.reason}`).join(' ')}`,
    `Trade suggestions: ${evalResult.tradeSuggestions.map((item) => `${item.summary} ${item.targetHint ?? ''}`).join(' ')}`,
    `Metrics: ${metrics}`,
    `Summary: ${evalResult.teamSummary}`,
  ].join(' ');
}

async function maybeCallOpenAI(system: string, user: string): Promise<string | null> {
  const client = getOpenAIClient();
  if (!client) return null;

  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_COACH_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 180,
      temperature: 0.45,
    });

    return completion.choices[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error('[CoachEvaluationAI] openai', error);
    return null;
  }
}

async function maybeCallGrok(system: string, user: string): Promise<string | null> {
  const client = getGrokClient();
  if (!client) return null;

  try {
    const completion = await client.chat.completions.create({
      model: process.env.XAI_MODEL || process.env.GROK_MODEL || 'grok-2-latest',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 130,
      temperature: 0.5,
    });

    return completion.choices[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error('[CoachEvaluationAI] grok', error);
    return null;
  }
}

export async function evaluateRosterMath(
  evalResult: CoachEvaluationResult
): Promise<string | null> {
  const context = buildEvalContext(evalResult);
  const result = await deepseekChat({
    systemPrompt:
      'You interpret fantasy roster math. In 2 concise sentences, explain the projection band, strongest edge, weakest slot, and how the numbers shape roster management.',
    prompt: context,
    temperature: 0.15,
    maxTokens: 180,
  });

  return result.content?.trim() || null;
}

export async function buildStrategyInsight(
  evalResult: CoachEvaluationResult
): Promise<string | null> {
  const context = buildEvalContext(evalResult);
  return maybeCallGrok(
    'You are Grok writing one sharp fantasy strategy framing paragraph. Keep it grounded in the provided deterministic roster context and focus on storyline plus actionable strategy.',
    context
  );
}

export async function buildWeeklyAdvice(
  evalResult: CoachEvaluationResult
): Promise<string | null> {
  const context = buildEvalContext(evalResult);
  return maybeCallOpenAI(
    'You are the AllFantasy AI Coach. Give one short coach-style recommendation in 2-3 sentences. Be direct, practical, and specific about the next move.',
    context
  );
}

export async function enrichCoachEvaluationWithAI(
  evalResult: CoachEvaluationResult
): Promise<CoachEvaluationResult> {
  const [deepseek, grok, openai] = await Promise.all([
    evaluateRosterMath(evalResult),
    buildStrategyInsight(evalResult),
    buildWeeklyAdvice(evalResult),
  ]);

  const providerInsights: CoachProviderInsights = {
    deepseek: deepseek ?? evalResult.providerInsights.deepseek,
    grok: grok ?? evalResult.providerInsights.grok,
    openai: openai ?? evalResult.providerInsights.openai,
  };

  return {
    ...evalResult,
    providerInsights,
    rosterMathSummary: providerInsights.deepseek,
    strategyInsight: providerInsights.grok,
    weeklyAdvice: providerInsights.openai,
  };
}
