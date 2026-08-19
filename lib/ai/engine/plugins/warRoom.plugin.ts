/**
 * War Room / Draft Plugin — AllFantasy AI Engine
 *
 * The War Room is a live-draft tool. AI calls here are latency-sensitive:
 * - Use "cheap" profile by default
 * - computeInsights runs fast (target <100ms) since it fires every pick
 * - Provider data is pre-loaded at draft start, not fetched per pick
 *
 * Deterministic layer will compute:
 * - Best available player score (ADP-adjusted value over expected)
 * - Roster need score (positions your team is weakest at)
 * - Value over replacement (VOR): player projected points minus positional baseline
 * - Positional scarcity cliff: at what pick does the tier of players drop significantly
 * - Opponent draft analysis: what are opponents likely to target?
 *
 * Status: STRUCTURE READY — pending draft room DB schema and ADP feed wiring.
 */
import "server-only"
import { getAiLanguageInstruction } from "@/lib/world-cup/worldCupI18n"
import type { SportPlugin, AIEngineInput } from "../types"

export type WarRoomContext = {
  draftId: string
  leagueName: string
  sport: string
  scoringFormat: string
  numTeams: number
  totalRounds: number
  currentPick: number
  currentRound: number
  isSuperflex: boolean
  userDraftPosition: number
  userCurrentRoster: Array<{
    playerId: string
    playerName: string
    position: string
    adp: number
    projectedPoints: number
    pickedAt: number // overall pick number
  }>
  remainingPlayers: Array<{
    playerId: string
    playerName: string
    position: string
    adp: number
    projectedPoints: number
    vorScore: number | null // pre-computed value over replacement
    injuryRisk: "low" | "medium" | "high"
  }>
  draftBoard: Array<{
    pickNumber: number
    teamId: string
    playerName: string | null // null if pick hasn't happened yet
    position: string | null
  }>
}

export type WarRoomProviderData = {
  liveAdpUpdates: Array<{ playerId: string; currentAdp: number; trend: "rising" | "falling" | "stable" }>
  injuryUpdates: Array<{ playerId: string; status: string; severity: "out" | "questionable" | "probable" }>
}

export type WarRoomInsights = {
  topRecommendations: Array<{
    playerId: string
    playerName: string
    position: string
    projectedPoints: number
    adp: number
    vorScore: number
    valueLabel: "elite_value" | "good_value" | "fair_value" | "slight_reach" | "reach"
    rosterFitScore: number // 0-100: how well does this player fill a need?
    urgencyLevel: "take_now" | "available_next_pick" | "can_wait" | "avoid"
  }>
  rosterNeeds: Array<{
    position: string
    urgency: "critical" | "moderate" | "low"
    targetRound: number // which round to address this by
    remainingTopOptions: number // how many good options are left
  }>
  scarcityCliffs: Array<{
    position: string
    cliffAtPick: number // the pick number after which tier drops significantly
    tiersRemaining: number
  }>
  nextPickNumber: number
  picksUntilUserDrafts: number
}

