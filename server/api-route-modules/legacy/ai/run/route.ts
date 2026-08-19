import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from "next/server"
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { trackLegacyToolUsage } from "@/lib/analytics-server"
import { requireLegacySleeperIdentity } from "@/lib/legacy/requireLegacySleeperIdentity"
import { createDerivedFieldTracker, buildRunEvidence } from "@/lib/legacy/intelligenceEvidence"
import {
  AI_CORE_PERSONALITY,
  getModeInstructions,
  SIGNATURE_PHRASES,
  MEMORY_AWARENESS,
  WHEN_TO_SPEAK_RULES,
  ESCALATION_SYSTEM,
} from "@/lib/ai-personality"
import { getUniversalAIContext } from "@/lib/ai-player-context"
import {
  assembleLegacyAIContext,
  formatEnrichedContextForPrompt,
  type EnrichedLegacyContext,
} from "@/lib/legacy-ai-context"
import { buildLegacyOrchestratorPlan } from "@/lib/legacy-tool/orchestrator"
import { buildLegacyOffseasonBundle, type DraftWarRoomInput } from "@/lib/legacy-tool/offseason"
import {
  buildOffseasonDashboardData,
  buildDraftWarRoomData,
  buildTradeCommandCenterData,
  buildOkEnvelope,
  buildInsufficientDataEnvelope,
  type LegacyScreenEnvelope,
  type LegacyScreenName,
} from "@/lib/legacy-tool/screen-contracts"

const openai = getOpenAIRouteClient()

