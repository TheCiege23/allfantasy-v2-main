/**
 * World Cup Sport Plugin — First full implementation of the AllFantasy AI Engine.
 *
 * All deterministic calculations run in computeInsights via:
 *   - lib/ai/insights/* calculators (leaderboard movement, swing, rooting guide, etc.)
 *   - lib/world-cup/worldCupInsightCards (existing card builders, preserved for compat)
 *
 * buildGroundingPacket returns a typed AIGroundingContract (v1), which enables:
 *   - Full response validation in the engine (score invention, overclaims, etc.)
 *   - Source freshness labeling on every answer
 *   - Explicit missing data acknowledgment
 *   - Forbidden claims enforcement
 */
import "server-only"
import { prisma } from "@/lib/prisma"
import { buildWorldCupLeaderboardRows } from "@/lib/world-cup/worldCupScoringService"
import {
  buildPoolSwingAlertCard,
  buildChampionPickRiskCard,
  buildRootingGuideCard,
  buildCommissionerRecapCard,
} from "@/lib/world-cup/worldCupInsightCards"
import { buildWorldCupChimmySystemPrompt } from "@/lib/world-cup/worldCupChimmyReplyPolicy"
import {
  buildFreshnessLabel,
  buildMissingDataList,
  buildAllowedClaims,
  buildForbiddenClaims,
  type AIGroundingContract,
  type ContractLeaderboardRow,
  type ContractFixture,
} from "../../aiGroundingContract"
import {
  computeLeaderboardMovement,
  computeMaxPossiblePoints,
  computeChampionPickLeverage,
  computeMatchupSwingScores,
  computeRootingGuide,
  computeIncompletePicks,
  computeCommissionerRecap,
  computePoolParity,
  computeUpsetImpact,
  type InsightEntry,
  type InsightMatch,
  type InsightPool,
} from "../../insights"
import type { SportPlugin, AIEngineInput } from "../types"

// ─── Scoring helper ───────────────────────────────────────────────────────────

type ScoringProfile = {
  roundOf32Points?: number | null
  roundOf16Points?: number | null
  quarterFinalPoints?: number | null
  semiFinalPoints?: number | null
  finalPoints?: number | null
  championBonus?: number | null
} | null

function getPointsForRound(round: string, scoring: ScoringProfile): number {
  const defaults: Record<string, number> = {
    round_of_32: 2,
    round_of_16: 4,
    quarter_final: 8,
    semi_final: 12,
    final: 16,
    third_place: 8,
  }
  if (!scoring) return defaults[round] ?? 2
  const map: Record<string, keyof NonNullable<ScoringProfile>> = {
    round_of_32: "roundOf32Points",
    round_of_16: "roundOf16Points",
    quarter_final: "quarterFinalPoints",
    semi_final: "semiFinalPoints",
    final: "finalPoints",
  }
  const key = map[round]
  const val = key ? scoring[key] : null
  return val != null ? Number(val) : (defaults[round] ?? 2)
}

// ─── Context type ─────────────────────────────────────────────────────────────

type WcContext = {
  challengeId: string
  challengeName: string
  totalEntries: number
  isLocked: boolean
  scoringProfile: ScoringProfile
  leaderboardRows: ReturnType<typeof buildWorldCupLeaderboardRows>
  mostPopularChampion: { teamName: string; count: number } | null
  /** Pre-built pool for deterministic insight calculators. */
  insightPool: InsightPool
}

// ─── Provider data ────────────────────────────────────────────────────────────

type WcProviderData = {
  liveFixtures: Array<{
    id: number
    homeTeam: string
    awayTeam: string
    homeScore: number | null
    awayScore: number | null
    status: string
    elapsed: number | null
  }>
  lastSyncedAt: string
}

// ─── Insights type ────────────────────────────────────────────────────────────

