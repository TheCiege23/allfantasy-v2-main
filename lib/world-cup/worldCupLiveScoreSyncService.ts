import "server-only"
import {
  applyWorldCupLiveFixturesToChallenge,
  type WorldCupLiveScoreSyncResult,
} from "./worldCupDataSyncService"
import {
  fetchWorldCupLiveMatchesFromChain,
  type FetchWorldCupLiveMatchesOptions,
  type FetchWorldCupLiveMatchesResult,
} from "./live-providers/worldCupLiveProviderRegistry"
import type { WorldCupLiveProviderId } from "./live-providers/worldCupLiveProviderTypes"
import { normalizedLiveMatchToProviderFixture } from "./worldCupLiveScoreNormalizer"

type WorldCupLiveScoreChainSyncResult = WorldCupLiveScoreSyncResult & {
  winningProvider: WorldCupLiveProviderId | null
  providersAttempted: WorldCupLiveProviderId[]
  chainWarnings: string[]
}

export async function syncWorldCupLiveScoresWithProviderChain(options: {
  challengeId: string
  dryRun?: boolean
  recalculate?: boolean
  seasonYear?: number
  chain?: WorldCupLiveProviderId[]
  adapterFactory?: FetchWorldCupLiveMatchesOptions["adapterFactory"]
}): Promise<WorldCupLiveScoreChainSyncResult> {
  const {
    challengeId,
    dryRun = false,
    recalculate = true,
    seasonYear = 2026,
    chain,
    adapterFactory,
  } = options

  const fetched: FetchWorldCupLiveMatchesResult =
    await fetchWorldCupLiveMatchesFromChain(seasonYear, chain, { adapterFactory })

  const fixtures = fetched.matches.map(normalizedLiveMatchToProviderFixture)

  const applied = await applyWorldCupLiveFixturesToChallenge(
    challengeId,
    fixtures,
    { dryRun, recalculate }
  )

  return {
    ...applied,
    winningProvider: fetched.winningProvider,
    providersAttempted: fetched.providersAttempted,
    chainWarnings: fetched.warnings,
    warnings: [...fetched.warnings, ...applied.warnings],
  }
}
