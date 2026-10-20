import 'server-only'

/**
 * The weighted lottery as a dynasty rookie-draft ORDER, run once per rookie draft.
 *
 * 🛑 THE STORED RESULT HAD NO AGE. `resolveWeightedLotterySlotOrderForLeague` seats whatever
 * `draft_lottery_last_result` holds, so a league that chose the lottery and never pressed "Run" got
 * worst-to-first (or, a year later, LAST year's draw) on the rookie draft the lottery exists for.
 *
 * Now `createNextLeagueDraft` asks this module for the order. A result counts only when it was run
 * AFTER the league's previous draft finished — a draw made before then belonged to that draft. When
 * there is none, the lottery runs here, with a seed derived from the league and the season it seeds
 * (`<leagueId>:rookie-draft:<season>`), is stored exactly as the commissioner's "Run lottery" stores
 * it, and is written to the league audit log. A retry finds the stored result and reuses it, so a
 * draft is ordered by one draw however many times creation is attempted.
 *
 * Leagues that have not chosen `weighted_lottery` are untouched: this returns null without reading
 * or running anything, and their order stays worst-to-first.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkDynastyLotteryEligibility } from './dynastyYearGuard'
import { getDraftOrderModeAndLotteryConfig, setDraftOrderModeAndLotteryConfig } from './lotteryConfigStorage'
import { runWeightedLottery } from './WeightedDraftLotteryEngine'
import type { WeightedLotteryResult } from './types'
import { logAction } from '@/server/services/auditService'

export type RookieLotterySlot = { slot: number; rosterId: string; displayName: string }

/** A stored result is this draft's when it was drawn after the previous draft finished. */
export function isLotteryResultForNextDraft(
  result: Pick<WeightedLotteryResult, 'runAt' | 'slotOrder'> | null | undefined,
  previousDraftEndedAt: Date | null,
): boolean {
  if (!result || !Array.isArray(result.slotOrder) || result.slotOrder.length === 0) return false
  if (!previousDraftEndedAt) return true
  const ranAt = Date.parse(String(result.runAt ?? ''))
  return Number.isFinite(ranAt) && ranAt >= previousDraftEndedAt.getTime()
}

export function rookieDraftLotterySeed(leagueId: string, season: number): string {
  return `${leagueId}:rookie-draft:${season}`
}

function toSlots(order: WeightedLotteryResult['slotOrder']): RookieLotterySlot[] {
  return order.map((e) => ({ slot: Number(e.slot), rosterId: String(e.rosterId), displayName: String(e.displayName ?? '') }))
}

export async function ensureRookieDraftLottery(input: {
  leagueId: string
  /** The season the rookie draft seeds. */
  season: number
  previousDraftEndedAt: Date | null
  actorUserId: string
}): Promise<{ slotOrder: RookieLotterySlot[]; ranNow: boolean; seed: string } | null> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { dynastyConfig: { select: { rookiePickOrderMethod: true } } },
  })
  if (league?.dynastyConfig?.rookiePickOrderMethod !== 'weighted_lottery') return null

  const eligibility = await checkDynastyLotteryEligibility(input.leagueId)
  if (!eligibility.eligible) return null

  const stored = await getDraftOrderModeAndLotteryConfig(input.leagueId)
  if (isLotteryResultForNextDraft(stored.lotteryLastResult, input.previousDraftEndedAt)) {
    const result = stored.lotteryLastResult!
    return { slotOrder: toSlots(result.slotOrder), ranNow: false, seed: result.seed }
  }

  const seed = rookieDraftLotterySeed(input.leagueId, input.season)
  const result = await runWeightedLottery(
    input.leagueId,
    { ...stored.lotteryConfig, enabled: true, randomSeed: seed, auditSeed: seed },
    seed,
  )
  if (!result || result.slotOrder.length === 0) return null

  await setDraftOrderModeAndLotteryConfig(input.leagueId, {
    draftOrderMode: 'weighted_lottery',
    lotteryLastSeed: seed,
    lotteryLastRunAt: result.runAt,
    lotteryLastResult: result,
    lotteryConfig: { auditSeed: seed, randomSeed: seed },
  })

  await logAction({
    leagueId: input.leagueId,
    userId: input.actorUserId,
    actionType: 'draft_lottery_run',
    entityType: 'league',
    entityId: input.leagueId,
    afterState: {
      season: input.season,
      seed,
      runAt: result.runAt,
      lotteryDraws: result.lotteryDraws,
      slotOrder: result.slotOrder,
      oddsSnapshot: result.oddsSnapshot,
      trigger: 'rookie_draft_created',
    } as unknown as Prisma.InputJsonValue,
  }).catch(() => null)

  return { slotOrder: toSlots(result.slotOrder), ranNow: true, seed }
}
