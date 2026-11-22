/**
 * Server-side World Cup matchup intelligence: deterministic core + optional AI narratives.
 *
 * LLM calls (bracket AI, ask_ai, explain intents) are routed through the canonical
 * provider router, pass the response validator (score_invention + odds_without_data),
 * and write an AiInteractionLog audit row.
 */
import "server-only"
import { routeTextCall } from "@/lib/ai/providerRouter"
import { applyValidationPipeline } from "@/lib/ai/responseValidator"
import {
  buildFreshnessLabel,
  type AIGroundingContract,
} from "@/lib/ai/aiGroundingContract"
import type { UserRole } from "@/lib/ai/engine/types"
import { logAiInteraction } from "@/lib/ai/auditLogger"
import type {
  WorldCupAiStrategy,
  WorldCupMatchupIntelligence,
  WorldCupMatchView,
} from "./types"
import {
  estimateWorldCupWinProbability,
  getWorldCupPickRecommendation,
  getWorldCupUpsetRisk,
} from "./worldCupAiInsights"
import { getWorldCupProjectedMatchTeams } from "./worldCupProjectedBracket"
import {
  buildRankingSeedComparison,
  describeBracketImpactIfTeamWins,
  getProbabilityBasedPickSides,
  getRecentFormPlaceholder,
} from "./worldCupPickStrategy"
import { getOrCreateWcMatchupInsight } from "@/lib/ai/aiInsightCache"

// ─── Grounding contract for matchup intelligence ──────────────────────────────
// The matchup AI runs purely on bracket model probability data.
// liveScores: null → validator will BLOCK any response that states a live score.
// oddsData:   null → validator will WARN if response claims odds/favorites.
function buildMatchupContract(opts: { matchLabel: string }): AIGroundingContract {
  const freshness = buildFreshnessLabel("pool_only", null)
  return {
    contractVersion: "af-contract-v1",
    sport: "world_cup",
    feature: "matchup_preview",
    userRole: "member" as UserRole,
    plan: "pro",
    locale: null,
    sourceFreshness: freshness,
    poolContext: {
      poolId: "matchup",
      poolName: opts.matchLabel,
      totalEntries: 0,
      sport: "world_cup",
      format: "bracket",
      currentPhase: "active",
      prizePool: null,
    },
    scoringContext: null,
    userPicks: null,
    leaderboard: null,
    providerFixtures: null,
    liveScores: null,
    oddsData: null,
    computedInsights: {},
    missingData: [
      "live match scores (live feed not loaded — do not guess any score)",
      "odds, spreads, and betting favorites (not loaded — do not mention)",
    ],
    allowedClaims: ["AllFantasy bracket model win probabilities and strategy recommendations"],
    forbiddenClaims: [
      "any live match score or current result",
      "team favorite status or any odds/spread",
    ],
  }
}

type MatchupIntelligenceIntent = "panel" | "ask_ai" | "explain"

type BuildWorldCupMatchupIntelligenceArgs = {
  match: WorldCupMatchView
  strategy?: WorldCupAiStrategy
  intent?: MatchupIntelligenceIntent
  /**
   * When false/omitted, skips all OpenAI paths (AF Pro / Bracket Brain).
   * Must be true only when the caller verified Bracket Brain AI entitlement.
   */
  bracketBrainAiEntitled?: boolean
}

function deterministicNarratives(params: {
  match: WorldCupMatchView
  strategy: WorldCupAiStrategy
  recommendedTeamName: string
  upsetRisk: "low" | "medium" | "high"
  homePct: number
  awayPct: number
  bracketImpactRecommended: string
}): Pick<
  WorldCupMatchupIntelligence,
  "whyThisPickMakesSense" | "howRiskyIsThisPick" | "whatThisMeansForYourBracket"
> {
  const { recommendedTeamName, upsetRisk, homePct, awayPct, bracketImpactRecommended, strategy } =
    params
  const whyThisPickMakesSense =
    `${recommendedTeamName} fits a ${strategy} read with the model split (${homePct}% / ${awayPct}%). ` +
    `Use “Pick Safe” or “Pick Upset” if you want the probability favorite or contrarian side without locking it in yet.`

  const howRiskyIsThisPick =
    upsetRisk === "high"
      ? "Volatility is elevated — either side can believably win. Differentiation upside comes with real bust risk."
      : upsetRisk === "medium"
        ? "Moderate volatility: lean with the model but expect some bracket variance."
        : "Lower volatility — the favorite is the clearer bracket stabilizer."

  const whatThisMeansForYourBracket =
    `${bracketImpactRecommended} Nothing is saved until you tap “Use This Pick.”`

  return { whyThisPickMakesSense, howRiskyIsThisPick, whatThisMeansForYourBracket }
}