const LEGACY_AI_SYSTEM_PROMPT = `
${AI_CORE_PERSONALITY}

${getModeInstructions("commentator")}

${SIGNATURE_PHRASES}

${MEMORY_AWARENESS}

${WHEN_TO_SPEAK_RULES}

${ESCALATION_SYSTEM}

${getUniversalAIContext()}

You are THE ELITE AllFantasy Legacy Analyzer - the top dynasty fantasy career analyst.

When analyzing rosters and suggesting moves:
- Apply the TIER SYSTEM to understand player values
- Respect Tier 0 protection rules when suggesting trades
- Account for age curve depreciation in roster analysis
- IDP players have minimal value in offense-only leagues

You have encyclopedic knowledge of what makes a great fantasy manager:
- Win rate benchmarks (elite: 60%+, strong: 55-60%, average: 50-55%, below: <50%)
- Playoff rate benchmarks (elite: 80%+, strong: 60-80%, average: 40-60%)
- Championship rate benchmarks (elite: 20%+ of leagues, strong: 10-20%, average: 5-10%)
- Dynasty-specific success patterns (rebuilding correctly, trading smart, waiver excellence)

## OFFSEASON WINDOW STATUS (CRITICAL)
This is the OFFSEASON - no weekly projections or record reliance.
Classify their current window status based on OFFSEASON factors:

**🏆 READY_TO_COMPETE** - Championship window OPEN for 2025
- Strong positional cores locked in
- QB stability (elite or young ascending QB)
- Minimal aging concerns at key positions
- Pick capital is secondary to competing NOW
- ADVICE: Buy proven talent, sell uncertainty. Win now!

**🔨 REBUILDING** - Building for 2026+ contention
- Accumulating picks and young assets
- Trading away aging vets for value
- QB situation unsettled or in transition
- Patience is the path to championships
- ADVICE: Sell aging RBs, acquire picks and young WRs/QBs

**⚠️ OVEREXTENDED** - Fragile contender status
- Relying on aging stars (30+ RB, declining WR)
- Thin depth behind starters
- One injury away from collapse
- MUST shore up depth or sell before value craters
- ADVICE: Stabilize depth or sell before value craters

**📉 AGING_CORE** - Window closing fast
- Multiple key players 28+
- Production dependent on declining assets
- Should be aggressively selling for picks
- The next 12 months are critical
- ADVICE: Aggressively sell for picks NOW

**🧱 DIRECTION_NEEDED** - Stuck in the middle
- Not good enough to compete
- Not bad enough to get premium picks
- MUST pick a lane: push in or pivot out
- Worst place to be in dynasty
- ADVICE: Pick a lane — push in or pivot out!

## OFFSEASON POWER INDEX
Score each manager's offseason position (0-100):
- 40% Roster Value (dynasty market value of assets)
- 25% Positional Scarcity (QB elite? WR core locked? TE advantage?)
- 20% Age Curve (young ascending vs aging declining)
- 15% Pick Capital (future 1sts, 2nds, projected draft position)

## OFFSEASON LABELS
Assign ONE primary label:
- "Best 2025 Outlook" - highest ceiling for upcoming season
- "Most Fragile Contender" - good on paper but vulnerable
- "Best Rebuild Foundation" - young core with highest upside
- "Aging Out" - window is closing, must act NOW

## AI AS PSYCHOLOGIST - MANAGER ARCHETYPE PROFILING

You profile behavior patterns. This is SHAREABLE content - be playful but insightful.

Pick archetype based on observable patterns:
- **Builder**: Patient, develops young talent, plays long game, tolerates short-term pain for long-term gain
- **Trader**: Active deal-maker, cycles value, seeks buy-low/sell-high opportunities constantly
- **Sniper**: Precise moves, quality over quantity, makes 2-3 big moves per season
- **Hoarder**: Collects assets, reluctant to trade, stockpiles depth, holds elite players
- **Balanced**: Solid all-around approach, no extreme tendencies

Include for each manager:
- behavior_percentile: "You trade more than 91% of managers" style comparisons
- tendency_insight: What they consistently do
- playful_roast: One-liner that's funny and shareable
  Examples:
  - "You're allergic to patience."
  - "You rebuild like it's a hobby."
  - "You trade like you're being paid by volume."
  - "Your bench is a graveyard of 'what ifs'."
  - "You hold players like they owe you money."

## AI AS HISTORIAN - SEASON AUTOPSY

You turn stats into NARRATIVE. Reconstruct their fantasy career like a documentary.
Identify turning points and key decisions that shaped their legacy.

Storytelling Approach:
- "This trade shifted your window back a year."
- "Your season ended the moment this pick busted."
- "This is where it all went wrong."
- "You were closer than you think."
- "If you'd held [Player] one more week..."
- "This was the move that defined your 2024."

Season Autopsy Output:
For each notable season, include:
- turning_point: The moment that defined the season
- what_went_right: Decisions that worked
- what_went_wrong: Decisions that hurt
- butterfly_effect: "If X had happened, you'd have..."
- narrative_summary: 2-3 sentence story of that season

Key Decision Analysis:
- Trades that changed trajectory
- Waiver adds that hit/missed
- Draft picks that busted/boomed
- Holds that cost value
- Sells that were too early/late

Legacy Narrative:
Tell their STORY across all seasons:
- "From 2020-2022, you were a perennial contender. Then the rebuild started..."
- "You've been stuck in the middle for 3 years. It's time to pick a lane."
- "Your 2023 championship was built on that 2021 trade for [Player]."

## DYNASTY SUCCESS PATTERNS TO IDENTIFY
Strengths to look for:
- Consistent playoff appearances = good roster management
- Multiple championships = clutch performance and roster construction
- High win variance = boom/bust roster style (can be good or bad)
- Recovering from bad seasons = resilience and rebuilding skill

Weaknesses to identify:
- Stuck in the middle for years = needs to commit to a direction
- Never winning championships despite playoffs = needs to upgrade ceiling
- High variance without championships = too much risk, not enough payoff
- Low playoff rate = roster construction or waiver issues

## AI AS GM - WINDOW PLANNER

You simulate futures. You run scenario analysis and project contention timelines.
You speak with the language of control and strategic decision-making.

Window Planning Phrases:
- "If you trade X, your best window shifts to 2026."
- "If you hold, your ceiling stays capped."
- "You're choosing between risk and patience."
- "This move locks in a direction."
- "Your current path leads to mediocrity. Here's how to change it."

Scenario Analysis Output:
- current_trajectory: Where they're headed if they do nothing
- push_in_scenario: What happens if they go all-in for 2025
- pivot_out_scenario: What happens if they sell and rebuild
- optimal_path: The recommended direction with reasoning
- timeline_shift: How each move affects their contention window

## UNIFIED AI VOICE (USE EVERYWHERE)

You are THE AllFantasy AI - one consistent personality across the entire platform.
You have memory. You have opinions. You're grounded in data but speak like a trusted advisor.

Signature Phrases (use naturally throughout):
- "Here's the uncomfortable truth…"
- "This helps you now, but costs you later."
- "You're closer than you think."
- "Don't confuse activity with progress."
- "I've seen this pattern before..."
- "This is the move that separates good managers from great ones."

Memory Awareness:
Reference their patterns and history:
- "You usually hesitate to trade picks."
- "You've been stuck in the middle for 3 years."
- "You tend to overvalue RB stability."
- "Based on your history, you'll probably hold too long."

The Goal:
After 10 minutes, users should feel: "This AI understands my team and my league better than my league mates do."

## IMPROVEMENT RECOMMENDATIONS
Based on their data, recommend specific actions:
- For READY_TO_COMPETE: Buy proven talent, sell uncertainty, maximize window
- For REBUILDING: Sell aging RBs, acquire picks and young WRs/QBs
- For OVEREXTENDED: Shore up depth or sell aging assets before decline
- For AGING_CORE: Aggressive selling for picks, rip off the band-aid
- For DIRECTION_NEEDED: MUST CHOOSE A LANE - either push in or pivot out

Output JSON only:
{
  "rating": number (0-100, be honest - 70+ is genuinely good),
  "title": string (e.g., "Dynasty Dominator", "Waiver Wire Wizard", "Perpetual Rebuilder"),
  "archetype": "Builder" | "Trader" | "Sniper" | "Hoarder" | "Balanced",
  "window_status": "READY_TO_COMPETE" | "REBUILDING" | "OVEREXTENDED" | "AGING_CORE" | "DIRECTION_NEEDED",
  "window_status_emoji": "🏆" | "🔨" | "⚠️" | "📉" | "🧱",
  "window_status_label": string (human readable: "Ready to Compete (2025)", "Rebuilding (2026+)", etc.),
  "offseason_label": "Best 2025 Outlook" | "Most Fragile Contender" | "Best Rebuild Foundation" | "Aging Out",
  "offseason_power_index": number (0-100),
  "power_index_breakdown": {
    "roster_value": number (0-100),
    "positional_scarcity": number (0-100),
    "age_curve": number (0-100),
    "pick_capital": number (0-100)
  },
  "consistency_score": number (0-100, low variance = high score),
  "legacy_summary": string (1-2 paragraph career narrative with specific insights),
  "insights": {
    "strengths": string[] (be specific based on their data),
    "weaknesses": string[] (be honest and actionable),
    "hall_of_fame_moments": string[] (championships, big seasons),
    "improvement_tips": string[] (specific to their status)
  },
  "next_season_advice": string (offseason-specific: "If the season started today, here's how you stack up..."),
  "share_text": string (short social media ready legacy card text, <280 chars>),

  "window_planner": {
    "current_trajectory": string (where they're headed doing nothing),
    "push_in_scenario": string (what happens if they go all-in),
    "pivot_out_scenario": string (what happens if they rebuild),
    "optimal_path": string (recommended direction with reasoning),
    "timeline_shift": string (how optimal path affects window)
  },

  "season_autopsy": [
    {
      "season": number,
      "turning_point": string,
      "what_went_right": string[],
      "what_went_wrong": string[],
      "butterfly_effect": string,
      "narrative_summary": string
    }
  ],

  "manager_profile": {
    "behavior_percentile": string ("You trade more than 91% of managers"),
    "tendency_insight": string,
    "playful_roast": string,
    "pattern_memory": string[] (patterns you've observed about them)
  },

  "uncomfortable_truth": string (one honest insight they need to hear),

  "citations": [
    {
      "claim": string (the specific recommendation or factual claim),
      "source": string (e.g., "FantasyCalc", "ESPN Injury Report", "Rolling Insights Stats", "League History", "Trade Data"),
      "timestamp": string (ISO date or "historical" for league data),
      "confidence": "high" | "medium" | "low"
    }
  ]
}

## CITATION RULES (MANDATORY)
- Every nontrivial recommendation in your response MUST have a citation entry.
- Nontrivial = any claim about player value, trade advice, roster move, window status, or strategic recommendation.
- "source" must reference the actual data feed it came from (see ENRICHMENT DATA sections).
- "confidence" is "high" when backed by multiple data points, "medium" for single-source claims, "low" for inferences.
- Include at minimum 3 citations. More is better if justified.
- Do NOT fabricate sources — only cite data actually provided to you.`

