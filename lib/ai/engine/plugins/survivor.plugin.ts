/**
 * Survivor Pool Plugin — AllFantasy AI Engine
 *
 * Survivor is high-stakes: one wrong pick and you're out.
 * The AI MUST be extremely conservative — if a team recommendation is wrong,
 * a player is eliminated. Deterministic layer is extra strict here.
 *
 * Deterministic layer will compute:
 * - Team availability score (which teams each entry hasn't used yet)
 * - Safe pick consensus: the most-used team this week in the pool
 * - Value pick: contrarian team with good win probability that few use
 * - Elimination risk this week: entries whose last safe option is the chalk pick
 * - Historical win-rate by matchup type (home fav, road dog, etc.)
 *
 * Status: STRUCTURE READY — pending Survivor pool DB schema.
 */
import "server-only"
import { getAiLanguageInstruction } from "@/lib/world-cup/worldCupI18n"
import type { SportPlugin, AIEngineInput } from "../types"

type SurvivorContext = {
  poolId: string
  poolName: string
  sport: string
  currentWeek: number
  totalEntries: number
  aliveEntries: number
  entries: Array<{
    entryId: string
    displayName: string
    isAlive: boolean
    teamsUsed: string[] // teams this entry has already picked
    currentWeekPick: string | null
  }>
  availableTeams: Array<{
    teamName: string
    opponent: string
    isHome: boolean
    winProbability: number | null // 0-100, from Vegas/model if available, else null
    totalUsedThisWeek: number // how many alive entries picked this team this week
  }>
}

type SurvivorProviderData = {
  weeklyWinProbabilities: Array<{ teamName: string; winProbability: number; spread: number }>
}

type SurvivorInsights = {
  weeklyRecommendation: {
    safePick: string | null // highest win probability + most availability
    valueContrarian: string | null // good win prob but used by fewer entries
    trapTeamAlert: string | null // heavily picked team with risk factors
    safePickUsagePercent: number
  }
  eliminationRiskThisWeek: Array<{
    displayName: string
    unusedTeamsLeft: number // how many "safe" teams remain after this week
    currentWeekPick: string | null
  }>
  poolSurvivalStats: {
    startedWith: number
    currentlyAlive: number
    eliminatedThisWeek: number
    expectedToSurvive: number // based on chalk pick consensus
  }
}

export const survivorPlugin: SportPlugin<SurvivorContext, SurvivorProviderData, SurvivorInsights> = {
  sport: "survivor",
  version: "0.1.0",
  features: ["pool_chat", "lineup_advice", "commissioner_insights", "at_risk", "hype"],

  async fetchContext(input: AIEngineInput): Promise<SurvivorContext> {
    return { poolId: input.contextId, poolName: "Survivor Pool", sport: "nfl", currentWeek: 1, totalEntries: 0, aliveEntries: 0, entries: [], availableTeams: [] }
  },

  async fetchProviderData() { return null },

  async computeInsights(context, providerData): Promise<SurvivorInsights> {
    const alive = context.entries.filter((e) => e.isAlive)

    // Enrich with provider win probabilities
    const teamsWithProb = context.availableTeams.map((t) => {
      const provider = providerData?.weeklyWinProbabilities.find((p) => p.teamName === t.teamName)
      return { ...t, winProb: provider?.winProbability ?? t.winProbability ?? 50 }
    })

    // Safe pick: highest win probability
    const safePick = [...teamsWithProb].sort((a, b) => b.winProb - a.winProb)[0] ?? null
    // Value contrarian: win prob ≥ 65 but used by fewer than 20% of alive entries
    const valuePick = [...teamsWithProb]
      .filter((t) => t.winProb >= 65 && t.totalUsedThisWeek / (alive.length || 1) < 0.2)
      .sort((a, b) => b.winProb - a.winProb)[0] ?? null
    // Trap: most used this week but win prob < 70
    const trapCandidate = [...teamsWithProb]
      .filter((t) => t.winProb < 70)
      .sort((a, b) => b.totalUsedThisWeek - a.totalUsedThisWeek)[0] ?? null

    const safePickUsage = safePick
      ? Math.round((safePick.totalUsedThisWeek / (alive.length || 1)) * 100)
      : 0

    // Elimination risk: entries with few unused teams left
    const eliminationRisk = alive
      .map((e) => ({
        displayName: e.displayName,
        unusedTeamsLeft: context.availableTeams.filter((t) => !e.teamsUsed.includes(t.teamName)).length,
        currentWeekPick: e.currentWeekPick,
      }))
      .filter((e) => e.unusedTeamsLeft <= 4)
      .sort((a, b) => a.unusedTeamsLeft - b.unusedTeamsLeft)
      .slice(0, 6)

    // Expected survivors = entries whose current pick has winProb ≥ 70
    const expectedSurvivors = alive.filter((e) => {
      const t = teamsWithProb.find((t) => t.teamName === e.currentWeekPick)
      return (t?.winProb ?? 0) >= 70
    }).length

    return {
      weeklyRecommendation: {
        safePick: safePick?.teamName ?? null,
        valueContrarian: valuePick?.teamName ?? null,
        trapTeamAlert: trapCandidate?.teamName ?? null,
        safePickUsagePercent: safePickUsage,
      },
      eliminationRiskThisWeek: eliminationRisk,
      poolSurvivalStats: {
        startedWith: context.totalEntries,
        currentlyAlive: context.aliveEntries,
        eliminatedThisWeek: 0, // computed post-week
        expectedToSurvive: expectedSurvivors,
      },
    }
  },

  buildGroundingPacket(context, _providerData, insights, input): Record<string, unknown> {
    return {
      contractVersion: "af-engine-survivor-v1", sport: "survivor", feature: input.feature,
      poolContext: { poolId: context.poolId, poolName: context.poolName, sport: context.sport, currentWeek: context.currentWeek, totalEntries: context.totalEntries, aliveEntries: context.aliveEntries },
      insights: { weeklyRecommendation: insights.weeklyRecommendation, eliminationRisk: insights.eliminationRiskThisWeek, survivalStats: insights.poolSurvivalStats },
      allowedClaims: ["Survivor pool pick history and live entry data from AllFantasy", "Team win probabilities from connected provider"],
      missingData: [...(!_providerData ? ["live win probability data"] : [])],
    }
  },

  buildSystemPrompt(input: AIEngineInput): string {
    const lang = getAiLanguageInstruction(input.locale)
    return `You are Chimmy, AllFantasy's Survivor pool assistant. GROUNDING CONTRACT: Only use facts in the GROUNDING PACKET. CRITICAL: Never recommend a team the entry has already used. Never invent win probabilities. VOICE: Careful survivor analyst — this is high-stakes, be precise. Respond in ${lang}.`
  },
}
