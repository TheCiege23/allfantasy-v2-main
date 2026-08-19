/**
 * Phase 2A — ChimmyContextEngine orchestrator.
 *
 * Composes every registered provider, runs them in parallel (Promise.allSettled
 * so one slow/failed provider can never block Chimmy), applies a per-provider
 * TTL cache + per-provider timeout, and assembles `ChimmyContextBundle`.
 *
 * Usage (server only):
 *   const engine = new ChimmyContextEngine()
 *   const bundle = await engine.loadContext({ userId, leagueId })
 *
 * Notes:
 *  - `userId` MUST come from `getServerSession`, never the request body.
 *  - League access MUST be guarded by `assertLeagueMember` before calling.
 *  - This module does NOT mutate any external state.
 */

import { TtlCache } from "@/lib/chimmy-context/cache"
import { ImportHistoryContextProvider } from "@/lib/chimmy-context/providers/ImportHistoryContextProvider"
import { LeagueContextProvider } from "@/lib/chimmy-context/providers/LeagueContextProvider"
import { LeagueDifficultyContextProvider } from "@/lib/chimmy-context/providers/LeagueDifficultyContextProvider"
import { MatchupContextProvider } from "@/lib/chimmy-context/providers/MatchupContextProvider"
import { RankingContextProvider } from "@/lib/chimmy-context/providers/RankingContextProvider"
import { ReplayInsightContextProvider } from "@/lib/chimmy-context/providers/ReplayInsightContextProvider"
import { RosterContextProvider } from "@/lib/chimmy-context/providers/RosterContextProvider"
import { SportsScheduleContextProvider } from "@/lib/chimmy-context/providers/SportsScheduleContextProvider"
import { StandingsContextProvider } from "@/lib/chimmy-context/providers/StandingsContextProvider"
import { SubscriptionContextProvider } from "@/lib/chimmy-context/providers/SubscriptionContextProvider"
import { UserContextProvider } from "@/lib/chimmy-context/providers/UserContextProvider"
import type {
  ChimmyContextBundle,
  ChimmyContextProvider,
  ChimmyContextRequest,
  ImportedHistorySlice,
  LeagueContextSlice,
  LeagueDifficultyContextSlice,
  MatchupContextSlice,
  ProviderResult,
  RankingContextSlice,
  ReplayInsightSlice,
  RosterContextSlice,
  SportsScheduleSlice,
  StandingsContextSlice,
  SubscriptionContextSlice,
  UserContextSlice,
} from "@/lib/chimmy-context/types"

const DEFAULT_PROVIDER_TIMEOUT_MS = 1500

const DEBUG = process.env.AF_CHIMMY_CONTEXT_DEBUG === "1"

type AnyProvider = ChimmyContextProvider<unknown>

export type ChimmyContextEngineOptions = {
  /** Per-provider timeout. */
  providerTimeoutMs?: number
  /** Inject custom providers in tests; defaults to production set. */
  providers?: {
    user?: ChimmyContextProvider<UserContextSlice>
    subscription?: ChimmyContextProvider<SubscriptionContextSlice>
    league?: ChimmyContextProvider<LeagueContextSlice>
    matchup?: ChimmyContextProvider<MatchupContextSlice>
    roster?: ChimmyContextProvider<RosterContextSlice>
    standings?: ChimmyContextProvider<StandingsContextSlice>
    ranking?: ChimmyContextProvider<RankingContextSlice>
    leagueDifficulty?: ChimmyContextProvider<LeagueDifficultyContextSlice>
    importedHistory?: ChimmyContextProvider<ImportedHistorySlice>
    sportsSchedule?: ChimmyContextProvider<SportsScheduleSlice>
    replayInsights?: ChimmyContextProvider<ReplayInsightSlice>
  }
}

function cacheKey(providerName: string, request: ChimmyContextRequest): string {
  return `${providerName}|u=${request.userId}|l=${request.leagueId ?? ""}|w=${request.week ?? ""}|s=${request.season ?? ""}|sp=${request.sport ?? ""}`
}

