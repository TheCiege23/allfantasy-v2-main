/**
 * NHL Fantasy Plugin — AllFantasy AI Engine
 *
 * Deterministic layer will compute:
 * - Power-play unit deployment (PP1 vs PP2 — scoring opportunity delta)
 * - Goalie starts prediction score (rest days + team's back-to-back)
 * - Hot/cold scoring line trends (Corsi/Fenwick proxies where available)
 * - Trade value by position scarcity in 12-team vs 16-team contexts
 *
 * Status: STRUCTURE READY — pending DB + NHL stats feed wiring.
 */
import "server-only"
import { getAiLanguageInstruction } from "@/lib/world-cup/worldCupI18n"
import type { SportPlugin, AIEngineInput } from "../types"

type NhlContext = {
  leagueId: string
  leagueName: string
  scoringType: "roto" | "h2h_categories" | "h2h_points"
  rosterSpots: Array<{
    playerId: string
    playerName: string
    position: "C" | "LW" | "RW" | "D" | "G" | "UTIL"
    ppUnit: 1 | 2 | null
    injuryStatus: string | null
    pointsPerGame: number
    savePct: number | null // G only
    gamesThisWeek: number
  }>
}

type NhlProviderData = {
  goalieStartProbabilities: Array<{ playerId: string; startProbability: number; isBackToBack: boolean }>
  ppDeployment: Array<{ playerId: string; ppToi: number; ppUnit: 1 | 2 }>
}

type NhlInsights = {
  goalieRecommendations: Array<{
    playerName: string
    startScore: number // startProbability × (1 - backToBackPenalty) × winPctMultiplier
    risk: "low" | "medium" | "high"
  }>
  ppTargets: Array<{ playerName: string; ppUnit: 1 | 2; ppToi: number; opportunityScore: number }>
  streamingDefensemen: Array<{ playerName: string; ppToi: number; pointsPerGame: number; score: number }>
}

export const nhlPlugin: SportPlugin<NhlContext, NhlProviderData, NhlInsights> = {
  sport: "nhl",
  version: "0.1.0",
  features: ["lineup_advice", "waiver_wire", "matchup_preview", "pool_chat", "private_ai"],

  async fetchContext(input: AIEngineInput): Promise<NhlContext> {
    return { leagueId: input.contextId, leagueName: "NHL League", scoringType: "h2h_categories", rosterSpots: [] }
  },

  async fetchProviderData() { return null },

  async computeInsights(context, providerData): Promise<NhlInsights> {
    // Goalie score = startProb × (backToBack ? 0.75 : 1.0) × 100
    const goalieRecommendations: NhlInsights["goalieRecommendations"] = []
    if (providerData) {
      for (const g of providerData.goalieStartProbabilities) {
        const slot = context.rosterSpots.find((s) => s.playerId === g.playerId)
        if (!slot) continue
        const score = Math.round(g.startProbability * (g.isBackToBack ? 0.75 : 1.0) * 100)
        goalieRecommendations.push({
          playerName: slot.playerName,
          startScore: score,
          risk: g.isBackToBack ? "high" : g.startProbability < 0.6 ? "medium" : "low",
        })
      }
    }

    // PP targets: PP1 unit players with high TOI
    const ppTargets: NhlInsights["ppTargets"] = []
    if (providerData) {
      for (const p of providerData.ppDeployment) {
        const slot = context.rosterSpots.find((s) => s.playerId === p.playerId)
        if (!slot) continue
        ppTargets.push({
          playerName: slot.playerName,
          ppUnit: p.ppUnit,
          ppToi: p.ppToi,
          opportunityScore: Math.round((p.ppUnit === 1 ? 1.5 : 1.0) * p.ppToi * slot.pointsPerGame * 10),
        })
      }
    }

    // Streaming D: PPT × pointsPerGame score
    const streamingDefensemen = context.rosterSpots
      .filter((s) => s.position === "D" && s.ppUnit === 1)
      .map((s) => ({
        playerName: s.playerName,
        ppToi: 0, // filled from providerData when wired
        pointsPerGame: s.pointsPerGame,
        score: Math.round(s.pointsPerGame * s.gamesThisWeek * 20),
      }))
      .sort((a, b) => b.score - a.score)

    return {
      goalieRecommendations: goalieRecommendations.sort((a, b) => b.startScore - a.startScore),
      ppTargets: ppTargets.sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, 5),
      streamingDefensemen: streamingDefensemen.slice(0, 4),
    }
  },

  buildGroundingPacket(context, _providerData, insights, input): Record<string, unknown> {
    return {
      contractVersion: "af-engine-nhl-v1", sport: "nhl", feature: input.feature,
      leagueContext: { leagueId: context.leagueId, leagueName: context.leagueName, scoringType: context.scoringType },
      insights: { goalieStarts: insights.goalieRecommendations, ppTargets: insights.ppTargets, streamingD: insights.streamingDefensemen },
      allowedClaims: ["NHL roster data from AllFantasy", "goalie start probability and PP deployment from provider"],
      missingData: [...(!_providerData ? ["live NHL start probabilities and PP deployment data"] : [])],
    }
  },

  buildSystemPrompt(input: AIEngineInput): string {
    const lang = getAiLanguageInstruction(input.locale)
    return `You are Chimmy, AllFantasy's NHL fantasy assistant. GROUNDING CONTRACT: Only use facts in the GROUNDING PACKET. Never invent goalie starts, PP units, or stats. VOICE: Knowledgeable hockey analyst — cite the numbers. Respond in ${lang}.`
  },
}
