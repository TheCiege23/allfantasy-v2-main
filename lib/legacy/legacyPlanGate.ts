import 'server-only'

import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

/*
 * 🛑 SIGN-IN, THEN THE AF LEGACY PLAN, BEFORE ANY /api/legacy MODEL CALL (owner's decision 2026-11-27).
 *
 * The 2026-11-26 gating audit found five /api/legacy routes that ran OpenAI for anyone — trade-history
 * `grade`, trade-alternatives, devy-board, transfer and community-insights — with `userId` taken from the
 * request body and the session optional. The other AF Legacy deep tools (proposals, Trade Hub, the career
 * report…) already ran `requireFeatureEntitlement` on a `war_room` key; these use the same mechanism.
 *
 * The session is the identity. A body `userId` (a Sleeper name) never is.
 */

export type LegacySession = { userId: string; email: string | null }

export async function legacySignedInUser(): Promise<LegacySession | null> {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string | null; email?: string | null }
    } | null
    const userId = session?.user?.id?.trim()
    return userId ? { userId, email: session?.user?.email ?? null } : null
  } catch {
    return null
  }
}

export function legacySignInResponse(what: string): NextResponse {
  return NextResponse.json(
    { error: 'Sign in required', code: 'sign_in_required', message: `Sign in to use ${what}.` },
    { status: 401 },
  )
}

/** Whole-route gate: 401 signed out, 403 `feature_not_entitled` without the plan. */
export async function requireLegacyPlan(
  featureId: SubscriptionFeatureId,
  what: string,
): Promise<{ ok: true; user: LegacySession } | { ok: false; response: NextResponse }> {
  const user = await legacySignedInUser()
  if (!user) return { ok: false, response: legacySignInResponse(what) }
  const plan = await requireFeatureEntitlement({ userId: user.userId, userEmail: user.email, featureId })
  if (!plan.ok) return { ok: false, response: plan.response }
  return { ok: true, user }
}

/**
 * Soft form, for a route whose deterministic answer stays free and only the model's prose is paid:
 * true only on a POSITIVE plan read. A failed lookup is no plan (fail closed), never a model call.
 */
export async function hasLegacyPlan(user: LegacySession, featureId: SubscriptionFeatureId): Promise<boolean> {
  try {
    const decision = await new FeatureGateService().evaluateUserFeatureAccess(user.userId, featureId, user.email)
    return decision.allowed === true
  } catch {
    return false
  }
}