export const warRoomPlugin: SportPlugin<WarRoomContext, WarRoomProviderData, WarRoomInsights> = {
  sport: "war_room",
  version: "0.1.0",
  features: ["draft_advice", "matchup_preview", "pool_chat"],

  async fetchContext(input: AIEngineInput): Promise<WarRoomContext> {
    // TODO: prisma.draftRoom.findUnique + draftBoard + playerPool
    return {
      draftId: input.contextId,
      leagueName: "Draft Room",
      sport: "nfl",
      scoringFormat: "ppr",
      numTeams: 12,
      totalRounds: 16,
      currentPick: 1,
      currentRound: 1,
      isSuperflex: false,
      userDraftPosition: 1,
      userCurrentRoster: [],
      remainingPlayers: [],
      draftBoard: [],
    }
  },

  async fetchProviderData() { return null },

  async computeInsights(context, providerData): Promise<WarRoomInsights> {
    const userPickCount = context.userCurrentRoster.length
    const remaining = [...context.remainingPlayers].filter((p) => p.vorScore !== null)

    // ADP-adjusted VOR value calculation
    // valueLabel = (projectedPoints - positionalBaseline) / adpCost
    const recommendations: WarRoomInsights["topRecommendations"] = remaining
      .map((p) => {
        const adpGap = p.adp - context.currentPick
        const injuryPenalty = p.injuryRisk === "high" ? 0.7 : p.injuryRisk === "medium" ? 0.85 : 1.0
        const rosterNeed = context.userCurrentRoster.filter((r) => r.position === p.position).length
        const rosterFit = Math.max(0, 100 - rosterNeed * 20 - (adpGap < 0 ? 30 : 0))

        let valueLabel: WarRoomInsights["topRecommendations"][0]["valueLabel"] = "fair_value"
        if (adpGap > 12) valueLabel = "elite_value"
        else if (adpGap > 5) valueLabel = "good_value"
        else if (adpGap < -8) valueLabel = "reach"
        else if (adpGap < -3) valueLabel = "slight_reach"

        const urgencyLevel: WarRoomInsights["topRecommendations"][0]["urgencyLevel"] =
          adpGap < -5 ? "take_now" :
          adpGap < 3 ? "available_next_pick" :
          adpGap < 12 ? "can_wait" : "avoid"

        return {
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position,
          projectedPoints: p.projectedPoints,
          adp: p.adp,
          vorScore: Math.round((p.vorScore ?? 0) * injuryPenalty),
          valueLabel,
          rosterFitScore: rosterFit,
          urgencyLevel,
        }
      })
      .sort((a, b) => b.vorScore - a.vorScore || b.rosterFitScore - a.rosterFitScore)
      .slice(0, 5)

    // Roster need analysis
    const positionCounts: Record<string, number> = {}
    for (const p of context.userCurrentRoster) {
      positionCounts[p.position] = (positionCounts[p.position] ?? 0) + 1
    }
    const rosterNeeds: WarRoomInsights["rosterNeeds"] = []
    const targetPositions = context.isSuperflex
      ? ["QB", "RB", "WR", "TE", "QB", "FLEX"]
      : ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX"]
    for (const pos of [...new Set(targetPositions)]) {
      const have = positionCounts[pos] ?? 0
      const needed = targetPositions.filter((p) => p === pos).length
      if (have < needed) {
        const available = remaining.filter((p) => p.position === pos).length
        rosterNeeds.push({
          position: pos,
          urgency: have === 0 ? "critical" : "moderate",
          targetRound: context.currentRound + (have === 0 ? 0 : 2),
          remainingTopOptions: Math.min(available, 5),
        })
      }
    }

    const picksPerRound = context.numTeams
    const picksUntilUser = context.userDraftPosition > (context.currentPick % picksPerRound)
      ? context.userDraftPosition - (context.currentPick % picksPerRound)
      : picksPerRound - (context.currentPick % picksPerRound) + context.userDraftPosition

    return {
      topRecommendations: recommendations,
      rosterNeeds: rosterNeeds.slice(0, 5),
      scarcityCliffs: [],
      nextPickNumber: context.currentPick + 1,
      picksUntilUserDrafts: picksUntilUser,
    }
  },

  buildGroundingPacket(context, _providerData, insights, input): Record<string, unknown> {
    return {
      contractVersion: "af-engine-warroom-v1", sport: "war_room", feature: input.feature,
      draftContext: {
        draftId: context.draftId,
        leagueName: context.leagueName,
        sport: context.sport,
        scoringFormat: context.scoringFormat,
        numTeams: context.numTeams,
        currentPick: context.currentPick,
        currentRound: context.currentRound,
        isSuperflex: context.isSuperflex,
        userDraftPosition: context.userDraftPosition,
        picksUntilYourTurn: insights.picksUntilUserDrafts,
        yourCurrentRoster: context.userCurrentRoster.map((p) => ({
          playerName: p.playerName, position: p.position, round: Math.ceil(p.pickedAt / context.numTeams),
        })),
      },
      insights: {
        topPicks: insights.topRecommendations,
        rosterNeeds: insights.rosterNeeds,
        scarcityCliffs: insights.scarcityCliffs,
      },
      allowedClaims: [
        "ADP and projected points from the connected player database",
        "Roster construction and positional value from pre-computed VOR scores",
        "Scarcity and urgency levels from current draft board state",
      ],
      missingData: [...(!_providerData ? ["live ADP updates and injury changes (using pre-draft data)"] : [])],
    }
  },

  buildSystemPrompt(input: AIEngineInput): string {
    const lang = getAiLanguageInstruction(input.locale)
    return `You are Chimmy, AllFantasy's AF Legacy draft assistant. GROUNDING CONTRACT: Only use player data in the GROUNDING PACKET. Never suggest players not in the packet. SPEED: This is a live draft — give a direct 1-2 sentence recommendation, then 1 sentence on why. Do not explain general draft strategy unless asked. NEVER invent ADP or projections. Respond in ${lang}.`
  },
}
