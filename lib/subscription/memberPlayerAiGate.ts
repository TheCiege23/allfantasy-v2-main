import { NextResponse } from 'next/server'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import { requireEntitlement } from '@/lib/subscription/requireEntitlement'

/*
 * 🛑 MEMBER PLAYER AI IS CHIMMY INTELLIGENCE, NOT AF COMMISSIONER (owner's decisions 2026-11-28).
 *
 * The devy, C2C and IDP Chimmy routes (`/api/devy/ai`, `/api/c2c/ai`, `/api/idp/ai`) each serve two kinds
 * of action: host/league tools a commissioner runs (setup, constitution, commissioner chat, recaps…) and
 * the advice a league MEMBER asks for about their own roster and players (the player modals, the pipeline
 * check, promote-or-hold, transition and draft advice, rankings). Both used to sit behind
 * `commissioner_ai_tools`, so a member on AF Pro could not use any of it. The member actions now take
 * `af_intelligence` (AF Pro, AF Commissioner, AF Supreme) and need no commissioner role; the host tools keep
 * their Commissioner gate.
 *
 * Every model call also has a daily cap (owner, 2026-11-28): a member action passes `req`, and after the plan
 * the durable cap AI_COST_GATES.member_player_ai is taken. Host tools keep whatever their host gate does.
 *
 * Call it before anything else that spends: it returns the session user id, or the 401/402/429 response.
 */
export async function requireMemberPlayerAi(req?: Request): Promise<string | NextResponse> {
  const userId = await requireEntitlement('af_intelligence')
  if (typeof userId !== 'string') return userId
  if (req) {
    const capped = await aiCostGate(req, 'member_player_ai', userId)
    if (capped) return capped
  }
  return userId
}

export async function requireMemberPlayerAiOrHostGate(
  action: string,
  memberActions: ReadonlySet<string>,
  hostGate: () => Promise<string | NextResponse>,
  req?: Request,
): Promise<string | NextResponse> {
  if (memberActions.has(action)) return requireMemberPlayerAi(req)
  return hostGate()
}