function buildLegacySnapshot(user: {
  displayName: string | null
  sleeperUsername: string
  leagues: Array<{
    id: string
    name: string
    season: number
    leagueType: string | null
    specialtyFormat?: string | null
    rosters: Array<{
      wins: number
      losses: number
      pointsFor: number
      isChampion: boolean
      playoffSeed: number | null
      finalStanding: number | null
    }>
  }>
}) {
  const standardLeagues = user.leagues.filter(
    (l) => !l.specialtyFormat || l.specialtyFormat === "standard"
  )
  const specialtyLeagues = user.leagues.filter(
    (l) => l.specialtyFormat && l.specialtyFormat !== "standard"
  )

  let totalWins = 0
  let totalLosses = 0
  let championships = 0
  let totalPointsFor = 0
  let playoffAppearances = 0

  const seasonStats: Record<
    number,
    { wins: number; losses: number; championships: number; leagues: number; pointsFor: number }
  > = {}

  const winPercentages: number[] = []

  for (const league of standardLeagues) {
    const roster = league.rosters[0]
    if (!roster) continue

    totalWins += roster.wins
    totalLosses += roster.losses
    totalPointsFor += roster.pointsFor
    if (roster.isChampion) championships++
    if (roster.playoffSeed && roster.playoffSeed > 0) playoffAppearances++

    const season = league.season
    if (!seasonStats[season]) {
      seasonStats[season] = {
        wins: 0,
        losses: 0,
        championships: 0,
        leagues: 0,
        pointsFor: 0,
      }
    }

    seasonStats[season].wins += roster.wins
    seasonStats[season].losses += roster.losses
    seasonStats[season].leagues++
    seasonStats[season].pointsFor += roster.pointsFor
    if (roster.isChampion) seasonStats[season].championships++

    if (roster.wins + roster.losses > 0) {
      winPercentages.push(roster.wins / (roster.wins + roster.losses))
    }
  }

  const avgWinPct =
    winPercentages.length > 0
      ? winPercentages.reduce((a, b) => a + b, 0) / winPercentages.length
      : 0

  const variance =
    winPercentages.length > 1
      ? winPercentages.reduce((sum, wp) => sum + Math.pow(wp - avgWinPct, 2), 0) /
        winPercentages.length
      : 0

  let bestSeason = { year: 0, winPct: 0 }
  let worstSeason = { year: 0, winPct: 1 }

  for (const [year, stats] of Object.entries(seasonStats)) {
    const winPct =
      stats.wins + stats.losses > 0 ? stats.wins / (stats.wins + stats.losses) : 0

    if (winPct > bestSeason.winPct) {
      bestSeason = { year: parseInt(year, 10), winPct }
    }

    if (winPct < worstSeason.winPct && stats.wins + stats.losses > 0) {
      worstSeason = { year: parseInt(year, 10), winPct }
    }
  }

  const leagueHistory = standardLeagues.map((l) => {
    const roster = l.rosters[0]
    return {
      id: l.id,
      name: l.name,
      season: l.season,
      type: l.leagueType,
      record: roster ? `${roster.wins}-${roster.losses}` : "N/A",
      champion: roster?.isChampion || false,
      final_standing: roster?.finalStanding,
    }
  })

  const specialtyLeagueSummary =
    specialtyLeagues.length > 0
      ? {
          total_specialty_leagues: specialtyLeagues.length,
          formats: Array.from(new Set(specialtyLeagues.map((l) => l.specialtyFormat))),
          note:
            "These specialty leagues (guillotine, bestball, survivor, etc.) are EXCLUDED from grading because their format creates skewed records (e.g., elimination = auto-losses/ties)",
        }
      : null

  return {
    username: user.displayName || user.sleeperUsername,
    grading_note:
      "Stats below are from STANDARD leagues only. Specialty leagues (guillotine, bestball, etc.) excluded because they skew records.",
    total_seasons: Object.keys(seasonStats).length,
    total_standard_leagues: standardLeagues.length,
    total_leagues_including_specialty: user.leagues.length,
    total_wins: totalWins,
    total_losses: totalLosses,
    win_percentage: Math.round(avgWinPct * 1000) / 10,
    championships,
    playoff_appearances: playoffAppearances,
    playoff_rate:
      standardLeagues.length > 0
        ? Math.round((playoffAppearances / standardLeagues.length) * 100)
        : 0,
    total_points: Math.round(totalPointsFor),
    consistency_variance: Math.round(variance * 10000) / 100,
    best_season:
      bestSeason.year > 0
        ? `${bestSeason.year} (${Math.round(bestSeason.winPct * 100)}% wins)`
        : null,
    worst_season:
      worstSeason.year > 0
        ? `${worstSeason.year} (${Math.round(worstSeason.winPct * 100)}% wins)`
        : null,
    season_breakdown: seasonStats,
    league_types: standardLeagues
      .map((l) => l.leagueType)
      .filter((v, i, a) => a.indexOf(v) === i),
    league_history: leagueHistory,
    specialty_leagues_excluded: specialtyLeagueSummary,
  }
}

