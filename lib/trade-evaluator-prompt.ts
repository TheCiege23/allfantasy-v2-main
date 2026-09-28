import { z } from 'zod';
import { AI_CORE_PERSONALITY, getModeInstructions, SIGNATURE_PHRASES, MEMORY_AWARENESS, WHEN_TO_SPEAK_RULES, ESCALATION_SYSTEM } from '@/lib/ai-personality';
import { getUniversalAIContext } from '@/lib/ai-player-context';

export const NEGOTIATION_RULES = `
NEGOTIATION ASSISTANT RULES (CRITICAL):
- You are generating negotiation UX content ONLY (messages, counters, sweeteners, red lines).
- You MUST NOT change the trade verdict, grades, values, tiers, labels, or veto outcome.
- You MUST NOT invent players, picks, FAAB amounts, or teams.
- You may ONLY reference assets explicitly provided in the payload:
  - candidateTrade assets
  - allowedAssets lists (userAssetsAllowed, partnerAssetsAllowed)
  - availablePicks lists (userPicksAllowed, partnerPicksAllowed)
  - faabRemaining for each team (if present)
- All counters/sweeteners MUST remain within the fairness bands provided (fairnessBandPct).
- If you cannot produce a valid counter within constraints, return fewer counters and explain in rationale.
- All output MUST be valid JSON matching the response schema.
`;

export const NEGOTIATION_USER_INSTRUCTION = `
Generate negotiation content for the provided candidateTrade.

Constraints:
- Use ONLY asset ids in allowedAssets (userAssetsAllowed/partnerAssetsAllowed and picks lists).
- Counters/sweeteners must stay within fairnessConstraints bandMinPct..bandMaxPct.
- Prefer minimal moves: swap within same tier first, then add small FAAB, then late pick sweetener.
- If userObjective is WIN_NOW: emphasize weekly starter upgrades and stability.
- If REBUILD: emphasize picks, youth, flexibility.
- Provide 3-5 DM messages in different tones + 2-4 counters + up to 3 sweeteners + 2-5 redLines.
Return JSON only.
`;

/*
 * ⚠ TWO PROMPTS WERE DELETED HERE 2026-09-27 (trade engine Phase 4), and neither should come back.
 *   - `TRADE_EVALUATOR_SYSTEM_PROMPT` hard-coded named-player tiers, a pick-value table and a grade cap,
 *     and asked the model for its own fairness score. Its only caller, `/api/ai/trade-eval`, had no
 *     client and shipped unvalidated output; it was deleted with it.
 *   - `STRUCTURED_TRADE_EVAL_SYSTEM_PROMPT` asked the model to "evaluate whether this trade is fair".
 *     `/api/trade-evaluator` now explains the one engine's receipt instead
 *     (`lib/decision-os/trade/explainTrade.ts`).
 * A model explains a grade the engine gave. It is never asked to give one.
 */

const BetterAlternativeSchema = z.object({
  teamId: z.string(),
  fitScore: z.number().min(0).max(100),
  whyBetter: z.string(),
  tradeFramework: z.string(),
});

const NegotiationDmMessageSchema = z.object({
  tone: z.enum(['FRIENDLY', 'CONFIDENT', 'CASUAL', 'DATA_BACKED', 'SHORT']),
  hook: z.string().min(4),
  message: z.string().min(10),
});

const NegotiationCounterSchema = z.object({
  label: z.string().min(3),
  ifTheyObject: z.string().min(3),
  counterTrade: z.object({
    youAdd: z.array(z.string()).optional(),
    youRemove: z.array(z.string()).optional(),
    theyAdd: z.array(z.string()).optional(),
    theyRemove: z.array(z.string()).optional(),
    faabAdd: z.number().int().positive().optional(),
  }),
  rationale: z.string().min(8),
});

const NegotiationSweetenerSchema = z.object({
  label: z.string().min(3),
  addOn: z.object({
    faab: z.number().int().positive().optional(),
    pickSwap: z.object({
      youAddPickId: z.string().optional(),
      youRemovePickId: z.string().optional(),
    }).optional(),
  }),
  whenToUse: z.string().min(6),
});

const NegotiationBlockSchema = z.object({
  dmMessages: z.array(NegotiationDmMessageSchema).max(7).optional().default([]),
  counters: z.array(NegotiationCounterSchema).max(6).optional().default([]),
  sweeteners: z.array(NegotiationSweetenerSchema).max(5).optional().default([]),
  redLines: z.array(z.string().min(6)).max(10).optional().default([]),
});

export type NegotiationBlock = z.infer<typeof NegotiationBlockSchema>;
export type NegotiationDmMessage = z.infer<typeof NegotiationDmMessageSchema>;
export type NegotiationCounter = z.infer<typeof NegotiationCounterSchema>;
export type NegotiationSweetener = z.infer<typeof NegotiationSweetenerSchema>;

export const StructuredTradeEvalResponseSchema = z.object({
  verdict: z.object({
    overall: z.enum(['FAIR', 'FAIR_UPSIDE_SKEWED', 'UNFAIR_TEAM_A', 'UNFAIR_TEAM_B']),
    teamA: z.enum(['WIN', 'NEUTRAL', 'LOSS']),
    teamB: z.enum(['WIN', 'NEUTRAL', 'LOSS']),
  }),
  explanation: z.object({
    summary: z.string(),
    teamAReasoning: z.string(),
    teamBReasoning: z.string(),
    leagueContextNotes: z.array(z.string()),
  }),
  confidence: z.object({
    rating: z.enum(['HIGH', 'MEDIUM', 'LEARNING']),
    score: z.number().min(0).max(100),
    drivers: z.array(z.string()),
  }),
  betterAlternatives: z.array(BetterAlternativeSchema),
  riskFlags: z.array(z.string()),
  negotiation: NegotiationBlockSchema.optional(),
});

export type StructuredTradeEvalResponse = z.infer<typeof StructuredTradeEvalResponseSchema>;
