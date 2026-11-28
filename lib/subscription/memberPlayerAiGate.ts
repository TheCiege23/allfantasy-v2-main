import type { NextResponse } from 'next/server'
import { requireEntitlement } from '@/lib/subscription/requireEntitlement'

/*
 * 🛑 MEMBER PLAYER AI IS AF INTELLIGENCE, NOT AF COMMISSIONER (owner's decision 2026-11-28).
 *
 * The devy, C2C and IDP Chimmy routes (`/api/devy/ai`, `/api/c2c/ai`, `/api/idp/ai`) each serve two kinds
 * of action: host/league tools a commissioner runs (setup, constitution, commissioner chat, recaps…) and
 * the read a league MEMBER asks for on their own player from the player modal (DevyPlayerModal,
 * C2CPlayerModal, IDPPlayerModal). Both used to sit behind `commissioner_ai_tools`, so a member on AF Pro
 * could not use the modal at all. The member reads now take `af_intelligence` (AF Pro, AF Commissioner,
 * AF Supreme) and need no commissioner role; the host tools keep their Commissioner gate.
 *
 * Call it before anything else that spends: it returns the session user id, or the 401/402 response.
 */
export async function requireMemberPlayerAiOrHostGate(
  action: string,
  memberActions: ReadonlySet<string>,
  hostGate: () => Promise<string | NextResponse>,
): Promise<string | NextResponse> {
  if (memberActions.has(action)) return requireEntitlement('af_intelligence')
  return hostGate()
}
