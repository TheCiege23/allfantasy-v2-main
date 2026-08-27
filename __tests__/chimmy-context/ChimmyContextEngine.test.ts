/**
 * Phase 2A — ChimmyContextEngine unit tests (no Prisma, all providers mocked).
 */

import { describe, expect, it, vi } from "vitest"
import { ChimmyContextEngine } from "@/lib/chimmy-context/ChimmyContextEngine"
import type {
  ChimmyContextProvider,
  ChimmyContextRequest,
  ImportedHistorySlice,
  LeagueContextSlice,
  LeagueDifficultyContextSlice,
  MatchupContextSlice,
  ProviderResult,
  RankingContextSlice,
  RosterContextSlice,
  SportsScheduleSlice,
  ReplayInsightSlice,
  DevyContextSlice,
  StandingsContextSlice,
  SubscriptionContextSlice,
  UserContextSlice,
} from "@/lib/chimmy-context/types"

function fakeProvider<T>(
  name: string,
  data: T | null,
  opts: { ok?: boolean; ttlMs?: number; delayMs?: number; error?: string } = {}
): ChimmyContextProvider<T> {
  return {
    name,
    defaultTtlMs: opts.ttlMs ?? 60_000,
    async load(_request: ChimmyContextRequest): Promise<ProviderResult<T>> {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      return {
        ok: opts.ok ?? true,
        data,
        error: opts.error,
        fetchedAt: new Date().toISOString(),
        durationMs: opts.delayMs ?? 0,
      }
    },
  }
}

function buildEngine(overrides: Partial<{
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
  devy: ChimmyContextProvider<DevyContextSlice>
}> = {}) {
  return new ChimmyContextEngine({
    providerTimeoutMs: 200,
    providers: {
      user:
        overrides.user ??
        fakeProvider<UserContextSlice>("user", {
          userId: "u_1",
          displayName: "Guap",
          username: "guap",
          timezone: "America/New_York",
          preferredLanguage: "en",
          createdAt: "2024-01-01T00:00:00.000Z",
        }),
      subscription:
        overrides.subscription ??
        fakeProvider<SubscriptionContextSlice>("subscription", {
          hasAccess: true,
          reason: "in_trial",
          hasSubscription: false,
          planLabel: null,
          inTrial: true,
          trialDaysRemaining: 7,
          trialEndsAt: "2099-01-01T00:00:00.000Z",
          tokenBalance: 42,
          message: "Trial",
        }),
      league:
        overrides.league ??
        fakeProvider<LeagueContextSlice>("league", {
          activeLeague: null,
          allLeagues: [],
          sleeperUsername: null,
        }),
      matchup: overrides.matchup ?? fakeProvider<MatchupContextSlice>("matchup", null),
      roster: overrides.roster ?? fakeProvider<RosterContextSlice>("roster", null),
      standings:
        overrides.standings ?? fakeProvider<StandingsContextSlice>("standings", null),
      ranking:
        overrides.ranking ?? fakeProvider<RankingContextSlice>("ranking", { snapshot: null }),
      leagueDifficulty:
        overrides.leagueDifficulty ??
        fakeProvider<LeagueDifficultyContextSlice>("leagueDifficulty", { rating: null }),
      importedHistory:
        overrides.importedHistory ??
        fakeProvider<ImportedHistorySlice>("importedHistory", {
          source: null,
          totalLeagues: 0,
          totalSeasons: 0,
          careerRecord: null,
          winPercentage: null,
          championships: 0,
          archetype: null,
          recentLeagues: [],
        }),
      sportsSchedule:
        overrides.sportsSchedule ??
        fakeProvider<SportsScheduleSlice>("sportsSchedule", {
          date: "2026-05-22",
          games: [],
          hasRealData: false,
        }),
      /*
       * ⚠ THESE TWO WERE NOT FAKED, SO A "HAPPY-PATH" UNIT TEST WAS RUNNING THE
       * REAL PROVIDERS — and therefore hitting the database. `devy` is what
       * exposed it: it reports a NAMED failure when its query throws (correct,
       * and deliberate in DevyContextProvider), so the moment it was added the
       * every-provider-ok assertion went false. `replayInsights` had been
       * leaking through the same hole and only looked fine because it degrades
       * to ok with a null slice.
       *
       * Every provider the engine constructs must be stubbed here, or this test
       * is measuring the environment rather than the engine.
       */
      replayInsights:
        overrides.replayInsights ??
        fakeProvider<ReplayInsightSlice>("replayInsights", {
          status: "empty",
          insightSet: null,
        }),
      devy:
        overrides.devy ??
        fakeProvider<DevyContextSlice>("devy", {
          topProspects: [],
          ranked: 0,
          unranked: 0,
          coverage: 0,
          gaps: [],
        }),
    },
  })
}

