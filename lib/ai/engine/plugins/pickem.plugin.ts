/**
 * Pick'em Pool Plugin — AllFantasy AI Engine
 *
 * Pick'em is sport-agnostic: NFL, college football, NHL, NBA, soccer.
 * The sport is parameterized from the pool config.
 *
 * Deterministic layer will compute:
 * - Game-by-game pick distribution (same as WC pool swing)
 * - Confidence point distribution (if confidence pools)
 * - Trap game detector: heavily-picked team with soft record vs. good opponent
 * - Elimination risk: entries within X points of the cutoff
 *
 * Status: STRUCTURE READY — pending Pick'em pool DB schema.
 */
import "server-only"
import { getAiLanguageInstruction } from "@/lib/world-cup/worldCupI18n"
import type { SportPlugin, AIEngineInput } from "../types"

type PickemContext = {
  poolId: string
  poolName: string
  sport: string // "nfl" | "ncaa_football" | "nhl" | etc.
  currentWeek: number
  useConfidencePoints: boolean
  totalEntries: number
  games: Array<{
    gameId: string
    homeTeam: string
    awayTeam: string
    kickoffEt: string | null
    pickDistribution: { homePicks: number; awayPicks: number }
    maxConfidenceAssigned: number | null
  }>
  leaderboard: Array<{ rank: number; displayName: string; entryName: string; totalScore: number; correctPicks: number }>
}

type PickemProviderData = {
  liveScores: Array<{ gameId: string; homeScore: number; awayScore: number; status: string; quarter: string | null }>
  finalResults: Array<{ gameId: string; winner: "home" | "away" | null }>
}

type PickemInsights = {
  topSwingGame: {
    description: string
    homePicks: number
    awayPicks: number
    chaosRating: number
    confidencePointsAtRisk: number | null
  } | null
  trapGameAlerts: Array<{
    game: string
    favoritedTeam: string
    favoritePickPct: number
    reason: string // "heavy_chalk_but_on_road" | "injury_concern" | "historical_trap"
  }>
  eliminationRisk: Array<{ displayName: string; totalScore: number; behindLeader: number }>
  pickSummary: Array<{
    game: string
    homePct: number
    awayPct: number
    homeKickoff: string | null
  }>
}

export const pickemPlugin: SportPlugin<PickemContext, PickemProviderData, PickemInsights> = {
  sport: "pickem",
  version: "0.1.0",
  features: ["pool_chat", "pool_swing", "recap", "commissioner_insights", "hype", "trash_talk", "at_risk"],

  async fetchContext(input: AIEngineInput): Promise<PickemContext> {
    return { poolId: input.contextId, poolName: "Pick'em Pool", sport: "nfl", currentWeek: 1, useConfidencePoints: false, totalEntries: 0, games: [], leaderboard: [] }
  },

  async fetchProviderData() { return null },

  async computeInsights(context, _providerData): Promise<PickemInsights> {
    const total = context.totalEntries || 1
    let topSwing: PickemInsights["topSwingGame"] = null

    const pickSummary: PickemInsights["pickSummary"] = context.games.map((g) => {
      const t = g.pickDistribution.homePicks + g.pickDistribution.awayPicks || 1
      return {
        game: `${g.homeTeam} vs ${g.awayTeam}`,
        homePct: Math.round((g.pickDistribution.homePicks / t) * 100),
        awayPct: Math.round((g.pickDistribution.awayPicks / t) * 100),
        homeKickoff: g.kickoffEt,
      }
    })

    for (const g of context.games) {
      const { homePicks, awayPicks } = g.pickDistribution
      const t = homePicks + awayPicks
      if (t === 0) continue
      const balance = Math.min(homePicks, awayPicks) / t
      const chaos = Math.max(1, Math.min(10, Math.round(balance * 20)))
      const confAtRisk = g.maxConfidenceAssigned ? Math.min(homePicks, awayPicks) * g.maxConfidenceAssigned : null
      const swingScore = confAtRisk ?? Math.min(homePicks, awayPicks)
      if (!topSwing || swingScore > (topSwing.confidencePointsAtRisk ?? topSwing.chaosRating)) {
        topSwing = { description: `${g.homeTeam} vs ${g.awayTeam}`, homePicks, awayPicks, chaosRating: chaos, confidencePointsAtRisk: confAtRisk }
      }
    }

    // Trap game: >70% picking one team (chalk alert)
    const trapGameAlerts = context.games
      .filter((g) => {
        const t = g.pickDistribution.homePicks + g.pickDistribution.awayPicks
        return t > 0 && Math.max(g.pickDistribution.homePicks, g.pickDistribution.awayPicks) / t > 0.7
      })
      .map((g) => {
        const homeIsFav = g.pickDistribution.homePicks >= g.pickDistribution.awayPicks
        const t = g.pickDistribution.homePicks + g.pickDistribution.awayPicks
        return {
          game: `${g.homeTeam} vs ${g.awayTeam}`,
          favoritedTeam: homeIsFav ? g.homeTeam : g.awayTeam,
          favoritePickPct: Math.round(Math.max(g.pickDistribution.homePicks, g.pickDistribution.awayPicks) / t * 100),
          reason: "heavy_chalk",
        }
      })

    const leader = context.leaderboard[0]
    const eliminationRisk = context.leaderboard
      .filter((r, i) => i > 0 && leader && leader.totalScore - r.totalScore > total * 0.3)
      .slice(0, 5)
      .map((r) => ({ displayName: r.displayName, totalScore: r.totalScore, behindLeader: (leader?.totalScore ?? 0) - r.totalScore }))

    return { topSwingGame: topSwing, trapGameAlerts, eliminationRisk, pickSummary }
  },

  buildGroundingPacket(context, _providerData, insights, input): Record<string, unknown> {
    return {
      contractVersion: "af-engine-pickem-v1", sport: "pickem", feature: input.feature,
      poolContext: { poolId: context.poolId, poolName: context.poolName, sport: context.sport, currentWeek: context.currentWeek, totalEntries: context.totalEntries },
      insights: { topSwingGame: insights.topSwingGame, trapGames: insights.trapGameAlerts, pickSummary: insights.pickSummary, eliminationRisk: insights.eliminationRisk },
      allowedClaims: ["Pick'em pool pick distribution and leaderboard from AllFantasy"],
      missingData: [...(!_providerData ? ["live game scores"] : [])],
    }
  },

  buildSystemPrompt(input: AIEngineInput): string {
    const lang = getAiLanguageInstruction(input.locale)
    return `You are Chimmy, AllFantasy's Pick'em pool assistant. GROUNDING CONTRACT: Only use facts in the GROUNDING PACKET. Never invent game scores or pick percentages. VOICE: Sharp pick'em analyst — cite the packet numbers. Respond in ${lang}.`
  },
}
