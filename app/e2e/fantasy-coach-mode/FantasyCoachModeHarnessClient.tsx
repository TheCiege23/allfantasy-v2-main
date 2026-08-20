"use client"

import { useEffect, useState } from "react"
import { CoachDashboard, type CoachEvaluationLoader } from "@/components/coach/CoachDashboard"
import type {
  CoachAdviceRequester,
  LineupOptimizationRequester,
} from "@/components/coach/CoachAdvicePanel"
import type { CoachEvaluationResult } from "@/lib/fantasy-coach/types"
import type { CoachAdviceType } from "@/lib/ai-coach/types"

const ADVICE_BY_TYPE: Record<CoachAdviceType, { summary: string; bullets: string[]; challenge: string }> = {
  start_sit: {
    summary: "Start/Sit edge: lock your top projected core and bench the low-floor fringe.",
    bullets: [
      "Start the strongest projection at each required slot.",
      "Bench volatile fringe players in close matchups.",
      "Keep late-swap flexibility for questionable tags.",
    ],
    challenge: "Finalize two toughest start/sit calls before lock.",
  },
  lineup_optimization: {
    summary: "Lineup edge: start the highest-floor core and use matchup upside in flex.",
    bullets: [
      "Prioritize projection leaders for locked starters.",
      "Use matchup-adjusted upside at flex if you need ceiling.",
      "Re-check injury tags before kickoff windows.",
    ],
    challenge: "Finalize your flex decision one hour before lock.",
  },
  draft: {
    summary: "Draft edge: prioritize value pockets and avoid forcing positional reaches.",
    bullets: [
      "Take best value on board when tier gaps are small.",
      "Use roster needs only as tie-breakers, not primary drivers.",
      "Track ADP drift to capitalize on late value.",
    ],
    challenge: "Make your next pick from the best remaining value tier.",
  },
  trade: {
    summary: "Trade edge: package bench depth into one reliable weekly starter.",
    bullets: [
      "Target managers with opposite positional needs.",
      "Move volatile producers while their value is elevated.",
      "Request fair two-for-one upgrades, not headline names only.",
    ],
    challenge: "Send one concrete trade offer today.",
  },
  waiver: {
    summary: "Waiver edge: prioritize role growth and near-term starter paths.",
    bullets: [
      "Spend on players with 1-2 week start viability.",
      "Protect your RB room with direct handcuff coverage.",
      "Avoid one-week spikes with no usage signal.",
    ],
    challenge: "Submit claims with pre-planned drops before waivers run.",
  },
}

