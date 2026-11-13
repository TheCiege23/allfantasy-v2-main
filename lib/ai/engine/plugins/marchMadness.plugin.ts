/**
 * March Madness Bracket Plugin — AllFantasy AI Engine
 *
 * Deterministic layer mirrors the World Cup bracket engine:
 * - Champion pick concentration (same % / differentiation logic as WC)
 * - Round swing analysis (which game has most pick-split drama)
 * - Upset potential score (seed differential × pick split balance)
 * - Bracket path analysis (what wins does this entry need?)
 *
 * Status: STRUCTURE READY — pending March Madness bracket DB schema.
 * Mirror worldCup.plugin.ts patterns when implementing.
 */
import "server-only"
import { getAiLanguageInstruction } from "@/lib/world-cup/worldCupI18n"
import type { SportPlugin, AIEngineInput } from "../types"

type MarchMadnessContext = {
  poolId: string
  poolName: string
  totalEntries: number
  currentRound: string
  topSeedPicks: Map<string, number> // teamName → count of entries picking them
  leaderboard: Array<{
    rank: number
    entryName: string
    displayName: string
    totalScore: number
    maxPossibleScore: number
    championPick: string
  }>
}

type MarchMadnessProviderData = {
  liveGames: Array<{
    gameId: string
    homeTeam: string; homeSeed: number; homeScore: number | null
    awayTeam: string; awaySeed: number; awayScore: number | null
    status: "scheduled" | "in_progress" | "final"
    round: string
  }>
}

type MarchMadnessInsights = {
  upsetAlerts: Array<{
    game: string
    seedDifferential: number
    upsetProbabilityLabel: "low" | "medium" | "high"
    pickSplit: { favorite: number; underdog: number }
    pointsAtRisk: number
  }>
  cinderellaPickConcentration: Array<{ teamName: string; pickCount: number; seed: number; pickPercent: number }>
  leaderboardSummary: { leader: string; leaderScore: number; maxPossible: number; poolTotal: number }
  bracketBustCandidates: string[] // popular picks that are most likely to lose
}

export const marchMadnessPlugin: SportPlugin<MarchMadnessContext, MarchMadnessProviderData, MarchMadnessInsights> = {
  sport: "march_madness",
  version: "0.1.0",
  features: ["pool_chat", "pool_swing", "champion_risk", "rooting_guide", "recap", "commissioner_insights", "hype"],

  async fetchContext(input: AIEngineInput): Promise<MarchMadnessContext> {
    return {
      poolId: input.contextId,
      poolName: "March Madness Pool",
      totalEntries: 0,
      currentRound: "Round of 64",
      topSeedPicks: new Map(),
      leaderboard: [],
    }
  },

  async fetchProviderData() { return null },

  async computeInsights(context, _providerData): Promise<MarchMadnessInsights> {
    // Upset alert: seedDiff ≥ 5 → high potential; pick split drives pointsAtRisk
    // Champion pick concentration: same formula as WC (count/total × 100)
    const totalEntries = context.totalEntries || 1
    const cinderellaPickConcentration = [...context.topSeedPicks.entries()]
      .map(([teamName, count]) => ({
        teamName,
        pickCount: count,
        seed: 0, // TODO: join with seed data
        pickPercent: Math.round((count / totalEntries) * 100),
      }))
      .sort((a, b) => b.pickCount - a.pickCount)
      .slice(0, 5)

    const leader = context.leaderboard[0]
    return {
      upsetAlerts: [],
      cinderellaPickConcentration,
      leaderboardSummary: {
        leader: leader?.displayName ?? "—",
        leaderScore: leader?.totalScore ?? 0,
        maxPossible: leader?.maxPossibleScore ?? 0,
        poolTotal: context.totalEntries,
      },
      bracketBustCandidates: cinderellaPickConcentration.slice(0, 2).map((c) => c.teamName),
    }
  },

  buildGroundingPacket(context, _providerData, insights, input): Record<string, unknown> {
    return {
      contractVersion: "af-engine-mm-v1", sport: "march_madness", feature: input.feature,
      poolContext: { poolId: context.poolId, poolName: context.poolName, totalEntries: context.totalEntries, currentRound: context.currentRound },
      insights: { upsetAlerts: insights.upsetAlerts, championConcentration: insights.cinderellaPickConcentration, leaderboard: insights.leaderboardSummary, bracketBusts: insights.bracketBustCandidates },
      allowedClaims: ["March Madness pool and bracket data from AllFantasy"],
      missingData: [...(!_providerData ? ["live game scores and results"] : [])],
    }
  },

  buildSystemPrompt(input: AIEngineInput): string {
    const lang = getAiLanguageInstruction(input.locale)
    return `You are Chimmy, AllFantasy's March Madness bracket assistant. GROUNDING CONTRACT: Only use facts in the GROUNDING PACKET. Never invent game results, seeds, or scores. VOICE: Energetic bracket analyst — cite the pool numbers. Respond in ${lang}.`
  },
}
