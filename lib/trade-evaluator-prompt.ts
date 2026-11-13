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

