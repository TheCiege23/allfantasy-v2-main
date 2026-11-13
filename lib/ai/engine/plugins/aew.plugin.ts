/**
 * AEW / Wrestling Plugin — AllFantasy AI Engine
 *
 * AEW is unique: the "sports data" is a historical results/storyline database,
 * not a live stats feed. The AI must be especially strict about sourcing claims
 * from the packet because match outcomes are scripted and spoilers exist.
 *
 * Deterministic layer will compute:
 * - Title reign length and defense count for each champion
 * - Match card pick distribution per PPV event
 * - Upset potential: how often each match type produces "wrong" outcomes
 * - Pool swing: fight with most pick concentration
 *
 * Status: STRUCTURE READY — pending AEW event/championship DB schema.
 */
import "server-only"
import { getAiLanguageInstruction } from "@/lib/world-cup/worldCupI18n"
import type { SportPlugin, AIEngineInput } from "../types"

type AewContext = {
  poolId: string
  poolName: string
  eventName: string
  eventType: "ppv" | "dynamite" | "rampage" | "collision" | "other"
  totalEntries: number
  matches: Array<{
    matchId: string
    stipulation: string // "Singles" | "Tag Team" | "Title Match" | "Ladder" | etc.
    competitors: string[]
    isTitleMatch: boolean
    championName: string | null // current champ if title match
    reignLengthDays: number | null // deterministic from DB
    pickDistribution: Record<string, number> // competitorName → pickCount
  }>
  leaderboard: Array<{ rank: number; displayName: string; entryName: string; totalScore: number }>
}

type AewProviderData = {
  // AEW uses a historical DB, not a live API
  // Results come from the DB after they are recorded (no spoilers from API)
  recordedResults: Array<{
    matchId: string
    winner: string
    method: "Pinfall" | "Submission" | "DQ" | "Countout" | "No Contest"
    duration: string | null
    status: "official" | "pending"
  }>
}

type AewInsights = {
  topSwingMatch: {
    description: string
    pickDistribution: Record<string, number>
    chaosRating: number
    maxPointsAtRisk: number
  } | null
  titleMatchRiskCards: Array<{
    matchDescription: string
    championName: string
    reignLengthDays: number
    pickConcentration: { champPickPct: number; challengerPickPct: number }
    upsetRiskLabel: "low" | "medium" | "high"
  }>
  currentLeader: { displayName: string; score: number } | null
}

export const aewPlugin: SportPlugin<AewContext, AewProviderData, AewInsights> = {
  sport: "aew",
  version: "0.1.0",
  features: ["pool_chat", "pool_swing", "champion_risk", "recap", "commissioner_insights", "hype"],

  async fetchContext(input: AIEngineInput): Promise<AewContext> {
    return { poolId: input.contextId, poolName: "AEW Pool", eventName: "AEW Event", eventType: "ppv", totalEntries: 0, matches: [], leaderboard: [] }
  },

  async fetchProviderData() { return null },

  async computeInsights(context, _providerData): Promise<AewInsights> {
    let topSwing: AewInsights["topSwingMatch"] = null

    for (const match of context.matches) {
      const pickValues = Object.values(match.pickDistribution)
      const total = pickValues.reduce((s, v) => s + v, 0)
      if (total === 0 || pickValues.length < 2) continue
      const sorted = [...pickValues].sort((a, b) => a - b)
      const balance = sorted[0] / total
      const chaosRating = Math.max(1, Math.min(10, Math.round(balance * (match.isTitleMatch ? 1.0 : 0.7) * 20)))
      const maxPoints = sorted[0] * (match.isTitleMatch ? 15 : 8)
      if (!topSwing || maxPoints > topSwing.maxPointsAtRisk) {
        topSwing = { description: match.stipulation + ": " + match.competitors.join(" vs "), pickDistribution: match.pickDistribution, chaosRating, maxPointsAtRisk: maxPoints }
      }
    }

    const titleMatchRiskCards = context.matches
      .filter((m) => m.isTitleMatch && m.championName)
      .map((m) => {
        const total = Object.values(m.pickDistribution).reduce((s, v) => s + v, 0) || 1
        const champPicks = m.pickDistribution[m.championName!] ?? 0
        const champPct = Math.round((champPicks / total) * 100)
        return {
          matchDescription: `${m.competitors.join(" vs ")} — ${m.stipulation}`,
          championName: m.championName!,
          reignLengthDays: m.reignLengthDays ?? 0,
          pickConcentration: { champPickPct: champPct, challengerPickPct: 100 - champPct },
          upsetRiskLabel: champPct > 70 ? "low" : champPct > 50 ? "medium" : "high" as const,
        }
      })

    const leader = context.leaderboard[0]
    return {
      topSwingMatch: topSwing,
      titleMatchRiskCards,
      currentLeader: leader ? { displayName: leader.displayName, score: leader.totalScore } : null,
    }
  },

  buildGroundingPacket(context, _providerData, insights, input): Record<string, unknown> {
    return {
      contractVersion: "af-engine-aew-v1", sport: "aew", feature: input.feature,
      eventContext: { poolId: context.poolId, poolName: context.poolName, eventName: context.eventName, eventType: context.eventType, totalEntries: context.totalEntries },
      insights: { topSwingMatch: insights.topSwingMatch, titleMatchRisks: insights.titleMatchRiskCards, leader: insights.currentLeader },
      allowedClaims: ["AEW pool pick distribution and event data from AllFantasy historical DB"],
      missingData: [...(!_providerData ? ["recorded match results (check back after the event)"] : [])],
    }
  },

  buildSystemPrompt(input: AIEngineInput): string {
    const lang = getAiLanguageInstruction(input.locale)
    return `You are Chimmy, AllFantasy's AEW pool assistant. GROUNDING CONTRACT: Only use facts in the GROUNDING PACKET. Never reveal scripted outcomes, spoilers, or results not in the packet. VOICE: Knowledgeable wrestling fan — reference storylines from the packet only. Respond in ${lang}.`
  },
}