function logMatchupInteraction(payload: {
  userId: string
  intent: MatchupIntelligenceIntent
  generative: boolean
  cacheHit: boolean
  model: string | null
  tokensUsed: number | null
  validatorResult: "clean" | "warned" | "blocked" | "deterministic"
  blockedReason: string | null
}) {
  logAiInteraction({
    userId: payload.userId,
    sport: "world_cup",
    feature: "matchup_preview",
    route: "/api/brackets/world-cup/[challengeId]/ai/matchup-preview",
    plan: "pro",
    providerSource: payload.cacheHit ? "cache" : null,
    freshnessTier: "pool_only",
    promptIntent: payload.intent,
    validatorResult: payload.generative ? payload.validatorResult : "deterministic",
    blockedReason: payload.blockedReason,
    modelUsed: payload.cacheHit ? null : payload.model,
    tokenCost: payload.cacheHit ? null : payload.tokensUsed,
    wasDeterministic: !payload.generative,
  })
}

async function tryGenerativeNarratives(params: {
  match: WorldCupMatchView
  intent: MatchupIntelligenceIntent
  strategy: WorldCupAiStrategy
  homeName: string
  awayName: string
  homePct: number
  awayPct: number
  upsetRisk: "low" | "medium" | "high"
  keyFactors: string[]
  recommendedTeamName: string
  bracketImpactRecommended: string
}): Promise<
  | {
      whyThisPickMakesSense: string
      howRiskyIsThisPick: string
      whatThisMeansForYourBracket: string
      generative: true
      cacheHit: boolean
      model: string | null
      tokensUsed: number | null
      validatorResult: "clean" | "warned" | "blocked"
      blockedReason: string | null
    }
  | null
> {
  if (!params.match.homeTeamId || !params.match.awayTeamId) {
    return null
  }

  const focus =
    params.intent === "explain"
      ? "Explain the matchup mechanics for a bracket picker using bracket-only guidance."
      : "Give actionable bracket guidance."

  const system = [
    `You are a concise World Cup bracket assistant. ${focus}`,
    "GROUNDING: Use only the provided AllFantasy bracket model inputs. Do not claim live scores, match minutes, injuries, lineups, odds, player stats, schedules, or current form unless they are explicitly provided in the prompt.",
    "Predictions must be labeled as bracket-model projections, not verified facts.",
    "If the user needs live or external facts not provided here, say: \"I don't have reliable data for that yet.\"",
    "Respond with exactly three short paragraphs labeled:",
    "WHY:",
    "RISK:",
    "BRACKET:",
    "Each paragraph max 2 sentences. Plain text only.",
  ].join("\n")

  const userMsg =
    "Source: stored AllFantasy bracket model only; no live feed, injury report, player stat feed, odds feed, or schedule feed is included.\n" +
    `${params.homeName} vs ${params.awayName}. Win model: ${params.homeName} ${params.homePct}%, ${params.awayName} ${params.awayPct}%. ` +
    `Upset risk: ${params.upsetRisk}. Strategy: ${params.strategy}. Recommended lean: ${params.recommendedTeamName}. ` +
    `Factors: ${params.keyFactors.join("; ")}.`

  // ── AiInsightCache: check before calling the LLM ─────────────────────────
  // Key: match × strategy × intent × probability split × upset risk.
  // Cache TTL: 60 min — bracket model probabilities are static per round.
  const cacheResult = await getOrCreateWcMatchupInsight(
    {
      matchId: params.match.id,
      strategy: params.strategy,
      intent: params.intent,
      homePct: params.homePct,
      awayPct: params.awayPct,
      upsetRisk: params.upsetRisk,
    },
    async () => {
      const res = await routeTextCall({
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        temperature: params.intent === "explain" ? 0.35 : 0.45,
        maxTokens: 320,
      })

      if (!res.ok || res.text.trim().length < 40) return { resultText: null }

      // Run response through the canonical validator before caching.
      const contract = buildMatchupContract({
        matchLabel: `${params.homeName} vs ${params.awayName}`,
      })
      const validated = applyValidationPipeline(res.text.trim(), contract)

      return {
        resultText: validated,
        tokensUsed: res.tokensUsed,
        provider: res.provider,
        model: res.model,
      }
    }
  )

  if (!cacheResult.text) return null

  // Parse the WHY / RISK / BRACKET sections from cached or fresh text.
  const whyMatch = cacheResult.text.match(/WHY:\s*([\s\S]*?)(?=RISK:|$)/i)
  const riskMatch = cacheResult.text.match(/RISK:\s*([\s\S]*?)(?=BRACKET:|$)/i)
  const bracketMatch = cacheResult.text.match(/BRACKET:\s*([\s\S]*?)$/i)

  if (!whyMatch || !riskMatch || !bracketMatch) return null

  return {
    whyThisPickMakesSense: whyMatch[1].trim(),
    howRiskyIsThisPick: riskMatch[1].trim(),
    whatThisMeansForYourBracket: bracketMatch[1].trim(),
    generative: true,
    cacheHit: cacheResult.cacheHit,
    model: cacheResult.model,
    tokensUsed: cacheResult.tokensUsed,
    validatorResult: "clean",
    blockedReason: null,
  }
}

