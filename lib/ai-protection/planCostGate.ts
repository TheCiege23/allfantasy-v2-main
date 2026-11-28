/**
 * A plan, THEN a daily cap, for the expensive player tools (owner's decision 2026-11-28).
 *
 * Not a new limiter: the plan is `requireFeatureEntitlement` (403 feature_not_entitled with the plan and its
 * upgrade path, the shape every lock card already reads) and the cap is `aiCostGate` (lib/ai-protection/costGate.ts,
 * durable on apiRateLimitRecord). The plan check runs first and fails CLOSED whether or not the paywall has
 * launched, so a locked plan never reaches the counter, let alone a model.
 *
 * Returns the response to send back, or null to go ahead. Call it immediately before the model call.
 */
import 'server-only'

import type { NextResponse } from 'next/server'

import { aiCostGate, type AiCostGateKey } from '@/lib/ai-protection/costGate'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

export async function requirePlanThenAiCostGate(
  req: Request,
  args: { userId: string; email?: string | null; featureId: SubscriptionFeatureId; capKey: AiCostGateKey },
): Promise<NextResponse | null> {
  const plan = await requireFeatureEntitlement({
    userId: args.userId,
    userEmail: args.email ?? null,
    featureId: args.featureId,
  })
  if (!plan.ok) return plan.response
  return aiCostGate(req, args.capKey, args.userId, { email: args.email ?? null })
}