function hashString(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const requestAdvice: CoachAdviceRequester = async ({ type }) => {
  const resolved = ADVICE_BY_TYPE[type]
  return {
    type,
    summary: resolved.summary,
    bullets: resolved.bullets,
    challenge: resolved.challenge,
    tone: "motivational",
    recommendation: {
      type,
      headline: resolved.summary,
      items: resolved.bullets.map((bullet) => ({ label: bullet })),
      contextSummary: "Harness deterministic context.",
    },
    explanation: {
      summary: resolved.summary,
      bullets: resolved.bullets,
      challenge: resolved.challenge,
      tone: "motivational",
      source: "ai",
    },
  }
}

const requestLineupOptimization: LineupOptimizationRequester = async ({ sport, useAIExplanation }) => {
  return {
    ok: true,
    deterministic: true,
    result: {
      sport: sport ?? "NBA",
      totalProjectedPoints: 134.7,
      starters: [
        {
          slotId: "PG-1",
          slotCode: "PG",
          slotLabel: "PG",
          playerId: "starter-1",
          playerName: "Harness Floor Guard",
          projectedPoints: 34.2,
          selectedPosition: "PG",
        },
        {
          slotId: "SG-1",
          slotCode: "SG",
          slotLabel: "SG",
          playerId: "starter-2",
          playerName: "Harness Wing Creator",
          projectedPoints: 31.8,
          selectedPosition: "SG",
        },
        {
          slotId: "SF-1",
          slotCode: "SF",
          slotLabel: "SF",
          playerId: "starter-3",
          playerName: "Harness Two-Way Wing",
          projectedPoints: 33.1,
          selectedPosition: "SF",
        },
        {
          slotId: "UTIL-1",
          slotCode: "UTIL",
          slotLabel: "UTIL",
          playerId: "starter-4",
          playerName: "Harness Utility Scorer",
          projectedPoints: 35.6,
          selectedPosition: "PF",
        },
      ],
      bench: [
        {
          playerId: "bench-1",
          playerName: "Harness Bench Upside",
          projectedPoints: 21.4,
          positions: ["SG"],
        },
      ],
      unfilledSlots: [],
      deterministicNotes: [
        "Deterministic optimizer selected the highest projected legal combination.",
        "All required slots were filled.",
      ],
    },
    explanation: {
      summary: "The optimizer selected the top legal projection combination for this lineup.",
      bullets: [
        "High-floor guard production anchors the total projection.",
        "Wing volume and utility upside maximize projected points.",
        useAIExplanation
          ? "AI explanation is enabled in this harness response."
          : "Deterministic explanation is active in this harness response.",
      ],
      source: useAIExplanation ? "ai" : "deterministic",
    },
  }
}

const loadEvaluation: CoachEvaluationLoader = async ({
  sport,
  teamName,
  week,
}): Promise<CoachEvaluationResult> => {
  const resolvedTeamName = teamName?.trim() || "Harness FC"
  const resolvedWeek = week ?? 9
  const deterministicSeed = hashString(`${sport}|${resolvedTeamName}|${resolvedWeek}`)

  return {
    sport,
    rosterStrengths: [
      `${resolvedTeamName} has a reliable creator core carrying the weekly floor.`,
      `The best starter room is outperforming neutral baseline by more than three points.`,
      `Ceiling access is still healthy when the swing slot hits its top band.`,
    ],
    rosterWeaknesses: [
      `One starter room is under league baseline and needs insulation before lock.`,
      `Bench-to-starter drop-off is sharp enough to justify an immediate add.`,
      `A schedule drag is compressing the downside band for the weakest slot.`,
    ],
    waiverOpportunities: [
      {
        playerName: "Harness Streamer Midfielder",
        position: sport === "SOCCER" ? "MID" : sport === "NBA" ? "G" : "FLEX",
        reason: "This waiver target covers the weakest slot with a steadier short-term floor.",
        priority: "high",
        playerHref: `/player-comparison?player=${encodeURIComponent("Harness Streamer Midfielder")}&source=coach-mode&e2e=1`,
      },
      {
        playerName: "Harness Glue Utility",
        position: "UTIL",
        reason: "A second add gives you lineup flexibility if the first claim misses.",
        priority: "medium",
        playerHref: `/player-comparison?player=${encodeURIComponent("Harness Glue Utility")}&source=coach-mode&e2e=1`,
      },
    ],
    tradeSuggestions: [
      {
        summary: "Package one surplus strength into a steadier weekly starter at your weakest slot.",
        targetHint: "Use the analyzer to test 2-for-1 builds around your current pressure point.",
        priority: "high",
        tradeAnalyzerHref: `/trade-evaluator?source=coach-mode&e2e=1&sport=${encodeURIComponent(sport)}`,
      },
    ],
    lineupImprovements: [
      "Protect the weakest slot this week and avoid using it as your main upside bet.",
      "Break ties in favor of the swing slot because the schedule is adding real lift there.",
      "If you need ceiling, concentrate it in the top-band scorer instead of spreading risk everywhere.",
    ],
    actionRecommendations: [
      {
        id: "waiver",
        type: "waiver",
        label: "Open Waiver AI",
        summary: "Start with a waiver move that patches the thinnest room on the roster.",
        priority: "high",
        toolHref: `/waiver-ai?source=coach-mode&e2e=1&sport=${encodeURIComponent(sport)}`,
      },
      {
        id: "trade",
        type: "trade",
        label: "Open Trade Analyzer",
        summary: "Model one surplus-for-stability offer before the next scoring window.",
        priority: "medium",
        toolHref: `/trade-evaluator?source=coach-mode&e2e=1&sport=${encodeURIComponent(sport)}`,
      },
      {
        id: "lineup",
        type: "lineup",
        label: "Review Rankings",
        summary: "Use rankings to confirm your final tiebreakers before lock.",
        priority: "medium",
        toolHref: `/rankings?source=coach-mode&e2e=1&sport=${encodeURIComponent(sport)}`,
      },
    ],
    evaluationMetrics: [
      {
        id: "starter-floor",
        label: "Starter floor",
        score: 76,
        trend: "up",
        summary: "Your downside band is still carrying most of the projected total.",
      },
      {
        id: "ceiling-access",
        label: "Ceiling access",
        score: 69,
        trend: "steady",
        summary: "The swing slot still gives this roster a path to spike weeks.",
      },
      {
        id: "waiver-flexibility",
        label: "Waiver flexibility",
        score: 48,
        trend: "down",
        summary: "The weakest room needs help before you can call the roster stable.",
      },
      {
        id: "trade-leverage",
        label: "Trade leverage",
        score: 73,
        trend: "up",
        summary: "You have enough surplus to shop for a steadier starter.",
      },
    ],
    teamSummary: `${resolvedTeamName} carries a healthy projection band for Week ${resolvedWeek}, but one weak room is keeping the weekly floor from matching the top-end profile.`,
    teamSnapshot: {
      presetId: "e2e-harness",
      presetName: "Harness Rotation",
      teamName: resolvedTeamName,
      week: resolvedWeek,
      adjustedProjection: 128.4,
      adjustedFloor: 113.2,
      adjustedCeiling: 141.6,
      scheduleAdjustment: 2.7,
      strongestSlot: sport === "SOCCER" ? "MID" : sport === "NBA" ? "PG" : "WR",
      weakestSlot: sport === "SOCCER" ? "DEF" : sport === "NBA" ? "C" : "TE",
      swingSlot: sport === "SOCCER" ? "FWD" : sport === "NBA" ? "UTIL" : "FLEX",
    },
    providerInsights: {
      deepseek:
        "The math says this roster is playable now, but one starter room is absorbing too much downside relative to the rest of the projection band.",
      grok:
        "This is the kind of team that can absolutely win the week if you patch the floor first instead of chasing one more splashy upside bet.",
      openai:
        "Coach move: make the waiver add, keep the lineup anchored around your safest room, and then test one trade that turns surplus into weekly stability.",
    },
    rosterMathSummary:
      "The math says this roster is playable now, but one starter room is absorbing too much downside relative to the rest of the projection band.",
    strategyInsight:
      "This is the kind of team that can absolutely win the week if you patch the floor first instead of chasing one more splashy upside bet.",
    weeklyAdvice:
      "Coach move: make the waiver add, keep the lineup anchored around your safest room, and then test one trade that turns surplus into weekly stability.",
    deterministicSeed,
    lastEvaluatedAt: "2026-03-26T15:00:00.000Z",
  }
}

export default function FantasyCoachModeHarnessClient() {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  return (
    <div className="min-h-screen bg-[#040915] p-6 text-white">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Fantasy Coach Mode Harness</h1>
          <p className="text-sm text-white/70">
            Deterministic harness for coach dashboard, provider overlays, and coach action links.
          </p>
          <p className="text-xs text-white/50" data-testid="fantasy-coach-hydrated-flag">
            {hydrated ? "hydrated" : "hydrating"}
          </p>
        </div>

        <CoachDashboard
          leagueId="league-coach-1"
          leagueName="Coach League"
          initialSport="NBA"
          initialTeamName="Starter Squad"
          initialWeek={9}
          loadEvaluation={loadEvaluation}
          requestAdvice={requestAdvice}
          requestLineupOptimization={requestLineupOptimization}
        />
      </div>
    </div>
  )
}
