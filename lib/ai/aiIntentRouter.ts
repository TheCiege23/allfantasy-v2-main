/**
 * AiIntentRouter — classify user questions before they reach the LLM.
 *
 * The goal is to stop ChatGPT credits from being spent on questions that
 * already have deterministic answers: standings, scores, scoring rules,
 * fixture schedules. These come back instantly with zero token cost.
 *
 * ── Decision tree ────────────────────────────────────────────────────────────
 *
 *  "What's the score?"          → deterministic (read from pool data)
 *  "Who is leading?"            → deterministic
 *  "How does scoring work?"     → deterministic
 *  "When does France play?"     → deterministic
 *  "What's my path to first?"   → cache → small LLM
 *  "Explain my bracket picks"   → cache → large LLM
 *  "Why does upset risk matter?" → cache → small LLM
 *  (no pool data loaded)        → missing_data
 *  (feature gated)              → upgrade
 *
 * ── Design notes ─────────────────────────────────────────────────────────────
 *  - Pattern matching is intentionally broad — false positives toward
 *    "deterministic" save money. False negatives (calling LLM unnecessarily)
 *    are caught by the cache layer.
 *  - No external API calls. The classifier runs entirely in process.
 *  - The router returns a decision type; callers decide how to render the
 *    deterministic answer (e.g., pull from pool context object).
 *  - Sport-specific overrides are handled by the `sport` param, not by
 *    separate files — keeps the classifier in one place.
 */

// ─── Decision types ───────────────────────────────────────────────────────────

/** What kind of AI answer is required for this question. */
type AiRouteMode =
  /** Answer from deterministic data — never calls the LLM. */
  | "deterministic"
  /** LLM call, but check cache first (most strategy questions). */
  | "cache"
  /** LLM call — small/fast model sufficient (simple explanation). */
  | "llm_small"
  /** LLM call — larger model needed (complex multi-step reasoning). */
  | "llm_large"
  /** User must upgrade to access this feature. */
  | "upgrade"
  /** Pool data not loaded — cannot answer without grounding. */
  | "missing_data"

/**
 * Intent category — used for analytics and prompt tuning.
 * Maps loosely to what the user is actually asking.
 */
type AiQuestionIntent =
  | "score_query"         // "what's the score"
  | "standings_query"     // "who's in first / who's leading"
  | "scoring_rules_query" // "how does scoring work"
  | "schedule_query"      // "when does X play / what's the fixture"
  | "path_to_win"         // "can I still win / what's my path"
  | "bracket_explain"     // "explain my bracket"
  | "strategy"            // "should I pick X / what's the edge"
  | "upset_risk"          // "is X an upset pick / risk level"
  | "pool_analysis"       // "who benefits if X wins / pool swing"
  | "general"             // catch-all

export type AiRouteDecision = {
  mode: AiRouteMode
  intent: AiQuestionIntent
  /** Which data source can answer this deterministically (when mode=deterministic). */
  deterministicSource?: "standings" | "scores" | "scoring_rules" | "schedule" | "pool_state"
  /** Human-readable rationale — logged for analytics, not shown to users. */
  reason: string
  /**
   * Suggested model override when mode is llm_small or llm_large.
   * null = use the default from the provider router.
   */
  modelHint: "small" | "large" | null
}

// ─── Classifier input ─────────────────────────────────────────────────────────

export type AiIntentRouterInput = {
  /** Raw user message text. */
  prompt: string
  /** Sport context — some intents are sport-specific. */
  sport?: "world_cup" | "nfl" | "nba" | "mlb" | "nhl" | null
  /**
   * Available grounding data signals.
   * Determines whether deterministic paths are fully answerable.
   */
  groundingAvailable?: {
    liveScores?: boolean
    standings?: boolean
    scoringRules?: boolean
    schedule?: boolean
    poolState?: boolean
  }
  /** Whether the user has a plan that allows LLM calls. */
  hasAiEntitlement?: boolean
  /**
   * Skill level from UserAiProfile — affects model size recommendation.
   * "beginner" → prefer simpler explanations even from large models.
   * "advanced" → large model for complex reasoning.
   */
  skillLevel?: "beginner" | "intermediate" | "advanced" | null
}

// ─── Pattern banks ────────────────────────────────────────────────────────────

