/**
 * EPL / Soccer Fantasy Plugin — AllFantasy AI Engine
 *
 * Covers EPL FPL-style and generic soccer fantasy leagues.
 * Deterministic layer will compute:
 * - Fixture difficulty rating (FDR) for next 3 gameweeks
 * - Captain pick score: form × fixture × home/away × clean-sheet probability
 * - Differential pick score: (projection × (1 - ownershipPct/100)) × FDR
 * - Budget efficiency: points per £M on projected XI
 *
 * Status: STRUCTURE READY — pending FPL/soccer stats feed wiring.
 */
import "server-only"
import { getAiLanguageInstruction } from "@/lib/world-cup/worldCupI18n"
import type { SportPlugin, AIEngineInput } from "../types"

type EplContext = {
  leagueId: string
  leagueName: string
  currentGameweek: number
  squadValue: number
  freeTransfers: number
  rosterPlayers: Array<{
    playerId: string
    playerName: string
    position: "GK" | "DEF" | "MID" | "FWD"
    teamName: string
    ownership: number // % of managers in the league who own this player
    form: number // rolling 5-GW average FPL points
    price: number // in £M
    isCaptain: boolean
    nextOpponent: string
    fixtureHome: boolean
  }>
}

type EplProviderData = {
  fixtureDifficultyRatings: Array<{ teamName: string; nextThreeGwFdr: number[] }>
  cleanSheetProbabilities: Array<{ teamName: string; csProbability: number }>
  expectedGoalsAndAssists: Array<{ playerId: string; xG: number; xA: number }>
}

type EplInsights = {
  captainPick: {
    playerName: string
    captainScore: number // form × (1 - FDR/5) × homeBonus × projectedReturn
    projectedReturn: number
    fdr: number
    reasoning: string // deterministic reason code
  } | null
  differentialTargets: Array<{
    playerName: string
    differentialScore: number // projection × (1 - ownership/100) / price
    ownership: number
    price: number
  }>
  transferTargets: Array<{
    playerName: string
    position: string
    price: number
    budgetEfficiency: number // projected points per £M
    fdrNextThree: number // average FDR for next 3 GWs
  }>
  doubleGameweekTargets: string[] // players with 2 fixtures in GW
}

export const eplPlugin: SportPlugin<EplContext, EplProviderData, EplInsights> = {
  sport: "epl",
  version: "0.1.0",
  features: ["lineup_advice", "waiver_wire", "matchup_preview", "pool_chat", "private_ai", "draft_advice"],

  async fetchContext(input: AIEngineInput): Promise<EplContext> {
    return { leagueId: input.contextId, leagueName: "EPL Fantasy League", currentGameweek: 1, squadValue: 100, freeTransfers: 1, rosterPlayers: [] }
  },

  async fetchProviderData() { return null },

  async computeInsights(context, providerData): Promise<EplInsights> {
    // Captain score = form × (homeBonus=1.1 if home, 1.0) × (1 - fdr/5) × 10
    let captainPick: EplInsights["captainPick"] = null
    let bestCaptainScore = -1

    for (const p of context.rosterPlayers) {
      const fdrEntry = providerData?.fixtureDifficultyRatings.find((f) => f.teamName === p.teamName)
      const fdr = fdrEntry?.nextThreeGwFdr[0] ?? 3
      const homeBonus = p.fixtureHome ? 1.1 : 1.0
      const score = Math.round(p.form * homeBonus * (1 - fdr / 5) * 10)
      if (score > bestCaptainScore) {
        bestCaptainScore = score
        captainPick = {
          playerName: p.playerName,
          captainScore: score,
          projectedReturn: Math.round(p.form * 1.2),
          fdr,
          reasoning: fdr <= 2 ? "easy_fixture" : p.form > 8 ? "high_form" : "best_available",
        }
      }
    }

    // Differential: projection × (1 - ownership/100) / price
    const differentialTargets = context.rosterPlayers
      .filter((p) => p.ownership < 25 && p.form > 5)
      .map((p) => ({
        playerName: p.playerName,
        differentialScore: Math.round((p.form * (1 - p.ownership / 100)) / p.price * 100),
        ownership: p.ownership,
        price: p.price,
      }))
      .sort((a, b) => b.differentialScore - a.differentialScore)
      .slice(0, 4)

    return { captainPick, differentialTargets, transferTargets: [], doubleGameweekTargets: [] }
  },

  buildGroundingPacket(context, _providerData, insights, input): Record<string, unknown> {
    return {
      contractVersion: "af-engine-epl-v1", sport: "epl", feature: input.feature,
      leagueContext: { leagueId: context.leagueId, leagueName: context.leagueName, currentGameweek: context.currentGameweek, squadValue: context.squadValue, freeTransfers: context.freeTransfers },
      insights: { captainPick: insights.captainPick, differentialTargets: insights.differentialTargets, transferTargets: insights.transferTargets },
      allowedClaims: ["EPL squad and league data from AllFantasy", "FDR and captain analysis from pre-computed scores"],
      missingData: [...(!_providerData ? ["live FPL fixture difficulty ratings and xG data"] : [])],
    }
  },

  buildSystemPrompt(input: AIEngineInput): string {
    const lang = getAiLanguageInstruction(input.locale)
    return `You are Chimmy, AllFantasy's EPL fantasy assistant. GROUNDING CONTRACT: Only use facts in the GROUNDING PACKET. Never invent FDR ratings, xG, or ownership percentages. VOICE: FPL-fluent analyst — cite scores from the packet. Respond in ${lang}.`
  },
}