async function withTimeout<T>(
  promise: Promise<ProviderResult<T>>,
  timeoutMs: number,
  providerName: string
): Promise<ProviderResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race<ProviderResult<T>>([
      promise,
      new Promise<ProviderResult<T>>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            ok: false,
            data: null,
            error: `Provider '${providerName}' timed out after ${timeoutMs}ms`,
            fetchedAt: new Date().toISOString(),
            durationMs: timeoutMs,
          })
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export class ChimmyContextEngine {
  private readonly cache = new TtlCache<ProviderResult<unknown>>()
  private readonly providerTimeoutMs: number
  private readonly providers: {
    user: ChimmyContextProvider<UserContextSlice>
    subscription: ChimmyContextProvider<SubscriptionContextSlice>
    league: ChimmyContextProvider<LeagueContextSlice>
    matchup: ChimmyContextProvider<MatchupContextSlice>
    roster: ChimmyContextProvider<RosterContextSlice>
    standings: ChimmyContextProvider<StandingsContextSlice>
    ranking: ChimmyContextProvider<RankingContextSlice>
    leagueDifficulty: ChimmyContextProvider<LeagueDifficultyContextSlice>
    importedHistory: ChimmyContextProvider<ImportedHistorySlice>
    sportsSchedule: ChimmyContextProvider<SportsScheduleSlice>
    replayInsights: ChimmyContextProvider<ReplayInsightSlice>
  }

  constructor(options: ChimmyContextEngineOptions = {}) {
    this.providerTimeoutMs = options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
    this.providers = {
      user: options.providers?.user ?? new UserContextProvider(),
      subscription: options.providers?.subscription ?? new SubscriptionContextProvider(),
      league: options.providers?.league ?? new LeagueContextProvider(),
      matchup: options.providers?.matchup ?? new MatchupContextProvider(),
      roster: options.providers?.roster ?? new RosterContextProvider(),
      standings: options.providers?.standings ?? new StandingsContextProvider(),
      ranking: options.providers?.ranking ?? new RankingContextProvider(),
      leagueDifficulty: options.providers?.leagueDifficulty ?? new LeagueDifficultyContextProvider(),
      importedHistory: options.providers?.importedHistory ?? new ImportHistoryContextProvider(),
      sportsSchedule: options.providers?.sportsSchedule ?? new SportsScheduleContextProvider(),
      replayInsights: options.providers?.replayInsights ?? new ReplayInsightContextProvider(),
    }
  }

  private async runOne<T>(
    provider: ChimmyContextProvider<T>,
    request: ChimmyContextRequest
  ): Promise<ProviderResult<T>> {
    const key = cacheKey(provider.name, request)
    if (!request.forceRefresh) {
      const cached = this.cache.get(key)
      if (cached) {
        return { ...(cached as ProviderResult<T>), cached: true, durationMs: 0 }
      }
    }
    let result: ProviderResult<T>
    try {
      result = await withTimeout(
        provider.load(request),
        this.providerTimeoutMs,
        provider.name
      )
    } catch (err) {
      // Providers should never throw, but belt-and-suspenders:
      result = {
        ok: false,
        data: null,
        error: err instanceof Error ? err.message : "Unknown provider error",
        fetchedAt: new Date().toISOString(),
        durationMs: 0,
      }
    }
    if (result.ok) {
      this.cache.set(key, result as ProviderResult<unknown>, provider.defaultTtlMs)
    }
    return result
  }

  /** Manually invalidate a provider's cached entry for a request key. */
  invalidate(providerName: string, request: ChimmyContextRequest): void {
    this.cache.delete(cacheKey(providerName, request))
  }

  async loadContext(
    rawRequest: ChimmyContextRequest,
    options: { onlyProviders?: ReadonlyArray<keyof ChimmyContextEngine["providers"]> } = {}
  ): Promise<ChimmyContextBundle> {
    const startedAt = Date.now()
    const request: ChimmyContextRequest = {
      ...rawRequest,
      perRequestMemo: rawRequest.perRequestMemo ?? new Map<string, unknown>(),
    }

    const allEntries: Array<[
      keyof ChimmyContextEngine["providers"],
      AnyProvider,
    ]> = [
      ["user", this.providers.user as AnyProvider],
      ["subscription", this.providers.subscription as AnyProvider],
      ["league", this.providers.league as AnyProvider],
      ["matchup", this.providers.matchup as AnyProvider],
      ["roster", this.providers.roster as AnyProvider],
      ["standings", this.providers.standings as AnyProvider],
      ["ranking", this.providers.ranking as AnyProvider],
      ["leagueDifficulty", this.providers.leagueDifficulty as AnyProvider],
      ["importedHistory", this.providers.importedHistory as AnyProvider],
      ["sportsSchedule", this.providers.sportsSchedule as AnyProvider],
      ["replayInsights", this.providers.replayInsights as AnyProvider],
    ]

    const filter = options.onlyProviders ? new Set(options.onlyProviders) : null
    const entries = filter
      ? allEntries.filter(([key]) => filter.has(key))
      : allEntries

    const settled = await Promise.allSettled(
      entries.map(([, p]) => this.runOne(p, request))
    )

    const byName = new Map<string, ProviderResult<unknown>>()
    for (let i = 0; i < entries.length; i++) {
      const [key, provider] = entries[i]
      const outcome = settled[i]
      if (outcome.status === "fulfilled") {
        byName.set(String(key), outcome.value)
      } else {
        byName.set(String(key), {
          ok: false,
          data: null,
          error: String(outcome.reason ?? "Provider rejected"),
          fetchedAt: new Date().toISOString(),
          durationMs: 0,
        })
      }
      // Force unused-variable elimination satisfaction (provider name available
      // via the map key already).
      void provider
    }

    const get = <T>(name: string): ProviderResult<T> | null =>
      (byName.get(name) as ProviderResult<T> | undefined) ?? null

    const userResult = get<UserContextSlice>("user")
    const subResult = get<SubscriptionContextSlice>("subscription")
    const leagueResult = get<LeagueContextSlice>("league")
    const matchupResult = get<MatchupContextSlice>("matchup")
    const rosterResult = get<RosterContextSlice>("roster")
    const standingsResult = get<StandingsContextSlice>("standings")
    const rankingResult = get<RankingContextSlice>("ranking")
    const difficultyResult = get<LeagueDifficultyContextSlice>("leagueDifficulty")
    const historyResult = get<ImportedHistorySlice>("importedHistory")
    const scheduleResult = get<SportsScheduleSlice>("sportsSchedule")
    const replayResult = get<ReplayInsightSlice>("replayInsights")

    const bundle: ChimmyContextBundle = {
      user: userResult?.data ?? null,
      aiAccess: subResult?.data ?? null,
      activeLeague: leagueResult?.data?.activeLeague ?? null,
      leagues: leagueResult?.data?.allLeagues ?? [],
      matchup: matchupResult?.data ?? null,
      roster: rosterResult?.data ?? null,
      standings: standingsResult?.data ?? null,
      rankings: rankingResult?.data ?? null,
      leagueDifficulty: difficultyResult?.data ?? null,
      importedHistory: historyResult?.data ?? null,
      sportsSchedule: scheduleResult?.data ?? null,
      replayInsights: replayResult?.data ?? null,
      memoryRefs: [],
      meta: {
        builtAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        providers: entries.map(([key]) => {
          const r = byName.get(String(key))!
          return {
            name: String(key),
            ok: r.ok,
            cached: r.cached === true,
            durationMs: r.durationMs ?? 0,
            error: r.error,
          }
        }),
      },
    }

    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.log("[ChimmyContextEngine]", JSON.stringify(bundle.meta, null, 2))
    }

    return bundle
  }
}

/** Process-wide singleton — providers + cache survive across requests. */
export const chimmyContextEngine = new ChimmyContextEngine()
