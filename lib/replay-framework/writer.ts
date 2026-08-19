/**
 * Decision OS Replay Framework — generic, decision-type-agnostic writer.
 * Per docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md §6: this is the ONLY
 * writer for ReplayImport/ReplayBacktestResult. It never touches
 * TradeOfferEvent, TradeOutcomeEvent, or TradeLearningStats — there is no
 * code path from this module to `calibratedB0`.
 */
import { prisma } from '@/lib/prisma'
import type { BacktestResultInput, ReplayImportInput } from './types'

/**
 * Idempotent by (provider, decisionType, providerLeagueId, providerTransactionId)
 * — re-ingesting the same real transaction updates the row in place rather
 * than creating a duplicate.
 */
export async function upsertReplayImport(input: ReplayImportInput): Promise<string> {
  const row = await prisma.replayImport.upsert({
    where: {
      provider_decisionType_providerLeagueId_providerTransactionId: {
        provider: input.provider,
        decisionType: input.decisionType,
        providerLeagueId: input.providerLeagueId,
        providerTransactionId: input.providerTransactionId,
      },
    },
    create: {
      provider: input.provider,
      decisionType: input.decisionType,
      providerLeagueId: input.providerLeagueId,
      providerTransactionId: input.providerTransactionId,
      season: input.season,
      providerWeek: input.providerWeek,
      proposedAt: input.proposedAt,
      resolvedAt: input.resolvedAt,
      providerStatus: input.providerStatus,
      participantsInvolved: input.participantsInvolved as any,
      managerUserIds: input.managerUserIds as any,
      managerDisplayNames: input.managerDisplayNames as any,
      payload: input.payload as any,
      rawProviderPayload: input.rawProviderPayload as any,
      contextSnapshot: input.contextSnapshot as any,
      isDynasty: input.isDynasty,
      isSuperFlex: input.isSuperFlex,
      ingestSourceUserId: input.ingestSourceUserId,
    },
    update: {
      resolvedAt: input.resolvedAt,
      providerStatus: input.providerStatus,
      payload: input.payload as any,
      rawProviderPayload: input.rawProviderPayload as any,
    },
  })
  return row.id
}

/**
 * Idempotent by (replayId, modelVersion, engineVersionHash,
 * deterministicConfigVersion) — a new version combination always produces a
 * new row; re-running the SAME version combination updates in place rather
 * than accumulating duplicates.
 */
export async function upsertBacktestResult(input: BacktestResultInput): Promise<string> {
  const row = await prisma.replayBacktestResult.upsert({
    where: {
      replayId_modelVersion_engineVersionHash_deterministicConfigVersion: {
        replayId: input.replayId,
        modelVersion: input.modelVersion,
        engineVersionHash: input.engineVersionHash,
        deterministicConfigVersion: input.deterministicConfigVersion,
      },
    },
    create: {
      replayId: input.replayId,
      decisionType: input.decisionType,
      modelVersion: input.modelVersion,
      engineVersionHash: input.engineVersionHash,
      deterministicConfigVersion: input.deterministicConfigVersion,
      backtestedOutput: input.backtestedOutput as any,
      realOutcome: input.realOutcome as any,
    },
    update: {
      backtestedOutput: input.backtestedOutput as any,
      realOutcome: input.realOutcome as any,
    },
  })
  return row.id
}
