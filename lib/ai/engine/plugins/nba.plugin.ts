/**
 * NBA Fantasy Plugin — AllFantasy AI Engine
 *
 * Deterministic layer will compute:
 * - Usage rate trends (minutes × stat-line averages, not AI opinion)
 * - Trade value based on category contributions (Z-score per category)
 * - Streaming recommendations (single-game adds ranked by upside)
 * - Rest-day risk scoring (back-to-back games, load management history)
 *
 * Status: STRUCTURE READY — fetchContext + computeInsights pending DB wiring.
 */
import "server-only"
import { getAiLanguageInstruction } from "@/lib/world-cup/worldCupI18n"
import type { SportPlugin, AIEngineInput } from "../types"

type NbaContext = {
  leagueId: string
  leagueName: string
  scoringType: "roto" | "h2h_categories" | "h2h_points" | "points"
  currentWeek: number
  userRoster: Array<{
    playerId: string
    playerName: string
    team: string
    position: string[]
    avgPoints: number // fantasy points per game this season
    usageRate: number // 0-100
    injuryStatus: string | null
    gamesThisWeek: number
    isOnRestDay: boolean
  }>
  standings: Array<{ rank: number; teamName: string; wins: number; losses: number }>
}

type NbaProviderData = {
  playerStats: Array<{
    playerId: string
    playerName: string
    lastFiveAvg: number
    matchupGrade: "easy" | "average" | "hard"
    projectedMinutes: number
    backToBack: boolean
  }>
}

type NbaInsights = {
  streamingTargets: Array<{
    playerId: string
    playerName: string
    streamScore: number // games × avgPts × matchupMultiplier × (1 - restRisk)
    gamesThisWeek: number
    matchupGrade: string
  }>
  restDayRisks: Array<{ playerName: string; riskLevel: "high" | "medium"; reason: string }>
  categoryNeeds: string[] // categories below league median
  tradeTargets: Array<{ playerName: string; acquisitionCost: "low" | "medium" | "high"; categoryImpact: string }>
}

export const nbaPlugin: SportPlugin<NbaContext, NbaProviderData, NbaInsights> = {
  sport: "nba",
  version: "0.1.0",
  features: ["lineup_advice", "waiver_wire", "trade_eval", "matchup_preview", "pool_chat", "private_ai"],

  async fetchContext(input: AIEngineInput): Promise<NbaContext> {
    // TODO: prisma.fantasyLeague.findUnique + roster
    return { leagueId: input.contextId, leagueName: "NBA League", scoringType: "h2h_categories", currentWeek: 1, userRoster: [], standings: [] }
  },

  async fetchProviderData() { return null },

  async computeInsights(context, providerData): Promise<NbaInsights> {
    // Streaming score = gamesThisWeek × avgPts × matchupMult × (1 - backToBackPenalty)
    // matchupMult: easy=1.2, average=1.0, hard=0.8
    // backToBackPenalty: 0.15 if on a B2B (load management risk)
    const streamingTargets: NbaInsights["streamingTargets"] = context.userRoster
      .filter((p) => p.gamesThisWeek >= 4)
      .map((p) => {
        const matchupMult = 1.0 // TODO: from providerData
        const restRisk = p.isOnRestDay ? 0.25 : 0.0
        return {
          playerId: p.playerId,
          playerName: p.playerName,
          streamScore: Math.round(p.gamesThisWeek * p.avgPoints * matchupMult * (1 - restRisk)),
          gamesThisWeek: p.gamesThisWeek,
          matchupGrade: "average",
        }
      })
      .sort((a, b) => b.streamScore - a.streamScore)

    const restDayRisks = context.userRoster
      .filter((p) => p.isOnRestDay)
      .map((p) => ({ playerName: p.playerName, riskLevel: "high" as const, reason: "Scheduled rest day — load management risk" }))

    return { streamingTargets: streamingTargets.slice(0, 5), restDayRisks, categoryNeeds: [], tradeTargets: [] }
  },

  buildGroundingPacket(context, _providerData, insights, input): Record<string, unknown> {
    return {
      contractVersion: "af-engine-nba-v1", sport: "nba", feature: input.feature,
      leagueContext: { leagueId: context.leagueId, leagueName: context.leagueName, scoringType: context.scoringType, currentWeek: context.currentWeek },
      insights: { streamingTargets: insights.streamingTargets, restDayRisks: insights.restDayRisks, categoryNeeds: insights.categoryNeeds },
      allowedClaims: ["NBA roster and league data from AllFantasy", "streaming and rest-day analysis from pre-computed scores"],
      missingData: [...(!_providerData ? ["live NBA player stats and projections"] : [])],
    }
  },

  buildSystemPrompt(input: AIEngineInput): string {
    const lang = getAiLanguageInstruction(input.locale)
    return `You are Chimmy, AllFantasy's NBA fantasy assistant. GROUNDING CONTRACT: Only answer using facts in the GROUNDING PACKET. Never invent stats, averages, or projections. VOICE: Concise NBA analyst — lead with the recommendation. Respond in ${lang}.`
  },
}
