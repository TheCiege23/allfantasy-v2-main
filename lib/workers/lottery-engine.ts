import 'server-only'

import { prisma } from '@/lib/prisma'
import { assertLiveDraftContext } from '@/lib/draft/resolve-draft-context'
import { previewLotteryOdds, runWeightedLottery } from '@/lib/draft-lottery/WeightedDraftLotteryEngine'
import { legacyDraftLotteryRestriction } from '@/lib/draft-lottery/dynastyYearGuard'
import {
  getDraftOrderModeAndLotteryConfig,
  setDraftOrderModeAndLotteryConfig,
} from '@/lib/draft-lottery/lotteryConfigStorage'

export type LotteryResult = {
  draftId: string
  leagueId: string
  seed: string
  runAt: string
  slotOrder: Array<{ slot: number; rosterId: string; displayName: string }>
  lotteryDraws: Array<{ pickSlot: number; rosterId: string; displayName: string; originalOrder: number }>
  fallbackOrder: Array<{ slot: number; rosterId: string; displayName: string }>
  oddsSnapshot: Array<{ rosterId: string; weight: number; oddsPercent: number }>
}

export async function previewDraftLottery(draftId: string) {
  const context = await assertLiveDraftContext(draftId)
  const restriction = await legacyDraftLotteryRestriction(context.leagueId, context.draftId)
  if (restriction) throw new Error(restriction)
  const { lotteryConfig } = await getDraftOrderModeAndLotteryConfig(context.leagueId)
  return previewLotteryOdds(context.leagueId, lotteryConfig)
}

export async function runDraftLottery(
  draftId: string,
  options?: { finalize?: boolean; seed?: string }
): Promise<LotteryResult> {
  const context = await assertLiveDraftContext(draftId)
  const restriction = await legacyDraftLotteryRestriction(context.leagueId, context.draftId)
  if (restriction) throw new Error(restriction)
  const { lotteryConfig } = await getDraftOrderModeAndLotteryConfig(context.leagueId)
  const seed =
    options?.seed && options.seed.trim()
      ? options.seed.trim()
      : `lottery-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  const result = await runWeightedLottery(context.leagueId, {
    ...lotteryConfig,
    enabled: true,
    randomSeed: seed,
    auditSeed: seed,
  }, seed)

  if (!result) {
    throw new Error('Unable to run lottery')
  }

  if (options?.finalize) {
    await prisma.draftSession.update({
      where: { id: context.draftId },
      data: {
        slotOrder: result.slotOrder as any,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    })

    await setDraftOrderModeAndLotteryConfig(context.leagueId, {
      draftOrderMode: 'weighted_lottery',
      lotteryLastSeed: seed,
      lotteryLastRunAt: result.runAt,
      lotteryLastResult: result,
      lotteryConfig: {
        auditSeed: seed,
        randomSeed: seed,
      },
    })
  }

  return {
    draftId: context.draftId,
    leagueId: context.leagueId,
    seed: result.seed,
    runAt: result.runAt,
    slotOrder: result.slotOrder,
    lotteryDraws: result.lotteryDraws,
    fallbackOrder: result.fallbackOrder,
    oddsSnapshot: result.oddsSnapshot,
  }
}

export async function assignDraftOrder(draftId: string, order: string[]) {
  const context = await assertLiveDraftContext(draftId)
  const session = await prisma.draftSession.findUnique({
    where: { id: context.draftId },
    select: { slotOrder: true, status: true },
  })

  if (!session) {
    throw new Error('Draft session not found')
  }

  if (session.status !== 'pre_draft') {
    throw new Error('Draft order can only be changed before the draft starts')
  }

  const current = Array.isArray(session.slotOrder)
    ? (session.slotOrder as Array<{ slot: number; rosterId: string; displayName: string }>)
    : []
  const displayNameByRoster = new Map(current.map((entry) => [entry.rosterId, entry.displayName]))
  const normalized = order.map((rosterId, index) => ({
    slot: index + 1,
    rosterId,
    displayName: displayNameByRoster.get(rosterId) ?? `Team ${index + 1}`,
  }))

  await prisma.draftSession.update({
    where: { id: context.draftId },
    data: {
      slotOrder: normalized as any,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  })

  return normalized
}