type LegacyAudit = {
  partialData: boolean
  sourcesUsed: string[]
  missingSources: string[]
  dataFreshness: Record<string, string>
}


type LegacyCitation = {
  claim: string
  source: string
  timestamp: string
  confidence: "high" | "medium" | "low"
}

type NormalizedLegacyResponse = {
  rating: number
  title: string
  archetype: string
  consistency_score: number
  window_status: string
  window_status_emoji: string
  window_status_label: string
  offseason_label: string
  offseason_power_index: number
  power_index_breakdown: {
    roster_value: number
    positional_scarcity: number
    age_curve: number
    pick_capital: number
  }
  legacy_summary: string
  insights: {
    strengths: string[]
    weaknesses: string[]
    hall_of_fame_moments: string[]
    improvement_tips: string[]
  }
  next_season_advice: string
  share_text: string
  citations: LegacyCitation[]
  /** Fields synthesized from snapshot formulas because the model omitted them — derived, not
   * observed (Task 2 honesty). */
  derived_fields: string[]
}

function toStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max)
}

function toBoundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function normalizeCitations(value: unknown, audit: LegacyAudit): LegacyCitation[] {
  const input = Array.isArray(value) ? value : []
  const citations = input
    .map((entry): LegacyCitation | null => {
      if (!entry || typeof entry !== "object") return null
      const e = entry as Record<string, unknown>
      const claim = typeof e.claim === "string" ? e.claim.trim() : ""
      const source = typeof e.source === "string" ? e.source.trim() : ""
      if (!claim || !source) return null
      const confidence =
        e.confidence === "high" || e.confidence === "medium" || e.confidence === "low"
          ? e.confidence
          : "medium"
      return {
        claim,
        source,
        timestamp: typeof e.timestamp === "string" && e.timestamp.trim() ? e.timestamp : "historical",
        confidence,
      }
    })
    .filter((c): c is LegacyCitation => Boolean(c))
    .slice(0, 12)

  if (citations.length >= 3) return citations

  const fallback: LegacyCitation[] = [
    {
      claim: "Legacy grading anchored to imported league history and performance trends.",
      source: "importedLeague",
      timestamp: audit.dataFreshness.importedLeague || new Date().toISOString(),
      confidence: "high",
    },
  ]
  if (audit.sourcesUsed.includes("fantasyCalc")) {
    fallback.push({
      claim: "Dynasty market context incorporated from FantasyCalc where available.",
      source: "fantasyCalc",
      timestamp: audit.dataFreshness.fantasyCalc || new Date().toISOString(),
      confidence: "medium",
    })
  }
  if (audit.sourcesUsed.includes("newsApi")) {
    fallback.push({
      claim: "Recent player and team context considered from News API enrichment.",
      source: "newsApi",
      timestamp: audit.dataFreshness.newsApi || new Date().toISOString(),
      confidence: "medium",
    })
  }
  if (audit.sourcesUsed.includes("rollingInsights")) {
    fallback.push({
      claim: "Rolling trends and performance snapshots included from rolling insights.",
      source: "rollingInsights",
      timestamp: audit.dataFreshness.rollingInsights || new Date().toISOString(),
      confidence: "medium",
    })
  }
  return [...citations, ...fallback].slice(0, 6)
}

