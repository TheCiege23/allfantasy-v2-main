/**
 * UFC Fantasy Plugin — AllFantasy AI Engine
 *
 * Deterministic layer will compute:
 * - Fighter pick concentration per fight card (same as WC champion risk)
 * - Finishing method distribution (% of picks by KO/TKO vs Decision vs Sub)
 * - Upset potential score (underdog pick % × historical upset rate for weight class)
 * - Pool swing: which fight has the highest point differential potential
 *
 * Status: STRUCTURE READY — pending UFC event + fighter DB schema.
 */
import "server-only"
import { getAiLanguageInstruction } from "@/lib/world-cup/worldCupI18n"
import type { SportPlugin, AIEngineInput } from "../types"

type UfcContext = {
  poolId: string
  poolName: string
  eventName: string
  eventDate: string | null
  totalEntries: number
  fights: Array<{
    fightId: string
    fighter1: string
    fighter2: string
    weightClass: string
    isMainEvent: boolean
    pickDistribution: { fighter1Picks: number; fighter2Picks: number }
  }>
  leaderboard: Array<{ rank: number; displayName: string; entryName: string; totalScore: number }>
}

type UfcProviderData = {
  fightResults: Array<{
    fightId: string
    winner: string
    method: "KO/TKO" | "Submission" | "Decision" | "No Contest"
    round: number
    timeSeconds: number
    status: "final" | "in_progress" | "upcoming"
  }>
}

type UfcInsights = {
  topPoolSwingFight: {
    fight: string
    fighter1Picks: number
    fighter2Picks: number
    maxPointsAtRisk: number
    chaosRating: number // 1-10, same formula as WC
  } | null
  pickConcentration: Array<{
    fightDescription: string
    favoredFighter: string
    favoredPickPercent: number
    underdogFighter: string
    underdogPickPercent: number
    isMainEvent: boolean
  }>
  currentLeader: { displayName: string; score: number } | null
}

export const ufcPlugin: SportPlugin<UfcContext, UfcProviderData, UfcInsights> = {
  sport: "ufc",
  version: "0.1.0",
  features: ["pool_chat", "pool_swing", "champion_risk", "recap", "commissioner_insights", "hype"],

  async fetchContext(input: AIEngineInput): Promise<UfcContext> {
    return { poolId: input.contextId, poolName: "UFC Pool", eventName: "UFC Event", eventDate: null, totalEntries: 0, fights: [], leaderboard: [] }
  },

  async fetchProviderData() { return null },

  async computeInsights(context, _providerData): Promise<UfcInsights> {
    const total = context.totalEntries || 1
    let topSwing: UfcInsights["topPoolSwingFight"] = null

    for (const fight of context.fights) {
      const { fighter1Picks, fighter2Picks } = fight.pickDistribution
      const minPicks = Math.min(fighter1Picks, fighter2Picks)
      const totalPicks = fighter1Picks + fighter2Picks
      if (totalPicks === 0) continue
      const balance = minPicks / totalPicks
      const chaosRating = Math.max(1, Math.min(10, Math.round(balance * (fight.isMainEvent ? 1.0 : 0.8) * 20)))
      const swingScore = minPicks * (fight.isMainEvent ? 10 : 5)
      if (!topSwing || swingScore > topSwing.maxPointsAtRisk) {
        topSwing = {
          fight: `${fight.fighter1} vs ${fight.fighter2}`,
          fighter1Picks,
          fighter2Picks,
          maxPointsAtRisk: swingScore,
          chaosRating,
        }
      }
    }

    const pickConcentration = context.fights.map((f) => {
      const { fighter1Picks, fighter2Picks } = f.pickDistribution
      const totalPicks = fighter1Picks + fighter2Picks || 1
      const f1Pct = Math.round((fighter1Picks / totalPicks) * 100)
      const favored = fighter1Picks >= fighter2Picks ? f.fighter1 : f.fighter2
      const underdog = fighter1Picks >= fighter2Picks ? f.fighter2 : f.fighter1
      return {
        fightDescription: `${f.fighter1} vs ${f.fighter2}`,
        favoredFighter: favored,
        favoredPickPercent: Math.max(f1Pct, 100 - f1Pct),
        underdogFighter: underdog,
        underdogPickPercent: Math.min(f1Pct, 100 - f1Pct),
        isMainEvent: f.isMainEvent,
      }
    })

    const leader = context.leaderboard[0]
    return {
      topPoolSwingFight: topSwing,
      pickConcentration,
      currentLeader: leader ? { displayName: leader.displayName, score: leader.totalScore } : null,
    }
  },

  buildGroundingPacket(context, _providerData, insights, input): Record<string, unknown> {
    return {
      contractVersion: "af-engine-ufc-v1", sport: "ufc", feature: input.feature,
      eventContext: { poolId: context.poolId, poolName: context.poolName, eventName: context.eventName, eventDate: context.eventDate, totalEntries: context.totalEntries },
      insights: { topSwingFight: insights.topPoolSwingFight, pickDistribution: insights.pickConcentration, leader: insights.currentLeader },
      allowedClaims: ["UFC pool pick distribution and leaderboard from AllFantasy"],
      missingData: [...(!_providerData ? ["live UFC fight results and finishes"] : [])],
    }
  },

  buildSystemPrompt(input: AIEngineInput): string {
    const lang = getAiLanguageInstruction(input.locale)
    return `You are Chimmy, AllFantasy's UFC pool assistant. GROUNDING CONTRACT: Only use facts in the GROUNDING PACKET. Never invent fight results, records, or pick percentages. VOICE: Direct MMA analyst — cite numbers from the packet. Respond in ${lang}.`
  },
}