/** Patterns that indicate a question answerable from live/stored scores. */
const SCORE_PATTERNS: RegExp[] = [
  /\bwhat('?s| is) the (current )?score\b/i,
  /\bhow many (goals?|points?|runs?)\b.*(scored?|have|has)\b/i,
  /\bis (the match|it) (still )?live\b/i,
  /\bwhat('?s| is) (the )?result\b/i,
  /\bfinal score\b/i,
  /\b(did|has) .+ (win|lose|draw)\b/i,
  /\bwho (won|lost|scored)\b/i,
  /\bhalf.?time\b/i,
  /\belapsed (minutes?|time)\b/i,
  /\bpenalt(y|ies)\b.*(score|result|won|decided)\b/i,
]

/** Patterns that indicate a standings/leaderboard question. */
const STANDINGS_PATTERNS: RegExp[] = [
  /\bwho('?s| is) (in |at )?(first|1st|second|2nd|third|3rd|last|the lead|leading|top|bottom)\b/i,
  /\bwhat('?s| is) (the |my )?(current )?rank(ing)?\b/i,
  /\bleaderboard\b/i,
  /\bstandings\b/i,
  /\bhow (many |far )?(points?|games?) (behind|ahead|back)\b/i,
  /\bam i (in|out of) (first|contention|the money)\b/i,
  /\bwho (is |are )?ahead of me\b/i,
  /\bmy (current |pool )?position\b/i,
  /\bwhere (am i|do i stand|do i rank)\b/i,
]

/** Patterns that indicate a scoring rules question. */
const SCORING_RULES_PATTERNS: RegExp[] = [
  /\bhow (does|do) (the )?scoring work\b/i,
  /\bwhat('?s| are) the (point|scoring) (values?|system|rules?|breakdown)\b/i,
  /\bhow (many )?points (do i get|are? awarded|is) (for|a)\b/i,
  /\bchampion bonus\b/i,
  /\bcorrect pick worth\b/i,
  /\b(round of 32|round of 16|quarterfinal|semifinal|final) (points?|worth|value)\b/i,
  /\bconfidence scoring\b/i,
  /\bmax possible (score|points)\b/i,
  /\bhow is (the )?score calculated\b/i,
]

/** Patterns that indicate a schedule/fixture question. */
const SCHEDULE_PATTERNS: RegExp[] = [
  /\bwhen (does|do|is|are) .+ play\b/i,
  /\bwhat time (is|does)\b/i,
  /\bwho (does|do) .+ play (next|today|tomorrow)\b/i,
  /\bnext (match|game|fixture)\b/i,
  /\bfixture(s)?\b/i,
  /\bschedule\b/i,
  /\bkickoff\b/i,
  /\bwhat('?s| is) (the )?(next|upcoming) (game|match)\b/i,
  /\bwhen is the (next|upcoming|final|semifinal|quarterfinal)\b/i,
  /\bgroup stage (schedule|fixtures|matches)\b/i,
]

/** Patterns that indicate path-to-win questions (need pool state + LLM). */
const PATH_TO_WIN_PATTERNS: RegExp[] = [
  /\b(can|could) i (still )?(win|come back|catch up|take (the )?lead)\b/i,
  /\bwhat('?s| is) my (path|route|way) to (first|winning|victory)\b/i,
  /\bwhat (do|does|would) i need\b/i,
  /\bhow (can|do|could) i (win|catch|overtake|move up)\b/i,
  /\bdo i (still )?(have (a )?chance|have (any )?hope)\b/i,
  /\bwhat (results?|outcomes?) (help|hurt) me\b/i,
  /\broot(ing)? (for|against)\b/i,
  /\bwho (should|do) i (root|cheer) for\b/i,
]

/** Patterns that indicate bracket explanation requests. */
const BRACKET_EXPLAIN_PATTERNS: RegExp[] = [
  /\bexplain (my )?bracket\b/i,
  /\bwhat('?s| is) (wrong|good|bad|risky) (with|about) my (bracket|picks)\b/i,
  /\banalyze (my )?bracket\b/i,
  /\bbreak down my (picks|bracket|entry)\b/i,
  /\bhow (strong|good|risky) is my bracket\b/i,
  /\brate my (picks|bracket)\b/i,
]

/** Patterns that indicate strategy questions. */
const STRATEGY_PATTERNS: RegExp[] = [
  /\bshould i pick\b/i,
  /\bwho (should|do) i (pick|choose|take)\b/i,
  /\bbest pick\b/i,
  /\bsmarter pick\b/i,
  /\bpool leverage\b/i,
  /\bcontrarian (pick|play|strategy)\b/i,
  /\bsafe pick\b/i,
  /\bupset pick\b/i,
  /\bwhat('?s| is) the (edge|angle|play|strategy)\b/i,
  /\bsharp (play|pick|move)\b/i,
]

/** Patterns that indicate upset risk questions. */
const UPSET_RISK_PATTERNS: RegExp[] = [
  /\bupset (risk|alert|warning|potential)\b/i,
  /\bhow risky\b/i,
  /\bis .+ a (risky|safe|dangerous) pick\b/i,
  /\bvolatility\b/i,
  /\border (of|or) magnitude\b/i,
]

/** Patterns that indicate pool analysis (who benefits from a result). */
const POOL_ANALYSIS_PATTERNS: RegExp[] = [
  /\bwho (benefits|gains|loses|gets hurt) if\b/i,
  /\bpool swing\b/i,
  /\bif .+ win(s)?\b.*(bracket|pool|me|my)\b/i,
  /\bhow does .+ (result|outcome|win|loss) affect (the )?pool\b/i,
  /\bwho else picked\b/i,
  /\bhow many (people|entries|players) (picked|have|chose)\b/i,
]

// ─── Pattern test helper ──────────────────────────────────────────────────────

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * Classify a user question and return a routing decision.
 *
 * This function is synchronous — no network calls, no async.
 * It runs in <1ms for any prompt length.
 */
export function routeAiIntent(input: AiIntentRouterInput): AiRouteDecision {
  const { prompt, groundingAvailable = {}, hasAiEntitlement = true, skillLevel } = input
  const normalized = prompt.toLowerCase().trim()

  // ── 1. Entitlement gate ───────────────────────────────────────────────────
  if (!hasAiEntitlement) {
    return {
      mode: "upgrade",
      intent: "general",
      reason: "User does not have AI entitlement — route to upgrade prompt",
      modelHint: null,
    }
  }

  // ── 2. Score queries ──────────────────────────────────────────────────────
  if (matchesAny(normalized, SCORE_PATTERNS)) {
    if (groundingAvailable.liveScores) {
      return {
        mode: "deterministic",
        intent: "score_query",
        deterministicSource: "scores",
        reason: "Live score data is loaded — answer from pool state, no LLM needed",
        modelHint: null,
      }
    }
    return {
      mode: "missing_data",
      intent: "score_query",
      reason: "Score question but live scores are not loaded — cannot answer deterministically",
      modelHint: null,
    }
  }

  // ── 3. Standings queries ──────────────────────────────────────────────────
  if (matchesAny(normalized, STANDINGS_PATTERNS)) {
    if (groundingAvailable.standings || groundingAvailable.poolState) {
      return {
        mode: "deterministic",
        intent: "standings_query",
        deterministicSource: "standings",
        reason: "Standings data is loaded — answer from leaderboard, no LLM needed",
        modelHint: null,
      }
    }
    return {
      mode: "missing_data",
      intent: "standings_query",
      reason: "Standings question but pool data is not loaded",
      modelHint: null,
    }
  }

  // ── 4. Scoring rules queries ──────────────────────────────────────────────
  if (matchesAny(normalized, SCORING_RULES_PATTERNS)) {
    if (groundingAvailable.scoringRules || groundingAvailable.poolState) {
      return {
        mode: "deterministic",
        intent: "scoring_rules_query",
        deterministicSource: "scoring_rules",
        reason: "Scoring rules are static — answer from challenge config, no LLM needed",
        modelHint: null,
      }
    }
    return {
      mode: "missing_data",
      intent: "scoring_rules_query",
      reason: "Scoring rules question but challenge config is not loaded",
      modelHint: null,
    }
  }

  // ── 5. Schedule / fixture queries ─────────────────────────────────────────
  if (matchesAny(normalized, SCHEDULE_PATTERNS)) {
    if (groundingAvailable.schedule || groundingAvailable.poolState) {
      return {
        mode: "deterministic",
        intent: "schedule_query",
        deterministicSource: "schedule",
        reason: "Schedule data is loaded — answer from fixtures, no LLM needed",
        modelHint: null,
      }
    }
    return {
      mode: "missing_data",
      intent: "schedule_query",
      reason: "Schedule question but fixture data is not loaded",
      modelHint: null,
    }
  }

  // ── 6. Path to win — needs pool state + LLM ───────────────────────────────
  if (matchesAny(normalized, PATH_TO_WIN_PATTERNS)) {
    if (!groundingAvailable.poolState) {
      return {
        mode: "missing_data",
        intent: "path_to_win",
        reason: "Path-to-win question but pool state is not loaded",
        modelHint: null,
      }
    }
    // Advanced users get the larger model for better multi-step reasoning
    const modelHint = skillLevel === "advanced" ? "large" : "small"
    return {
      mode: "cache",
      intent: "path_to_win",
      reason: "Path-to-win question — grounded in pool state, cache then small LLM",
      modelHint,
    }
  }

  // ── 7. Bracket explanation ────────────────────────────────────────────────
  if (matchesAny(normalized, BRACKET_EXPLAIN_PATTERNS)) {
    if (!groundingAvailable.poolState) {
      return {
        mode: "missing_data",
        intent: "bracket_explain",
        reason: "Bracket explanation needs picks data — not yet loaded",
        modelHint: null,
      }
    }
    return {
      mode: "cache",
      intent: "bracket_explain",
      reason: "Bracket explanation — expensive 600-token call, always check cache first",
      modelHint: "large",
    }
  }

  // ── 8. Pool analysis — who benefits from a result ─────────────────────────
  if (matchesAny(normalized, POOL_ANALYSIS_PATTERNS)) {
    if (!groundingAvailable.poolState) {
      return {
        mode: "missing_data",
        intent: "pool_analysis",
        reason: "Pool analysis needs pick distribution data — not yet loaded",
        modelHint: null,
      }
    }
    return {
      mode: "cache",
      intent: "pool_analysis",
      reason: "Pool analysis — grounded in pick distribution, use cache + small LLM",
      modelHint: "small",
    }
  }

  // ── 9. Upset risk questions ───────────────────────────────────────────────
  if (matchesAny(normalized, UPSET_RISK_PATTERNS)) {
    return {
      mode: "cache",
      intent: "upset_risk",
      reason: "Upset risk — deterministic bracket model input, cache + small LLM explanation",
      modelHint: "small",
    }
  }

  // ── 10. Strategy questions ────────────────────────────────────────────────
  if (matchesAny(normalized, STRATEGY_PATTERNS)) {
    const modelHint = skillLevel === "advanced" ? "large" : "small"
    return {
      mode: "cache",
      intent: "strategy",
      reason: "Strategy question — use cache first, then model based on user skill level",
      modelHint,
    }
  }

  // ── 11. Fallback — general question ──────────────────────────────────────
  // Short prompts (<15 chars) are likely typos or tests — use small model.
  // Long prompts (>200 chars) suggest complexity — use large model.
  const modelHint: "small" | "large" =
    normalized.length > 200 || skillLevel === "advanced" ? "large" : "small"

  return {
    mode: "cache",
    intent: "general",
    reason: `No specific intent pattern matched — default to cache + ${modelHint} model`,
    modelHint,
  }
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Returns true when the decision means "never call an LLM."
 * Used to short-circuit before any token spend happens.
 */
export function isLlmFree(decision: AiRouteDecision): boolean {
  return decision.mode === "deterministic" || decision.mode === "missing_data"
}

/**
 * Returns true when the decision means the user needs to see an upgrade prompt
 * rather than an AI answer.
 */
export function isUpgradeRequired(decision: AiRouteDecision): boolean {
  return decision.mode === "upgrade"
}

/**
 * Returns true when the cache MUST be checked before calling the LLM.
 * This is always true for cache/llm_small/llm_large modes.
 */
export function requiresCacheCheck(decision: AiRouteDecision): boolean {
  return decision.mode === "cache" || decision.mode === "llm_small" || decision.mode === "llm_large"
}