function buildEnrichmentPriorityBrief(audit: LegacyAudit): string {
  const weightedSources = [
    { key: "importedLeague", weight: 0.42 },
    { key: "fantasyCalc", weight: 0.24 },
    { key: "rollingInsights", weight: 0.2 },
    { key: "newsApi", weight: 0.14 },
  ]
  const active = weightedSources
    .filter((s) => audit.sourcesUsed.includes(s.key))
    .map((s) => `${s.key}(${Math.round(s.weight * 100)}%)`)
    .join(", ")
  const missing = audit.missingSources.length ? audit.missingSources.join(", ") : "none"
  return `Data coverage priority: ${active || "importedLeague(100%)"} | missing=${missing} | partial=${audit.partialData}`
}

function buildLegacyExecutionPlan(args: {
  requestText?: string
  audit: LegacyAudit
}) {
  const sources = new Set(args.audit.sourcesUsed)
  return buildLegacyOrchestratorPlan({
    requestText: args.requestText,
    hasLeagueContext: true,
    hasRosterContext: true,
    hasPlayerStates: sources.has("fantasyCalc") || sources.has("rollingInsights"),
    hasTeamStates: sources.has("rollingInsights"),
    needsGrokOverlay: sources.has("newsApi"),
    needsSimulation: false,
    needsCommissionerAlertCheck: false,
    priority: "medium",
  })
}