type WcInsights = {
  // Summary
  leaderboardSummary: {
    leader: { entryName: string; displayName: string; score: number } | null
    totalEntries: number
    averageScore: number
    scoreSpread: number
  }
  topThreeEntries: Array<{ rank: number; entryName: string; displayName: string; score: number }>

  // Existing card builders (preserved for commissioner panel compat)
  poolSwingCard: Awaited<ReturnType<typeof buildPoolSwingAlertCard>>
  championRiskCard: Awaited<ReturnType<typeof buildChampionPickRiskCard>>
  rootingGuideCard: Awaited<ReturnType<typeof buildRootingGuideCard>>
  commissionerRecapCard: Awaited<ReturnType<typeof buildCommissionerRecapCard>>

  // New deterministic calculators
  leaderboardMovement: ReturnType<typeof computeLeaderboardMovement>
  maxPossible: ReturnType<typeof computeMaxPossiblePoints>
  championLeverage: ReturnType<typeof computeChampionPickLeverage>
  swingScores: ReturnType<typeof computeMatchupSwingScores>
  rootingGuide: ReturnType<typeof computeRootingGuide>
  incompletePicks: ReturnType<typeof computeIncompletePicks>
  commissionerRecap: ReturnType<typeof computeCommissionerRecap>
  poolParity: ReturnType<typeof computePoolParity>
  upsetImpact: ReturnType<typeof computeUpsetImpact>
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const worldCupPlugin: SportPlugin<WcContext, WcProviderData, WcInsights> = {
  sport: "world_cup",
  version: "1.1.0",
  features: [
    "pool_chat",
    "private_ai",
    "commissioner_insights",
    "bracket_recommendation",
    "rooting_guide",
    "pool_swing",
    "champion_risk",
    "recap",
    "at_risk",
    "trash_talk",
    "social_invite",
    "tomorrow_hype",
    "hype",
  ],

  // ── Step 1: Fetch DB context + build InsightPool ──────────────────────────────
  async fetchContext(input: AIEngineInput): Promise<WcContext> {
    const challenge = await prisma.worldCupBracketChallenge.findUnique({
      where: { id: input.contextId },
      include: {
        matches: true,
        scoringProfile: true,
        entries: {
          where: { isComplete: true, submittedAt: { not: null } },
          include: {
            picks: {
              select: {
                id: true,
                matchId: true,
                round: true,
                selectedTeamName: true,
                pointsAwarded: true,
                isCorrect: true,
              },
            },
            participant: { select: { displayName: true } },
          },
        },
      },
    })

    if (!challenge) {
      return {
        challengeId: input.contextId,
        challengeName: "Unknown Pool",
        totalEntries: 0,
        isLocked: false,
        scoringProfile: null,
        leaderboardRows: [],
        mostPopularChampion: null,
        insightPool: { entries: [], matches: [], totalEntries: 0 },
      }
    }

    const scoring = challenge.scoringProfile as ScoringProfile

    // ── Build InsightMatch[] ────────────────────────────────────────────────────
    // Count pick distribution per match
    const matchPickCounts = new Map<string, { home: number; away: number }>()
    for (const entry of challenge.entries as Array<{
      picks: Array<{ matchId: string; selectedTeamName: string | null }>
    }>) {
      for (const pick of entry.picks) {
        const match = (challenge.matches as Array<{
          id: string; homeTeam: string | null; awayTeam: string | null
        }>).find((m) => m.id === pick.matchId)
        if (!match) continue
        const cur = matchPickCounts.get(pick.matchId) ?? { home: 0, away: 0 }
        if (pick.selectedTeamName === match.homeTeam) cur.home++
        else if (pick.selectedTeamName === match.awayTeam) cur.away++
        matchPickCounts.set(pick.matchId, cur)
      }
    }

    const insightMatches: InsightMatch[] = (challenge.matches as Array<{
      id: string
      homeTeam: string | null
      awayTeam: string | null
      round: string | null
      status: string | null
      homeScore: number | null
      awayScore: number | null
      startsAt: Date | null
    }>).map((m) => ({
      matchId: m.id,
      homeTeam: m.homeTeam ?? "",
      awayTeam: m.awayTeam ?? "",
      round: m.round ?? "unknown",
      status:
        m.status === "final" ? "final" : m.status === "live" ? "live" : "scheduled",
      kickoffUtc: m.startsAt?.toISOString() ?? null,
      pointsAtStake: getPointsForRound(m.round ?? "", scoring),
      pickDistribution: matchPickCounts.get(m.id) ?? { home: 0, away: 0 },
      homeScore: m.homeScore ?? null,
      awayScore: m.awayScore ?? null,
    }))

    // ── Build InsightEntry[] ─────────────────────────────────────────────────────
    const rawEntries = challenge.entries as Array<{
      id: string
      participant: { displayName: string }
      picks: Array<{
        matchId: string
        round: string
        selectedTeamName: string | null
        pointsAwarded: number | null
        isCorrect: boolean | null
      }>
    }>

    const insightEntriesUnranked = rawEntries.map((entry) => {
      const currentScore = entry.picks.reduce(
        (sum, p) => sum + (p.pointsAwarded ?? 0),
        0,
      )
      const pendingPoints = entry.picks.reduce((sum, p) => {
        const m = insightMatches.find((im) => im.matchId === p.matchId)
        if (!m || m.status === "final") return sum
        return sum + getPointsForRound(p.round, scoring)
      }, 0)

      return {
        entryId: entry.id,
        displayName: entry.participant.displayName,
        currentScore,
        maxPossible: currentScore + pendingPoints,
        rank: 0, // assigned below
        isCurrentUser: false, // set per-request in computeInsights
        picks: entry.picks.map((p) => ({
          matchId: p.matchId,
          pickedTeam: p.selectedTeamName ?? "",
          round: p.round,
          pointsAtStake: getPointsForRound(p.round, scoring),
          pointsEarned: p.pointsAwarded ?? null,
          isCorrect: p.isCorrect ?? null,
        })),
      }
    })

    // Rank by currentScore desc
    const sortedForRank = [...insightEntriesUnranked].sort(
      (a, b) => b.currentScore - a.currentScore,
    )
    sortedForRank.forEach((e, i) => {
      e.rank = i + 1
    })

    const insightEntries: InsightEntry[] = sortedForRank

    // ── Champion pick tally ───────────────────────────────────────────────────────
    const champCounts = new Map<string, number>()
    for (const entry of challenge.entries as Array<{
      championTeamName?: string | null
      picks?: Array<{ round: string; selectedTeamName?: string | null }>
    }>) {
      const champ =
        entry.championTeamName?.trim() ||
        entry.picks?.find((p) => p.round === "final")?.selectedTeamName?.trim()
      if (champ) champCounts.set(champ, (champCounts.get(champ) ?? 0) + 1)
    }
    const topChamp =
      [...champCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null

    // ── Leaderboard rows (for display / existing compat) ─────────────────────────
    const rows = buildWorldCupLeaderboardRows({
      entries: challenge.entries as Parameters<typeof buildWorldCupLeaderboardRows>[0]["entries"],
      matches: challenge.matches as Parameters<typeof buildWorldCupLeaderboardRows>[0]["matches"],
      scoring: challenge.scoringProfile,
    })

    return {
      challengeId: challenge.id,
      challengeName: challenge.name,
      totalEntries: challenge.entries.length,
      isLocked: Boolean(
        challenge.pickLockAt && new Date(challenge.pickLockAt) < new Date(),
      ),
      scoringProfile: scoring,
      leaderboardRows: rows,
      mostPopularChampion: topChamp
        ? { teamName: topChamp[0], count: topChamp[1] }
        : null,
      insightPool: {
        entries: insightEntries,
        matches: insightMatches,
        totalEntries: insightEntries.length,
      },
    }
  },

  // ── Step 2: Fetch provider data ───────────────────────────────────────────────
  async fetchProviderData(_context, _input) {
    // TODO: wire to worldCupLiveDataService when live feed is ready
    // const live = await getWorldCupLiveDataForChallenge(input.contextId)
    // if (live) return { data: live, freshness: "live", fetchedAt: new Date() }
    return null
  },

  // ── Step 3: Compute ALL deterministic insights ────────────────────────────────
  async computeInsights(context, _providerData, input): Promise<WcInsights> {
    const rows = context.leaderboardRows
    const sorted = [...rows].sort(
      (a, b) => a.rank - b.rank || b.totalScore - a.totalScore,
    )
    const scores = sorted.map((r) => r.totalScore)
    const avgScore =
      scores.length > 0
        ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
        : 0
    const spread = (scores[0] ?? 0) - (scores[scores.length - 1] ?? 0)

    // Mark the requesting user's entry
    const pool: InsightPool = {
      ...context.insightPool,
      entries: context.insightPool.entries.map((e) => ({
        ...e,
        isCurrentUser: !!input.entryId && e.entryId === input.entryId,
      })),
    }

    // Champion points value from scoring profile
    const championPointValue = getPointsForRound("final", context.scoringProfile)

    // ── Existing card builders (deterministic, no AI) ─────────────────────────────
    const [poolSwingCard, championRiskCard, rootingGuideCard, commissionerRecapCard] =
      await Promise.all([
        buildPoolSwingAlertCard(input.contextId),
        buildChampionPickRiskCard(input.contextId, input.entryId),
        buildRootingGuideCard(input.contextId, input.entryId),
        buildCommissionerRecapCard(input.contextId),
      ])

    // ── New deterministic calculators ─────────────────────────────────────────────
    const leaderboardMovement = computeLeaderboardMovement(pool)
    const maxPossible = computeMaxPossiblePoints(pool)
    const championLeverage = computeChampionPickLeverage(
      pool.entries,
      "final",
      championPointValue,
      input.entryId,
    )
    const swingScores = computeMatchupSwingScores(pool)
    const rootingGuide = input.entryId
      ? computeRootingGuide(pool, input.entryId)
      : null
    const incompletePicks = computeIncompletePicks(
      pool,
      pool.matches.length, // expected picks = one per match
    )
    const commissionerRecap = computeCommissionerRecap(pool)
    const poolParity = computePoolParity(pool)
    const upsetImpact = computeUpsetImpact(pool)

    return {
      leaderboardSummary: {
        leader: sorted[0]
          ? {
              entryName: sorted[0].entryName,
              displayName: sorted[0].displayName,
              score: sorted[0].totalScore,
            }
          : null,
        totalEntries: sorted.length,
        averageScore: avgScore,
        scoreSpread: Math.max(0, spread),
      },
      topThreeEntries: sorted.slice(0, 3).map((r) => ({
        rank: r.rank,
        entryName: r.entryName,
        displayName: r.displayName,
        score: r.totalScore,
      })),
      poolSwingCard,
      championRiskCard,
      rootingGuideCard,
      commissionerRecapCard,
      leaderboardMovement,
      maxPossible,
      championLeverage,
      swingScores,
      rootingGuide,
      incompletePicks,
      commissionerRecap,
      poolParity,
      upsetImpact,
    }
  },

  // ── Step 4: Build AIGroundingContract (v1) ────────────────────────────────────
  buildGroundingPacket(context, providerData, insights, input): Record<string, unknown> {
    const freshnessTier = providerData ? "live" : "pool_only"
    const fetchedAt = providerData ? new Date() : null
    const sourceFreshness = buildFreshnessLabel(freshnessTier, fetchedAt)

    // Build typed leaderboard rows for the contract
    const leaderboard: ContractLeaderboardRow[] = context.insightPool.entries
      .slice(0, 25)
      .map((e, i, arr) => ({
        rank: e.rank,
        displayName: e.displayName,
        score: e.currentScore,
        maxPossible: e.maxPossible,
        isCurrentUser: e.isCurrentUser,
        isTied: arr.some((other) => other.entryId !== e.entryId && other.rank === e.rank),
      }))

    // Fixtures from the insight pool
    const providerFixtures: ContractFixture[] = context.insightPool.matches.map((m) => ({
      matchId: m.matchId,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      kickoffUtc: m.kickoffUtc,
      round: m.round,
      venue: null,
      status: m.status,
    }))

    const partialOpts = {
      liveScores: providerData
        ? (providerData.liveFixtures
            .filter((f) => f.status === "live" || f.status === "FT")
            .map((f) => ({
              matchId: String(f.id),
              homeTeam: f.homeTeam,
              awayTeam: f.awayTeam,
              homeScore: f.homeScore ?? 0,
              awayScore: f.awayScore ?? 0,
              minute: f.elapsed,
              extraTime: false,
              status: "live" as const,
            })) as AIGroundingContract["liveScores"])
        : null,
      oddsData: null,
      providerFixtures,
      scoringContext: context.scoringProfile
        ? {
            description: "Points awarded per correct bracket pick",
            pointsByRound: {
              round_of_32: getPointsForRound("round_of_32", context.scoringProfile),
              round_of_16: getPointsForRound("round_of_16", context.scoringProfile),
              quarter_final: getPointsForRound("quarter_final", context.scoringProfile),
              semi_final: getPointsForRound("semi_final", context.scoringProfile),
              final: getPointsForRound("final", context.scoringProfile),
            },
            bonusRules: [],
            championMultiplier: context.scoringProfile?.championBonus ?? null,
          }
        : null,
      userPicks: null, // per-entry picks kept in computedInsights, not surfaced here
      leaderboard,
      computedInsights: {}, // filled below
    }

    const contract: AIGroundingContract = {
      contractVersion: "af-contract-v1",
      sport: "world_cup",
      feature: input.feature,
      userRole: input.userRole,
      plan: input.entitlements.plan,
      locale: input.locale ?? null,
      sourceFreshness,
      poolContext: {
        poolId: context.challengeId,
        poolName: context.challengeName,
        totalEntries: context.totalEntries,
        sport: "soccer",
        format: "bracket",
        currentPhase: (() => {
          const rounds = context.insightPool.matches
            .filter((m) => m.status !== "final")
            .map((m) => m.round)
          return rounds[0] ?? "complete"
        })(),
        prizePool: null,
      },
      scoringContext: partialOpts.scoringContext,
      userPicks: partialOpts.userPicks,
      leaderboard,
      providerFixtures,
      liveScores: partialOpts.liveScores,
      oddsData: null,
      computedInsights: {
        leaderboardSummary: insights.leaderboardSummary,
        topThree: insights.topThreeEntries,
        // Swing analysis — which match is most dangerous for the leaderboard
        topSwingMatch: insights.swingScores.topSwingMatch,
        highestChaosMatch: insights.swingScores.highestChaosMatch,
        allSwingMatches: insights.swingScores.matches.slice(0, 5),
        // Max possible / elimination
        eliminatedCount: insights.maxPossible.eliminatedCount,
        stillAliveCount: insights.maxPossible.stillAliveCount,
        leaderMargin: insights.maxPossible.leaderMargin,
        // Pool parity
        parity: {
          score: insights.poolParity.parityScore,
          label: insights.poolParity.parityLabel,
          entriesInStrikeRange: insights.poolParity.entriesWithinStrikeRange,
          leaderMargin: insights.poolParity.leaderMargin,
        },
        // Champion pick leverage
        championPicks: insights.championLeverage.picks.slice(0, 6),
        chalkLossImpact: insights.championLeverage.chalkLossImpact,
        // Rooting guide for requesting user
        rootingGuide: insights.rootingGuide
          ? {
              currentRank: insights.rootingGuide.currentRank,
              topNeed: insights.rootingGuide.topNeed,
              canReachFirst: insights.rootingGuide.canReachFirst,
            }
          : null,
        // Upset potential
        topUpsetImpact: insights.upsetImpact.mostImpactful,
        // Commissioner recap
        recap: {
          biggestWinner: insights.commissionerRecap.biggestWinnerToday,
          biggestLoser: insights.commissionerRecap.biggestLoserToday,
          bestUpcomingMatch: insights.commissionerRecap.bestUpcomingMatch,
          poolHealth: insights.commissionerRecap.poolHealthSummary,
        },
        // Incomplete picks (commissioner alert)
        incompletePicks: {
          completionRate: insights.incompletePicks.completionRate,
          hasCompletionProblem: insights.incompletePicks.hasCompletionProblem,
          incompleteCount: insights.incompletePicks.incompleteEntries.length,
        },
        // Leaderboard movement projections for top 5 upcoming matches
        leaderboardMovement: insights.leaderboardMovement.slice(0, 5).map((shift) => ({
          match: shift.matchDescription,
          round: shift.round,
          maxRankSwing: shift.maxRankSwing,
          highestImpactWinner: shift.highestImpactWinner,
        })),
        // Legacy card data (kept for commissioner panel compat)
        legacyCards: {
          poolSwing: insights.poolSwingCard
            ? {
                match: `${insights.poolSwingCard.homeTeam} vs ${insights.poolSwingCard.awayTeam}`,
                chaosRating: insights.poolSwingCard.chaosRating,
                maxPointsAtRisk: insights.poolSwingCard.maxPointsAtRisk,
              }
            : null,
          championRisk: insights.championRiskCard
            ? {
                topChampion: insights.championRiskCard.topChampion,
                poolPickPercent: insights.championRiskCard.poolPickPercent,
              }
            : null,
        },
      },
      missingData: buildMissingDataList(partialOpts),
      allowedClaims: buildAllowedClaims(partialOpts),
      forbiddenClaims: buildForbiddenClaims({
        liveScores: partialOpts.liveScores,
        oddsData: null,
        plan: input.entitlements.plan,
      }),
    }

    return contract as unknown as Record<string, unknown>
  },

  // ── Step 5: System prompt (Priority 4 — upgraded) ─────────────────────────────
  buildSystemPrompt(input: AIEngineInput): string {
    return buildWorldCupChimmySystemPrompt(input.locale)
  },

  // ── Step 6: Validate response ──────────────────────────────────────────────────
  // Engine handles full contract validation when contractVersion === "af-contract-v1".
  // This plugin-level validator is a final safety net for WC-specific patterns.
  validateResponse(response: string): string {
    // Block any invented score pattern the engine validator may have missed
    return response.replace(/\b\d{1,2}[-–]\d{1,2}\b/g, "[score not available]")
  },
}
