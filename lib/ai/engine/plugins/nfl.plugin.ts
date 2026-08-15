/**
 * NFL Fantasy Plugin — AllFantasy AI Engine
 *
 * Deterministic layer computes:
 * - Start/sit rankings (from projected points, not AI opinion)
 * - Waiver wire priority (FAAB value score, not "trust me" AI)
 * - Trade value differential (from FantasyCalc + scoring context)
 * - Matchup difficulty rating (opponent defense rank vs. position)
 * - Power rankings (based on scoring trends, not vibes)
 *
 * AI only explains WHY the numbers say what they say.
 * AI never invents a projection, rank, or injury status.
 *
 * Implementation status: PLUGIN STRUCTURE READY — deterministic
 * functions pending connection to NFL scoring/roster data.
 * Replace TODO blocks as each data source is wired up.
 */
import "server-only"
import type { SportPlugin, AIEngineInput } from "../types"
import { getAiLanguageInstruction } from "@/lib/world-cup/worldCupI18n"
import { prisma } from "@/lib/prisma"
import { listInjuryFacts } from "@/lib/injuries/injuryReadPort"

// ─── Context type ─────────────────────────────────────────────────────────────

export type NflContext = {
  leagueId: string
  leagueName: string
  scoringFormat: "ppr" | "half_ppr" | "standard" | string
  numTeams: number
  currentWeek: number
  isSuperflex: boolean
  userTeam: {
    teamId: string
    teamName: string
    record: { wins: number; losses: number; ties: number }
    rosterSpots: Array<{
      position: string
      playerId: string
      playerName: string
      projectedPoints: number | null
      actualPoints: number | null
      injuryStatus: string | null // "Questionable" | "Doubtful" | "Out" | "IR" | null
      isStarting: boolean
    }>
  } | null
  leagueStandings: Array<{
    rank: number
    teamId: string
    teamName: string
    wins: number
    losses: number
    pointsFor: number
    pointsAgainst: number
  }>
  waiverClaims: Array<{
    playerId: string
    playerName: string
    position: string
    percentOwned: number
    projectedPoints: number | null
    recentTrend: "up" | "down" | "stable"
  }>
}

// ─── Provider data — from NFL stats/injury API ────────────────────────────────

export type NflProviderData = {
  weeklyProjections: Array<{
    playerId: string
    playerName: string
    position: string
    opponentTeam: string
    projectedPoints: number
    confidenceScore: number // 0-100, deterministic from historical variance
  }>
  injuryReport: Array<{
    playerId: string
    playerName: string
    status: string // "Q" | "D" | "O" | "IR"
    practice: string // "FP" | "LP" | "DNP"
    reason: string
  }>
  defenseRankings: Array<{
    teamAbbr: string
    rankVsQB: number
    rankVsRB: number
    rankVsWR: number
    rankVsTE: number
  }>
}

// ─── Insights — all deterministic calculations ────────────────────────────────

