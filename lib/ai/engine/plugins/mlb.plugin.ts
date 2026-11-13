/**
 * MLB Fantasy Plugin — AllFantasy AI Engine
 *
 * Deterministic layer will compute:
 * - SP streaming score (park factor × opponent wRC+ × pitcher K-rate × home/away)
 * - Hitter hot/cold streaks (last 7-day wRC+ vs. season average)
 * - Matchup quality score (platoon advantage × starter ERA+ vs. position)
 * - IL return timeline risk (from injury history + roster moves)
 *
 * Status: STRUCTURE READY — pending DB + Statcast data wiring.
 */
import "server-only"
import { getAiLanguageInstruction } from "@/lib/world-cup/worldCupI18n"
import type { SportPlugin, AIEngineInput } from "../types"

type MlbContext = {
  leagueId: string
  leagueName: string
  scoringType: "roto" | "h2h_categories" | "h2h_points"
  currentRosterSpots: Array<{
    playerId: string
    playerName: string
    position: "SP" | "RP" | "C" | "1B" | "2B" | "3B" | "SS" | "OF" | "DH" | "UTIL"
    teamAbbr: string
    injuryStatus: string | null
    nextStartOpponent: string | null // SP only
    wrcPlus: number | null // hitters
    era: number | null // pitchers
  }>
  standings: Array<{ rank: number; teamName: string; wins: number; losses: number }>
}

type MlbProviderData = {
  hitterMatchups: Array<{ playerId: string; wrcPlusLast7: number; platoonAdvantage: boolean; parkFactor: number }>
  pitcherMatchups: Array<{ playerId: string; kRate: number; opponentWrcPlus: number; parkFactor: number; isHome: boolean }>
}

type MlbInsights = {
  spStreamingTargets: Array<{
    playerName: string
    streamScore: number // kRate × (100 / opponentWrcPlus) × parkFactor × (isHome ? 1.05 : 1.0)
    opponent: string
    risk: "low" | "medium" | "high"
  }>
  hotHitters: Array<{ playerName: string; last7wrcPlus: number; seasonWrcPlus: number; trend: "hot" | "cold" }>
  ilRisks: Array<{ playerName: string; injuryStatus: string; returnEta: string | null }>
}

export const mlbPlugin: SportPlugin<MlbContext, MlbProviderData, MlbInsights> = {
  sport: "mlb",
  version: "0.1.0",
  features: ["lineup_advice", "waiver_wire", "matchup_preview", "injury_report", "pool_chat", "private_ai"],

  async fetchContext(input: AIEngineInput): Promise<MlbContext> {
    return { leagueId: input.contextId, leagueName: "MLB League", scoringType: "roto", currentRosterSpots: [], standings: [] }
  },

  async fetchProviderData() { return null },

  async computeInsights(context, providerData): Promise<MlbInsights> {
    // SP streaming: kRate × (100/opponentWrcPlus) × parkFactor × homeAdvantage
    const spStreamingTargets: MlbInsights["spStreamingTargets"] = []
    if (providerData) {
      for (const p of providerData.pitcherMatchups) {
        const score = Math.round(
          p.kRate * (100 / Math.max(p.opponentWrcPlus, 50)) * p.parkFactor * (p.isHome ? 1.05 : 1.0) * 100
        )
        const slot = context.currentRosterSpots.find((s) => s.playerId === p.playerId)
        if (slot) {
          spStreamingTargets.push({
            playerName: slot.playerName,
            streamScore: score,
            opponent: slot.nextStartOpponent ?? "TBD",
            risk: p.kRate < 0.2 ? "high" : p.kRate < 0.25 ? "medium" : "low",
          })
        }
      }
    }

    // Hot/cold hitters: last7 wrcPlus vs season
    const hotHitters: MlbInsights["hotHitters"] = []
    if (providerData) {
      for (const h of providerData.hitterMatchups) {
        const slot = context.currentRosterSpots.find((s) => s.playerId === h.playerId)
        if (slot?.wrcPlus) {
          hotHitters.push({
            playerName: slot.playerName,
            last7wrcPlus: h.wrcPlusLast7,
            seasonWrcPlus: slot.wrcPlus,
            trend: h.wrcPlusLast7 > slot.wrcPlus * 1.15 ? "hot" : h.wrcPlusLast7 < slot.wrcPlus * 0.85 ? "cold" : "hot",
          })
        }
      }
    }

    const ilRisks = context.currentRosterSpots
      .filter((p) => p.injuryStatus)
      .map((p) => ({ playerName: p.playerName, injuryStatus: p.injuryStatus!, returnEta: null }))

    return { spStreamingTargets: spStreamingTargets.sort((a, b) => b.streamScore - a.streamScore).slice(0, 5), hotHitters: hotHitters.slice(0, 6), ilRisks }
  },

  buildGroundingPacket(context, _providerData, insights, input): Record<string, unknown> {
    return {
      contractVersion: "af-engine-mlb-v1", sport: "mlb", feature: input.feature,
      leagueContext: { leagueId: context.leagueId, leagueName: context.leagueName, scoringType: context.scoringType },
      insights: { spStreaming: insights.spStreamingTargets, hotHitters: insights.hotHitters, ilRisks: insights.ilRisks },
      allowedClaims: ["MLB roster data from AllFantasy", "pitcher and hitter matchup analysis from pre-computed scores"],
      missingData: [...(!_providerData ? ["live MLB Statcast projections and park factors"] : [])],
    }
  },

  buildSystemPrompt(input: AIEngineInput): string {
    const lang = getAiLanguageInstruction(input.locale)
    return `You are Chimmy, AllFantasy's MLB fantasy assistant. GROUNDING CONTRACT: Only use facts in the GROUNDING PACKET. Never invent stats, park factors, or projections. VOICE: Analytical baseball mind — cite the numbers from the packet. Respond in ${lang}.`
  },
}