function normalizeLegacyResponse(
  aiResponse: Record<string, unknown>,
  snapshot: ReturnType<typeof buildLegacySnapshot>,
  audit: LegacyAudit,
): NormalizedLegacyResponse {
  const insights = (aiResponse.insights as Record<string, unknown> | null) || null
  const fallbackTitle =
    snapshot.win_percentage >= 60
      ? "Dynasty Contender"
      : snapshot.win_percentage >= 50
        ? "Competitive Manager"
        : "Rebuild Candidate"

  // Honesty (Task 2): every field the model omits is filled by a FORMULA over the snapshot —
  // a derived value, not an observation. The tracker records exactly which fields that
  // happened to, so the response can label them and evidence can lower confidence.
  const tracker = createDerivedFieldTracker()
  const breakdown = aiResponse.power_index_breakdown as Record<string, unknown> | undefined

  const rating = tracker.bounded("rating", aiResponse.rating, 0, 100, Math.round(snapshot.win_percentage || 50))
  const offseasonPower = tracker.bounded(
    "offseason_power_index",
    aiResponse.offseason_power_index,
    0,
    100,
    Math.round(rating * 0.7 + snapshot.playoff_rate * 0.3),
  )

  return {
    rating,
    title: tracker.text("title", aiResponse.title, fallbackTitle),
    archetype: tracker.text("archetype", aiResponse.archetype, "Balanced"),
    consistency_score: tracker.bounded(
      "consistency_score",
      aiResponse.consistency_score,
      0,
      100,
      Math.max(15, 100 - Math.round((snapshot.consistency_variance || 0) * 8)),
    ),
    window_status: tracker.text("window_status", aiResponse.window_status, "DIRECTION_NEEDED"),
    window_status_emoji: tracker.text("window_status_emoji", aiResponse.window_status_emoji, "[direction-needed]"),
    window_status_label: tracker.text("window_status_label", aiResponse.window_status_label, "Direction Needed"),
    offseason_label: tracker.text("offseason_label", aiResponse.offseason_label, "Most Fragile Contender"),
    offseason_power_index: offseasonPower,
    power_index_breakdown: {
      roster_value: tracker.bounded(
        "power_index_breakdown.roster_value",
        breakdown?.roster_value,
        0,
        100,
        Math.round(offseasonPower * 0.4),
      ),
      positional_scarcity: tracker.bounded(
        "power_index_breakdown.positional_scarcity",
        breakdown?.positional_scarcity,
        0,
        100,
        Math.round(offseasonPower * 0.25),
      ),
      age_curve: tracker.bounded(
        "power_index_breakdown.age_curve",
        breakdown?.age_curve,
        0,
        100,
        Math.round(offseasonPower * 0.2),
      ),
      pick_capital: tracker.bounded(
        "power_index_breakdown.pick_capital",
        breakdown?.pick_capital,
        0,
        100,
        Math.round(offseasonPower * 0.15),
      ),
    },
    legacy_summary: tracker.text(
      "legacy_summary",
      aiResponse.legacy_summary,
      `Standard-league profile: ${snapshot.win_percentage}% win rate across ${snapshot.total_standard_leagues} leagues with ${snapshot.championships} title(s).`,
    ),
    insights: {
      strengths: toStringArray(insights?.strengths),
      weaknesses: toStringArray(insights?.weaknesses),
      hall_of_fame_moments: toStringArray(insights?.hall_of_fame_moments),
      improvement_tips: toStringArray(insights?.improvement_tips),
    },
    next_season_advice: tracker.text(
      "next_season_advice",
      aiResponse.next_season_advice,
      "Focus on one clear lane this offseason: consolidate for contention or convert aging value into future assets.",
    ),
    share_text: tracker.text(
      "share_text",
      aiResponse.share_text,
      `${snapshot.username}: ${rating}/100 legacy grade in standard leagues.`,
    ),
    citations: normalizeCitations(aiResponse.citations, audit),
    derived_fields: tracker.fields(),
  }
}
function createRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function buildLegacyScreenContracts(args: {
  requestId: string
  snapshot: ReturnType<typeof buildLegacySnapshot>
  offseason: ReturnType<typeof buildLegacyOffseasonBundle>
  enrichedContext: EnrichedLegacyContext | null
  draftInput?: DraftWarRoomInput
  reportSignal?: {
    title?: string
    archetype?: string
    window_status?: string
    next_season_advice?: string
    insights?: {
      strengths?: string[]
      weaknesses?: string[]
      improvement_tips?: string[]
    }
  }
  audit: LegacyAudit
  userId: string
}): Record<LegacyScreenName, LegacyScreenEnvelope<unknown>> {
  const usedLiveNewsOverlay = args.audit.sourcesUsed.includes('newsApi')

  const offseasonDashboardData = buildOffseasonDashboardData({
    snapshot: args.snapshot as any,
    offseason: args.offseason,
    enrichedContext: args.enrichedContext,
    reportSignal: args.reportSignal,
    userId: args.userId,
  })

  const tradeCommandCenterData = buildTradeCommandCenterData({
    snapshot: args.snapshot as any,
    offseason: args.offseason,
  })

  const missingDraftFields: string[] = []
  if (!args.draftInput?.pick_number) missingDraftFields.push('draft_order')
  if (!args.draftInput?.available_players?.length) missingDraftFields.push('available_players')
  if (!args.enrichedContext?.currentRosters?.length) missingDraftFields.push('user_roster')
  if (!args.enrichedContext?.currentRosters?.[0]) missingDraftFields.push('league_scoring')

  const draftEnvelope =
    missingDraftFields.length > 0
      ? buildInsufficientDataEnvelope({
          requestId: args.requestId,
          screen: 'draft_war_room',
          missingFields: missingDraftFields,
          message: 'Draft War Room requires draft order, user roster, and league scoring settings.',
          usedLiveNewsOverlay,
        })
      : buildOkEnvelope({
          requestId: args.requestId,
          screen: 'draft_war_room',
          data: buildDraftWarRoomData({
            offseason: args.offseason,
            draftInput: args.draftInput,
          }),
          confidence: 0.81,
          usedSimulation: true,
          usedLiveNewsOverlay,
        })

  return {
    offseason_dashboard: buildOkEnvelope({
      requestId: args.requestId,
      screen: 'offseason_dashboard',
      data: offseasonDashboardData,
      confidence: 0.84,
      usedSimulation: false,
      usedLiveNewsOverlay,
    }),
    draft_war_room: draftEnvelope,
    trade_command_center: buildOkEnvelope({
      requestId: args.requestId,
      screen: 'trade_command_center',
      data: tradeCommandCenterData,
      confidence: 0.8,
      usedSimulation: false,
      usedLiveNewsOverlay,
    }),
  }
}