export type NflInsights = {
  startSitRecommendations: Array<{
    playerId: string
    playerName: string
    position: string
    recommendation: "start" | "sit" | "flex"
    projectedPoints: number
    opponentRank: number // 1 = hardest, 32 = easiest
    riskLevel: "low" | "medium" | "high"
    reasonCode: string // "top_projection" | "injury_risk" | "tough_matchup" | "favorable_matchup"
  }>
  waiverPriority: Array<{
    playerId: string
    playerName: string
    position: string
    priorityScore: number // 0-100, deterministic: projection × (1 - percentOwned/100) × trendMultiplier
    projectedPoints: number
    recommendedFaabBid: number | null // % of budget
  }>
  tradeValueSummary: {
    yourTopAssets: Array<{ playerName: string; tradeValue: number; position: string }>
    suggestedTargets: Array<{ playerName: string; tradeValue: number; position: string }>
    needPositions: string[] // derived from roster construction, not AI
  }
  weeklyMatchupGrade: {
    overallGrade: "A" | "B" | "C" | "D" | "F"
    projectedScore: number
    opponentProjectedScore: number
    winProbability: number // 0-100, based on projected scores
  } | null
  powerRankings: Array<{
    rank: number
    teamName: string
    pointsFor: number
    trend: "up" | "down" | "stable"
  }>
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const nflPlugin: SportPlugin<NflContext, NflProviderData, NflInsights> = {
  sport: "nfl",
  version: "0.1.0",
  features: [
    "lineup_advice",
    "matchup_preview",
    "waiver_wire",
    "trade_eval",
    "power_rankings",
    "injury_report",
    "pool_chat",
    "private_ai",
  ],

  async fetchContext(input: AIEngineInput): Promise<NflContext> {
    try {
      const league = await (prisma as any).league.findUnique({
        where: { id: input.contextId },
        select: {
          id: true,
          name: true,
          scoringPreset: true,
          numTeams: true,
          season: true,
          settings: true,
          leagueType: true,
        },
      }).catch(() => null)

      const scoring = String(league?.scoringPreset ?? "ppr").toLowerCase()
      const scoringFormat =
        scoring.includes("half") ? "half_ppr"
        : scoring.includes("std") || scoring.includes("standard") ? "standard"
        : "ppr"

      const settings = league?.settings && typeof league.settings === "object"
        ? (league.settings as Record<string, unknown>)
        : {}

      const currentWeek = (() => {
        const d = new Date()
        const sep1 = new Date(d.getFullYear(), 8, 1)
        const diffMs = d.getTime() - sep1.getTime()
        if (diffMs < 0) return 1
        return Math.min(18, Math.max(1, Math.floor(diffMs / (7 * 86_400_000)) + 1))
      })()

      // Load viewer's team from LeagueTeam
      const viewerTeam = await (prisma as any).leagueTeam.findFirst({
        where: { leagueId: input.contextId, claimedByUserId: input.userId },
        select: {
          id: true,
          teamName: true,
          pointsFor: true,
          wins: true,
          losses: true,
          currentRank: true,
        },
      }).catch(() => null)

      const standings = await (prisma as any).leagueTeam.findMany({
        where: { leagueId: input.contextId },
        select: { teamName: true, pointsFor: true, pointsAgainst: true, wins: true, losses: true, currentRank: true },
        orderBy: [{ wins: "desc" }, { pointsFor: "desc" }],
        take: 20,
      }).catch(() => []) as Array<Record<string, unknown>>

      return {
        leagueId: input.contextId,
        leagueName: league?.name ? String(league.name) : "NFL League",
        scoringFormat,
        numTeams: league?.numTeams ? Number(league.numTeams) : 12,
        currentWeek,
        isSuperflex: Boolean(settings.isSuperflex ?? settings.superflex),
        userTeam: viewerTeam
          ? {
              teamId: String(viewerTeam.id),
              teamName: viewerTeam.teamName ? String(viewerTeam.teamName) : "My Team",
              record: {
                wins: Number(viewerTeam.wins ?? 0),
                losses: Number(viewerTeam.losses ?? 0),
                ties: 0,
              },
              rosterSpots: [],
            }
          : null,
        leagueStandings: standings.map((t, i) => ({
          rank: t.currentRank != null ? Number(t.currentRank) : i + 1,
          teamId: String(t.id ?? ""),
          teamName: String(t.teamName ?? ""),
          pointsFor: Number(t.pointsFor ?? 0),
          pointsAgainst: Number(t.pointsAgainst ?? 0),
          wins: Number(t.wins ?? 0),
          losses: Number(t.losses ?? 0),
        })),
        waiverClaims: [],
      }
    } catch {
      return {
        leagueId: input.contextId,
        leagueName: "NFL League",
        scoringFormat: "ppr",
        numTeams: 12,
        currentWeek: 1,
        isSuperflex: false,
        userTeam: null,
        leagueStandings: [],
        waiverClaims: [],
      }
    }
  },

  async fetchProviderData(context, _input) {
    try {
      const [dbPlayers, dbInjuries] = await Promise.all([
        (prisma as any).sportsPlayerRecord.findMany({
          where: { sport: "NFL" },
          select: {
            name: true, position: true, team: true,
            injuryStatus: true, adp: true, projections: true,
          },
          orderBy: { adp: "asc" },
          take: 300,
        }).catch(() => []) as Promise<Array<Record<string, unknown>>>,
        // Canonical injury read port. This read injury_report_records, which was
        // orphaned when the cron moved to sports_injuries and froze at
        // 2026-04-28 — measured 108 days stale, and fed to the NFL engine as
        // current. Stale rows are dropped rather than passed on.
        listInjuryFacts({ sport: "NFL", limit: 100 })
          .then((list) =>
            (list.facts ?? [])
              .filter((f) => !f.stale)
              .map((f) => ({
                playerName: f.playerName,
                team: f.team,
                // Null means no designation stated, NOT healthy.
                status: f.status ?? "no designation stated",
                position: f.position,
                bodyPart: f.type,
                notes: f.description,
              }))
          )
          .catch(() => []) as Promise<Array<Record<string, unknown>>>,
      ])

      if (dbPlayers.length === 0 && dbInjuries.length === 0) return null

      const providerData: NflProviderData = {
        weeklyProjections: dbPlayers
          .filter((p) => p.projections && typeof p.projections === "object")
          .map((p) => {
            const proj = p.projections as Record<string, unknown>
            return {
              playerId: String(p.name ?? "").toLowerCase().replace(/\s+/g, "-"),
              playerName: String(p.name ?? ""),
              position: String(p.position ?? ""),
              opponentTeam: "",
              projectedPoints: Number(proj.total ?? proj.points ?? 0),
              confidenceScore: 50,
            }
          }),
        injuryReport: dbInjuries.map((i) => ({
          playerId: String(i.playerName ?? "").toLowerCase().replace(/\s+/g, "-"),
          playerName: String(i.playerName ?? ""),
          status: String(i.status ?? ""),
          practice: "",
          reason: String(i.notes ?? i.bodyPart ?? ""),
        })),
        defenseRankings: [],
      }

      return {
        data: providerData,
        freshness: "cached" as const,
        fetchedAt: new Date(),
      }
    } catch {
      return null
    }
  },

  async computeInsights(context, providerData, _input): Promise<NflInsights> {
    // ── Start/Sit ──────────────────────────────────────────────────────────────
    // Ranking formula: projectedPoints × (1 - injuryRisk) × opponentMultiplier
    // All variables come from providerData (projections + defenseRankings + injuryReport)
    // TODO: replace with real scoring when providerData is wired

    const startSitRecommendations: NflInsights["startSitRecommendations"] = []
    if (providerData && context.userTeam) {
      for (const slot of context.userTeam.rosterSpots) {
        if (!slot.projectedPoints) continue
        const injuryRisk = slot.injuryStatus === "Out" || slot.injuryStatus === "IR" ? 1 : 0
        const opponentRank = 16 // placeholder — replace with defenseRankings lookup
        const riskLevel: "low" | "medium" | "high" =
          slot.injuryStatus === "Questionable"
            ? "medium"
            : slot.injuryStatus
              ? "high"
              : "low"
        startSitRecommendations.push({
          playerId: slot.playerId,
          playerName: slot.playerName,
          position: slot.position,
          recommendation: injuryRisk > 0 ? "sit" : slot.projectedPoints > 12 ? "start" : "flex",
          projectedPoints: slot.projectedPoints,
          opponentRank,
          riskLevel,
          reasonCode: injuryRisk > 0 ? "injury_risk" : opponentRank <= 10 ? "tough_matchup" : "top_projection",
        })
      }
    }

    // ── Waiver priority ────────────────────────────────────────────────────────
    // Formula: projection × (1 - ownPct/100) × trendMultiplier
    const waiverPriority: NflInsights["waiverPriority"] = context.waiverClaims
      .filter((p) => p.percentOwned < 50)
      .map((p) => {
        const proj = p.projectedPoints ?? 0
        const trendMult = p.recentTrend === "up" ? 1.2 : p.recentTrend === "down" ? 0.8 : 1.0
        const score = Math.round(proj * (1 - p.percentOwned / 100) * trendMult * 10)
        return {
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position,
          priorityScore: Math.min(100, score),
          projectedPoints: proj,
          recommendedFaabBid: proj > 15 ? Math.round(proj * 2) : null,
        }
      })
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 8)

    // ── Win probability ────────────────────────────────────────────────────────
    // Simple Pythagorean: winProbability = projected^2 / (projected^2 + opp^2)
    // TODO: replace placeholder projections with real providerData values
    const weeklyMatchupGrade: NflInsights["weeklyMatchupGrade"] = null

    // ── Power rankings ─────────────────────────────────────────────────────────
    const powerRankings = context.leagueStandings
      .sort((a, b) => b.pointsFor - a.pointsFor)
      .slice(0, 5)
      .map((t, i) => ({
        rank: i + 1,
        teamName: t.teamName,
        pointsFor: t.pointsFor,
        trend: "stable" as const,
      }))

    return {
      startSitRecommendations,
      waiverPriority,
      tradeValueSummary: { yourTopAssets: [], suggestedTargets: [], needPositions: [] },
      weeklyMatchupGrade,
      powerRankings,
    }
  },

  buildGroundingPacket(context, _providerData, insights, input): Record<string, unknown> {
    return {
      contractVersion: "af-engine-nfl-v1",
      sport: "nfl",
      feature: input.feature,
      userRole: input.userRole,
      entitlements: input.entitlements,
      leagueContext: {
        leagueId: context.leagueId,
        leagueName: context.leagueName,
        scoringFormat: context.scoringFormat,
        numTeams: context.numTeams,
        currentWeek: context.currentWeek,
        isSuperflex: context.isSuperflex,
        userTeam: context.userTeam
          ? { teamName: context.userTeam.teamName, record: context.userTeam.record }
          : null,
      },
      insights: {
        startSit: insights.startSitRecommendations.slice(0, 5),
        topWaiverTargets: insights.waiverPriority.slice(0, 3),
        weeklyMatchup: insights.weeklyMatchupGrade,
        powerRankings: insights.powerRankings,
      },
      allowedClaims: [
        "NFL league standings from AllFantasy",
        "weekly projections from the connected provider",
        "injury report status from the connected provider",
        "start/sit recommendations based on projections and matchup rankings",
        "waiver wire priority scores based on availability and projection",
      ],
      missingData: [
        ...(!_providerData ? ["live NFL projections and injury updates"] : []),
        ...(!context.userTeam ? ["your roster and lineup"] : []),
      ],
    }
  },

  buildSystemPrompt(input: AIEngineInput): string {
    const lang = getAiLanguageInstruction(input.locale)
    return [
      `You are Chimmy, AllFantasy's NFL fantasy assistant for this league.`,
      `GROUNDING CONTRACT: The GROUNDING PACKET is your ONLY source of facts about this league, roster, projections, and standings.`,
      `Never invent player names, injury statuses, or projected point totals.`,
      `Start/sit and waiver recommendations are pre-computed in the packet — explain the reasoning, never recalculate.`,
      `VOICE: Direct, confident fantasy analyst. Lead with the recommendation, then give the reason. Under 150 words.`,
      `Respond in ${lang}.`,
    ].join(" ")
  },
}