/**
 * Builds matchup intelligence for API routes and tests.
 */
export async function buildWorldCupMatchupIntelligence(
  args: BuildWorldCupMatchupIntelligenceArgs & {
    logContext?: {
      userId: string
      challengeId: string
      entryId: string
    }
  }
): Promise<WorldCupMatchupIntelligence> {
  const strategy = args.strategy ?? "balanced"
  const intent: MatchupIntelligenceIntent = args.intent ?? "panel"
  const match = args.match
  const bracketBrainAiEntitled = args.bracketBrainAiEntitled === true

  const winProb = estimateWorldCupWinProbability(match)
  const upsetRisk = getWorldCupUpsetRisk(match)
  const rec = getWorldCupPickRecommendation(match, strategy)
  const sides = getProbabilityBasedPickSides(
    match,
    winProb.homeWinProbability,
    winProb.awayWinProbability
  )

  const homePct = Math.round(winProb.homeWinProbability * 100)
  const awayPct = Math.round(winProb.awayWinProbability * 100)
  const eff = getWorldCupProjectedMatchTeams(match)
  const homeName = eff.home.teamName
  const awayName = eff.away.teamName

  const deterministicSummary =
    `Bracket-model guidance: ${rec.recommendedTeamName} recommended (${strategy}). ${homeName} ${homePct}% vs ${awayName} ${awayPct}%. Upset risk: ${upsetRisk}. ${rec.explanation}`

  const bracketImpactRecommended =
    describeBracketImpactIfTeamWins(match, rec.recommendedSide ?? sides.safePickSide)

  let narratives = deterministicNarratives({
    match,
    strategy,
    recommendedTeamName: rec.recommendedTeamName,
    upsetRisk,
    homePct,
    awayPct,
    bracketImpactRecommended,
  })
  let narrativesGenerative = false
  // Tracking for audit log
  let llmModel: string | null = null
  let llmTokens: number | null = null
  let llmCacheHit = false
  let llmValidatorResult: "clean" | "warned" | "blocked" | "deterministic" = "deterministic"
  let llmBlockedReason: string | null = null

  const allowLlm = bracketBrainAiEntitled && (intent === "ask_ai" || intent === "explain")

  if (allowLlm) {
    const gen = await tryGenerativeNarratives({
      match,
      intent,
      strategy,
      homeName,
      awayName,
      homePct,
      awayPct,
      upsetRisk,
      keyFactors: winProb.explanationFactors,
      recommendedTeamName: rec.recommendedTeamName,
      bracketImpactRecommended,
    })
    if (gen) {
      narratives = {
        whyThisPickMakesSense: gen.whyThisPickMakesSense,
        howRiskyIsThisPick: gen.howRiskyIsThisPick,
        whatThisMeansForYourBracket: gen.whatThisMeansForYourBracket,
      }
      narrativesGenerative = gen.generative
      llmCacheHit = gen.cacheHit
      llmModel = gen.model
      llmTokens = gen.tokensUsed
      llmValidatorResult = gen.validatorResult
      llmBlockedReason = gen.blockedReason
    }
  }

  let summary = deterministicSummary
  let summaryGenerative = false
  if (intent === "panel" && bracketBrainAiEntitled && match.homeTeamId && match.awayTeamId) {
    const venue = match.venueName
      ? ` at ${match.venueName}${match.venueCity ? `, ${match.venueCity}` : ""}`
      : ""
    try {
      // ── AiInsightCache: panel summary — TTL 60 min (static per round) ──────
      const panelCacheResult = await getOrCreateWcMatchupInsight(
        {
          matchId: match.id,
          strategy,
          intent: "panel",
          homePct,
          awayPct,
          upsetRisk,
        },
        async () => {
          const aiResult = await routeTextCall({
            messages: [
              {
                role: "system",
                content:
                  "You are a World Cup bracket strategy assistant. Give a concise 2-sentence matchup preview using only the provided AllFantasy bracket model inputs. Do not imply live data, current scores, injuries, lineups, odds, player stats, schedules, or current form. Label predictions as bracket-model guidance.",
              },
              {
                role: "user",
                content:
                  "Source: stored AllFantasy bracket model only; no live feed, injury report, player stat feed, odds feed, or schedule feed is included.\n" +
                  `Match: ${homeName} vs ${awayName}${venue}.\n` +
                  `Win probability: ${homeName} ${homePct}%, ${awayName} ${awayPct}%.\n` +
                  `Upset risk: ${upsetRisk}. Strategy: ${strategy}.\n` +
                  `Key factors: ${winProb.explanationFactors.join("; ")}.\n` +
                  `End with the recommended pick: "${rec.recommendedTeamName}".`,
              },
            ],
            temperature: 0.4,
            maxTokens: 150,
          })
          if (!aiResult.ok || aiResult.text.trim().length <= 20) return { resultText: null }
          const panelContract = buildMatchupContract({ matchLabel: `${homeName} vs ${awayName}` })
          return {
            resultText: applyValidationPipeline(aiResult.text.trim(), panelContract),
            tokensUsed: aiResult.tokensUsed,
            provider: aiResult.provider,
            model: aiResult.model,
          }
        }
      )
      if (panelCacheResult.text) {
        summary = panelCacheResult.text
        summaryGenerative = true
        llmCacheHit = llmCacheHit || panelCacheResult.cacheHit
        llmModel = llmModel ?? panelCacheResult.model
        // Don't add to token count on cache hits — nothing was spent
        if (!panelCacheResult.cacheHit) {
          llmTokens = (llmTokens ?? 0) + (panelCacheResult.tokensUsed ?? 0)
        }
        llmValidatorResult = "clean"
      }
    } catch {
      // keep deterministic summary
    }
  }

  const intel: WorldCupMatchupIntelligence = {
    matchId: match.id,
    recommendedTeamId: rec.recommendedTeamId,
    recommendedTeamName: rec.recommendedTeamName,
    recommendedSide: rec.recommendedSide,
    homeWinProbability: winProb.homeWinProbability,
    awayWinProbability: winProb.awayWinProbability,
    confidence: winProb.confidence,
    upsetRisk,
    keyFactors: winProb.explanationFactors,
    summary,
    safePick: sides.safePickTeamName,
    contrarianPick: sides.upsetPickTeamName,
    projectedScore: null,
    generative: summaryGenerative,
    safePickSide: sides.safePickSide,
    upsetPickSide: sides.upsetPickSide,
    safePickTeamName: sides.safePickTeamName,
    upsetPickTeamName: sides.upsetPickTeamName,
    riskLevel: upsetRisk,
    recentFormSummary: getRecentFormPlaceholder(),
    rankingSeedComparison: buildRankingSeedComparison(match),
    bracketImpactIfHomeWins: describeBracketImpactIfTeamWins(match, "home"),
    bracketImpactIfAwayWins: describeBracketImpactIfTeamWins(match, "away"),
    whyThisPickMakesSense: narratives.whyThisPickMakesSense,
    howRiskyIsThisPick: narratives.howRiskyIsThisPick,
    whatThisMeansForYourBracket: narratives.whatThisMeansForYourBracket,
    narrativesGenerative,
  }

  // Fire-and-forget audit log for every call that reached this function
  if (args.logContext) {
    logMatchupInteraction({
      userId: args.logContext.userId,
      intent,
      generative: narrativesGenerative || summaryGenerative,
      cacheHit: llmCacheHit,
      model: llmModel,
      tokensUsed: llmTokens,
      validatorResult: llmValidatorResult,
      blockedReason: llmBlockedReason,
    })
  }

  return intel
}