export const POST = withApiUsage({
  endpoint: "/api/legacy/ai/run",
  tool: "LegacyAiRun",
})(async (request: NextRequest) => {
  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown"
    const rateLimitResult = rateLimit(ip, 5, 60000)

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again later." },
        { status: 429 }
      )
    }

    const body = await request.json()
    const { force_refresh } = body
    const draftInput: DraftWarRoomInput | undefined =
      body?.draft_input && typeof body.draft_input === "object"
        ? (body.draft_input as DraftWarRoomInput)
        : undefined

    const gate = await requireLegacySleeperIdentity(request, {
      requestedUsername: String(body?.sleeper_username || "").trim() || null,
      rateLimit: { action: "ai_run", maxRequests: 10, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeper_username = gate.identity.sleeperUsername

    const user = await prisma.legacyUser.findUnique({
      where: { sleeperUsername: String(sleeper_username).toLowerCase() },
      include: {
        leagues: { include: { rosters: true } },
        aiReports: {
          where: { reportType: "legacy" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: "User not found. Start an import first." },
        { status: 404 }
      )
    }

    const snapshot = buildLegacySnapshot(user)
    const requestId = createRequestId()
    const requestedScreen = typeof body?.screen === "string" ? (body.screen as LegacyScreenName) : null

    if (force_refresh && user.aiReports.length > 0) {
      await prisma.legacyAIReport.deleteMany({
        where: { userId: user.id, reportType: "legacy" },
      })
    }

    if (!force_refresh && user.aiReports.length > 0) {
      const existingReport = user.aiReports[0]
      const insights = existingReport.insights as Record<string, unknown> | null
      const cachedAudit: LegacyAudit = {
        partialData: false,
        sourcesUsed: ["importedLeague"],
        missingSources: [],
        dataFreshness: { importedLeague: existingReport.createdAt.toISOString() },
      }
      const cachedReportSignal = {
        title: existingReport.title || undefined,
        archetype: typeof insights?.archetype === "string" ? insights.archetype : undefined,
        window_status: typeof insights?.window_status === "string" ? insights.window_status : undefined,
        next_season_advice:
          typeof insights?.next_season_advice === "string"
            ? insights.next_season_advice
            : undefined,
        insights: {
          strengths: Array.isArray(insights?.strengths) ? (insights?.strengths as string[]) : [],
          weaknesses: Array.isArray(insights?.weaknesses) ? (insights?.weaknesses as string[]) : [],
          improvement_tips: Array.isArray(insights?.improvement_tips)
            ? (insights?.improvement_tips as string[])
            : [],
        },
      }
      const cachedOffseason = buildLegacyOffseasonBundle({
        snapshot: snapshot as any,
        enrichedContext: null,
        draftInput,
        reportSignal: cachedReportSignal,
      })
      const cachedScreenContracts = buildLegacyScreenContracts({
        requestId,
        snapshot,
        offseason: cachedOffseason,
        enrichedContext: null,
        draftInput,
        reportSignal: cachedReportSignal,
        audit: cachedAudit,
        userId: user.id,
      })
      const cachedScreenResponse = requestedScreen ? cachedScreenContracts[requestedScreen] : null

      return NextResponse.json({
        success: true,
        cached: true,
        offseason: cachedOffseason,
        orchestration_plan: buildLegacyExecutionPlan({
          requestText: body?.request_text,
          audit: cachedAudit,
        }),
        report: {
          rating: existingReport.rating,
          title: existingReport.title,
          archetype: insights?.archetype,
          consistency_score: insights?.consistency_score,
          window_status: insights?.window_status,
          window_status_emoji: insights?.window_status_emoji,
          window_status_label: insights?.window_status_label,
          offseason_label: insights?.offseason_label,
          offseason_power_index: insights?.offseason_power_index,
          power_index_breakdown: insights?.power_index_breakdown,
          legacy_summary: existingReport.summary,
          insights: {
            strengths: insights?.strengths,
            weaknesses: insights?.weaknesses,
            hall_of_fame_moments: insights?.hall_of_fame_moments,
            improvement_tips: insights?.improvement_tips,
          },
          next_season_advice: insights?.next_season_advice,
          share_text: existingReport.shareText,
          citations: Array.isArray(insights?.citations) ? insights.citations : [],
          created_at: existingReport.createdAt,
        },
        audit: cachedAudit,
        request_id: requestId,
        screen_response: cachedScreenResponse,
        screen_contracts: cachedScreenContracts,
        ui_tabs: ["offseason_dashboard", "draft_war_room", "trade_command_center"],
      })
    }

    let enrichmentBlock = ""
    const now = new Date().toISOString()
    let enrichedContext: EnrichedLegacyContext | null = null

    let enrichmentAudit: LegacyAudit = {
      partialData: false,
      sourcesUsed: ["importedLeague"],
      missingSources: [],
      dataFreshness: { importedLeague: now },
    }

    try {
      const enriched = await assembleLegacyAIContext(prisma, user as any, snapshot as any)
      enrichedContext = enriched
      enrichmentBlock = formatEnrichedContextForPrompt(enriched)

      const sa = enriched.sourceAudit
      const df = enriched.dataFreshness
      const sources: string[] = ["importedLeague"]
      const missing: string[] = []
      const freshness: Record<string, string> = { importedLeague: now }

      if (sa.fantasyCalcPlayerCount > 0 || sa.fantasyCalcPickCount > 0) {
        sources.push("fantasyCalc")
        freshness.fantasyCalc = df.fantasyCalcFetchedAt || now
      } else if (sa.missingSources.includes("fantasycalc")) {
        missing.push("fantasyCalc")
      }

      if (sa.newsItemCount > 0) {
        sources.push("newsApi")
        freshness.newsApi = df.newsAge || now
      } else if (sa.missingSources.includes("news")) {
        missing.push("newsApi")
      }

      if (sa.rollingInsightsPlayerCount > 0) {
        sources.push("rollingInsights")
        freshness.rollingInsights = df.assembledAt || now
      } else if (sa.missingSources.includes("rolling_insights")) {
        missing.push("rollingInsights")
      }

      enrichmentAudit = {
        partialData: sa.partialData,
        sourcesUsed: sources,
        missingSources: missing,
        dataFreshness: freshness,
      }
    } catch (err) {
      console.warn("[LegacyAI] Enrichment assembly failed, continuing without:", err)
      enrichmentAudit = {
        partialData: true,
        sourcesUsed: ["importedLeague"],
        missingSources: ["fantasyCalc", "newsApi", "rollingInsights"],
        dataFreshness: { importedLeague: now },
      }
    }

    const userPrompt = `Analyze this fantasy manager's legacy:

${JSON.stringify(snapshot, null, 2)}

Data reliability framing:
- ${buildEnrichmentPriorityBrief(enrichmentAudit)}
- Use only provided sources and downgrade confidence when coverage is partial.

${
  enrichmentBlock
    ? `\n--- ENRICHMENT DATA (use to enhance analysis) ---\n${enrichmentBlock}\n--- END ENRICHMENT DATA ---`
    : ""
}

Generate a comprehensive rating and analysis.`

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: LEGACY_AI_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2500,
      response_format: { type: "json_object" },
    })

    const responseText = completion.choices[0]?.message?.content
    if (!responseText) {
      return NextResponse.json({ error: "No AI response" }, { status: 500 })
    }

    const aiResponse = JSON.parse(responseText) as Record<string, unknown>
    const normalized = normalizeLegacyResponse(aiResponse, snapshot, enrichmentAudit)

    await prisma.legacyAIReport.create({
      data: {
        userId: user.id,
        reportType: "legacy",
        rating: normalized.rating,
        title: normalized.title,
        summary: normalized.legacy_summary,
        insights: {
          archetype: normalized.archetype,
          consistency_score: normalized.consistency_score,
          window_status: normalized.window_status,
          window_status_emoji: normalized.window_status_emoji,
          window_status_label: normalized.window_status_label,
          offseason_label: normalized.offseason_label,
          offseason_power_index: normalized.offseason_power_index,
          power_index_breakdown: normalized.power_index_breakdown,
          strengths: normalized.insights.strengths,
          weaknesses: normalized.insights.weaknesses,
          hall_of_fame_moments: normalized.insights.hall_of_fame_moments,
          improvement_tips: normalized.insights.improvement_tips,
          next_season_advice: normalized.next_season_advice,
          citations: normalized.citations,
        },
        shareText: normalized.share_text,
      },
    })

    trackLegacyToolUsage("legacy_ai_run", user.id)

    const normalizedReportSignal = {
      title: normalized.title,
      archetype: normalized.archetype,
      window_status: normalized.window_status,
      next_season_advice: normalized.next_season_advice,
      insights: normalized.insights,
    }
    const offseasonBundle = buildLegacyOffseasonBundle({
      snapshot: snapshot as any,
      enrichedContext,
      draftInput,
      reportSignal: normalizedReportSignal,
    })
    const screenContracts = buildLegacyScreenContracts({
      requestId,
      snapshot,
      offseason: offseasonBundle,
      enrichedContext,
      draftInput,
      reportSignal: normalizedReportSignal,
      audit: enrichmentAudit,
      userId: user.id,
    })
    const screenResponse = requestedScreen ? screenContracts[requestedScreen] : null

    return NextResponse.json({
      success: true,
      cached: false,
      offseason: offseasonBundle,
      orchestration_plan: buildLegacyExecutionPlan({
        requestText: body?.request_text,
        audit: enrichmentAudit,
      }),
      report: {
        rating: normalized.rating,
        title: normalized.title,
        archetype: normalized.archetype,
        consistency_score: normalized.consistency_score,
        window_status: normalized.window_status,
        window_status_emoji: normalized.window_status_emoji,
        window_status_label: normalized.window_status_label,
        offseason_label: normalized.offseason_label,
        offseason_power_index: normalized.offseason_power_index,
        power_index_breakdown: normalized.power_index_breakdown,
        legacy_summary: normalized.legacy_summary,
        insights: normalized.insights,
        next_season_advice: normalized.next_season_advice,
        share_text: normalized.share_text,
        citations: normalized.citations,
        derived_fields: normalized.derived_fields,
      },
      evidence: buildRunEvidence({ audit: enrichmentAudit, derivedFields: normalized.derived_fields }),
      audit: enrichmentAudit,
      request_id: requestId,
      screen_response: screenResponse,
      screen_contracts: screenContracts,
      ui_tabs: ["offseason_dashboard", "draft_war_room", "trade_command_center"],
    })
  } catch (error) {
    console.error("Legacy AI run error:", error)
    return NextResponse.json(
      { error: "Failed to run AI analysis", details: String(error) },
      { status: 500 }
    )
  }
})


