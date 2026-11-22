/**
 * The pick order a real league's draft uses, for the league-derived mock tools (pick path, board
 * prediction, snipe radar, trade optimizer). They modelled snake order for every league, so a linear
 * league's picks, and every 3RR league's rounds 3+, were simulated at slots that league never picks.
 *
 * Source, in order: the league's current draft session (what the draft room runs), then the league's
 * draft settings (`getDraftConfigForLeague`, before a session exists), then snake. Anything but snake
 * (linear, or an auction, which has no pick order to model) runs linear, as `computePickInventory`
 * reads it; third-round reversal applies to snake only (`getDraftOrderBehavior`).
 */
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'
import { getDraftOrderBehavior } from '@/lib/draft-defaults/DraftOrderRuleResolver'
import type { MockDraftOrder } from '@/lib/mock-draft/mockTeamCount'

export function mockDraftOrderFrom(draftType: unknown, thirdRoundReversal: unknown): MockDraftOrder {
  const snake = String(draftType ?? 'snake').toLowerCase() === 'snake'
  const behavior = getDraftOrderBehavior(snake ? 'snake' : 'linear', Boolean(thirdRoundReversal))
  return { draftType: behavior.rule, thirdRoundReversal: behavior.thirdRoundReversal }
}

export async function resolveLeagueMockDraftOrder(leagueId: string): Promise<MockDraftOrder> {
  try {
    const session = await prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { draftType: true, thirdRoundReversal: true },
    })
    if (session) return mockDraftOrderFrom(session.draftType, session.thirdRoundReversal)
    const config = await getDraftConfigForLeague(leagueId)
    if (config) return mockDraftOrderFrom(config.draft_type, config.third_round_reversal)
  } catch {
    // An unreadable draft config is not a reason to fail the tool; it reads as snake, as it always did.
  }
  return { draftType: 'snake', thirdRoundReversal: false }
}