describe("ChimmyContextEngine", () => {
  it("assembles a full bundle from happy-path providers", async () => {
    const engine = buildEngine()
    const bundle = await engine.loadContext({ userId: "u_1" })

    expect(bundle.user?.displayName).toBe("Guap")
    expect(bundle.aiAccess?.tokenBalance).toBe(42)
    expect(bundle.rankings?.snapshot).toBeNull()
    expect(bundle.leagues).toEqual([])
    expect(bundle.activeLeague).toBeNull()
    expect(bundle.memoryRefs).toEqual([])
    /*
     * ⚠ WAS `toHaveLength(11)`, AND A NEW PROVIDER MADE IT 12. Adding `devy`
     * turned this red with "expected 12 to be 11" — a number that says a count
     * moved and not WHICH provider arrived, so the failure took a dig through the
     * engine to interpret.
     *
     * Named instead. Adding a provider still fails here, deliberately — every
     * slice reaching Chimmy should be a decision someone wrote down — but now the
     * diff names the newcomer, and the list doubles as the record of what is in a
     * bundle.
     */
    expect(bundle.meta.providers.map((p) => p.name).sort()).toEqual([
      'devy',
      'importedHistory',
      'league',
      'leagueDifficulty',
      'matchup',
      'ranking',
      'replayInsights',
      'roster',
      'sportsSchedule',
      'standings',
      'subscription',
      'user',
    ])
    expect(bundle.meta.providers.every((p) => p.ok)).toBe(true)
  })

  it("does not throw when one provider fails — bundle still resolves", async () => {
    const engine = buildEngine({
      user: fakeProvider<UserContextSlice>("user", null, {
        ok: false,
        error: "boom",
      }),
    })
    const bundle = await engine.loadContext({ userId: "u_1" })

    expect(bundle.user).toBeNull()
    const userMeta = bundle.meta.providers.find((p) => p.name === "user")
    expect(userMeta?.ok).toBe(false)
    expect(userMeta?.error).toBe("boom")
    // Other providers still succeed
    expect(bundle.aiAccess?.tokenBalance).toBe(42)
  })

  it("caches successful provider results across calls", async () => {
    const load = vi.fn().mockResolvedValue({
      ok: true,
      data: { snapshot: null },
      fetchedAt: new Date().toISOString(),
      durationMs: 1,
    })
    const ranking: ChimmyContextProvider<RankingContextSlice> = {
      name: "ranking",
      defaultTtlMs: 60_000,
      load,
    }
    const engine = buildEngine({ ranking })

    const a = await engine.loadContext({ userId: "u_1" })
    const b = await engine.loadContext({ userId: "u_1" })

    expect(load).toHaveBeenCalledTimes(1)
    const aMeta = a.meta.providers.find((p) => p.name === "ranking")
    const bMeta = b.meta.providers.find((p) => p.name === "ranking")
    expect(aMeta?.cached).toBe(false)
    expect(bMeta?.cached).toBe(true)
  })

  it("bypasses cache when forceRefresh=true", async () => {
    const load = vi.fn().mockResolvedValue({
      ok: true,
      data: { snapshot: null },
      fetchedAt: new Date().toISOString(),
      durationMs: 1,
    })
    const ranking: ChimmyContextProvider<RankingContextSlice> = {
      name: "ranking",
      defaultTtlMs: 60_000,
      load,
    }
    const engine = buildEngine({ ranking })

    await engine.loadContext({ userId: "u_1" })
    await engine.loadContext({ userId: "u_1", forceRefresh: true })

    expect(load).toHaveBeenCalledTimes(2)
  })

  it("times out slow providers without rejecting the bundle", async () => {
    const engine = buildEngine({
      ranking: fakeProvider<RankingContextSlice>("ranking", { snapshot: null }, {
        delayMs: 500,
      }),
    })
    const bundle = await engine.loadContext({ userId: "u_1" })
    const rMeta = bundle.meta.providers.find((p) => p.name === "ranking")
    expect(rMeta?.ok).toBe(false)
    expect(rMeta?.error).toMatch(/timed out/i)
    expect(bundle.rankings).toBeNull()
  })
})
