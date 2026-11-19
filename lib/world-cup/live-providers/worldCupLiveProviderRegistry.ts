import "server-only"
import { ApiSportsWorldCupLiveProvider } from "./apiSportsWorldCupLiveProvider"
import { ClearSportsWorldCupLiveProvider } from "./clearSportsWorldCupProvider"
import { ManualWorldCupLiveProvider } from "./manualWorldCupLiveProvider"
import { RealitySportsWorldCupLiveProvider } from "./realitySportsWorldCupProvider"
import { TheSportsDbWorldCupLiveProvider } from "./theSportsDbWorldCupProvider"
import type {
  NormalizedWorldCupLiveMatch,
  WorldCupLiveProviderId,
  WorldCupLiveScoreAdapter,
} from "./worldCupLiveProviderTypes"
import {
  WORLD_CUP_LIVE_PROVIDER_DEFAULT_CHAIN,
} from "./worldCupLiveProviderTypes"

function parseChainFromEnv(): WorldCupLiveProviderId[] | null {
  const raw = process.env.WORLD_CUP_LIVE_PROVIDER_CHAIN?.trim()
  if (!raw) return null
  const parts = raw.split(/[\s,]+/).filter(Boolean) as WorldCupLiveProviderId[]
  const allowed = new Set(WORLD_CUP_LIVE_PROVIDER_DEFAULT_CHAIN)
  const filtered = parts.filter((p) => allowed.has(p))
  return filtered.length > 0 ? filtered : null
}

export function getWorldCupLiveProviderChain(): WorldCupLiveProviderId[] {
  return parseChainFromEnv() ?? WORLD_CUP_LIVE_PROVIDER_DEFAULT_CHAIN
}

function createWorldCupLiveAdapters(): Record<
  WorldCupLiveProviderId,
  WorldCupLiveScoreAdapter
> {
  return {
    api_sports: new ApiSportsWorldCupLiveProvider(),
    thesportsdb: new TheSportsDbWorldCupLiveProvider(),
    reality_sports: new RealitySportsWorldCupLiveProvider(),
    clear_sports: new ClearSportsWorldCupLiveProvider(),
    manual: new ManualWorldCupLiveProvider(),
  }
}

export type FetchWorldCupLiveMatchesResult = {
  matches: NormalizedWorldCupLiveMatch[]
  winningProvider: WorldCupLiveProviderId | null
  providersAttempted: WorldCupLiveProviderId[]
  warnings: string[]
}

export type FetchWorldCupLiveMatchesOptions = {
  /** Override adapter wiring (tests); defaults to production registry instances. */
  adapterFactory?: () => Record<
    WorldCupLiveProviderId,
    WorldCupLiveScoreAdapter
  >
}

/**
 * Walks the configured chain until a provider returns at least one match (or manual fallback).
 * Throws from a provider are captured as warnings and the next provider runs.
 */
export async function fetchWorldCupLiveMatchesFromChain(
  seasonYear: number,
  chain?: WorldCupLiveProviderId[],
  options?: FetchWorldCupLiveMatchesOptions
): Promise<FetchWorldCupLiveMatchesResult> {
  const order = chain ?? getWorldCupLiveProviderChain()
  const adapterFactory = options?.adapterFactory ?? createWorldCupLiveAdapters
  const adapters = adapterFactory()
  const warnings: string[] = []
  const providersAttempted: WorldCupLiveProviderId[] = []

  for (const id of order) {
    const adapter = adapters[id]
    if (!adapter) {
      warnings.push(`Unknown live provider id in chain: ${id}`)
      continue
    }
    if (!adapter.isConfigured()) {
      continue
    }
    providersAttempted.push(id)
    try {
      const rows = await adapter.fetchLiveMatches(seasonYear)
      if (rows.length > 0) {
        return {
          matches: rows,
          winningProvider: id,
          providersAttempted,
          warnings,
        }
      }
    } catch (err) {
      warnings.push(
        `[${id}] ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return {
    matches: [],
    winningProvider: null,
    providersAttempted,
    warnings:
      warnings.length > 0
        ? warnings
        : ["No configured live provider returned fixtures for this season."],
  }
}
