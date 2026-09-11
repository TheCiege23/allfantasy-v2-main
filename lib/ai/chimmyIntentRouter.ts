export type ChimmyIntentCategory =
  | "world_cup_pool"
  | "world_cup_scoring"
  | "world_cup_bracket"
  | "soccer_general"
  | "dashboard_general"
  | "nfl_redraft"
  | "fantasy_trade"
  | "fantasy_draft"
  | "commissioner"
  | "unsupported_live_data"

export type ChimmyTokenPolicy = "no_charge" | "charge_after_success" | "blocked_no_charge"

export type ChimmyIntentRoute = {
  category: ChimmyIntentCategory
  dataSource: "world_cup_cache" | "sports_cache" | "league_context" | "user_context" | "none"
  groundingService:
    | "worldCupChimmyGroundingService"
    | "chimmySportDataDigest"
    | "leagueContextEngine"
    | "genericChimmy"
    | "none"
  tokenPolicy: ChimmyTokenPolicy
  fallbackBehavior: "deterministic_answer" | "ask_for_context" | "safe_refusal" | "premium_ai"
}

const LIVE_DATA_RE =
  /\b(live|right now|currently|injur(?:y|ies|ed)|odds?|lineups?|prop|spread|over\s*\/?\s*under|minute|score\s+now|who\s+scored|red\s+card|yellow\s+card)\b/i
const WORLD_CUP_RE = /\b(world\s*cup|fifa|mundial|copa\s+mundial|soccer|f[uú]tbol|football tournament)\b/i
const WORLD_CUP_SCORING_RE = /\b(scoring|score|points?|rules?|tiebreak|tie-break|tie\s+breaker|how\s+.*win|bracket\s+rules?)\b/i
const WORLD_CUP_POOL_RE = /\b(pool|leaderboard|standings|rank|who'?s?\s+leading|commissioner|members?|participants?)\b/i
const BRACKET_RE = /\b(bracket|champion|finalist|knockout|group\s+stage|round\s+of\s+32|round\s+of\s+16|quarterfinal|semifinal|third\s+place)\b/i
const TRADE_RE = /\b(trade|deal|swap|counter|accept|decline|negotiate)\b/i
const DRAFT_RE = /\b(draft|pick|adp|rookie|queue|mock)\b/i
const NFL_RE = /\b(nfl|football|redraft|waiver|lineup|start|sit|roster)\b/i
const COMMISSIONER_RE = /\b(commissioner|commish|settings|custom\s+scoring|lock|approval|invite\s+control|export)\b/i

function route(
  category: ChimmyIntentCategory,
  dataSource: ChimmyIntentRoute["dataSource"],
  groundingService: ChimmyIntentRoute["groundingService"],
  tokenPolicy: ChimmyTokenPolicy,
  fallbackBehavior: ChimmyIntentRoute["fallbackBehavior"]
): ChimmyIntentRoute {
  return { category, dataSource, groundingService, tokenPolicy, fallbackBehavior }
}

export function resolveChimmyIntentRoute(message: string): ChimmyIntentRoute {
  const text = String(message ?? "").trim()
  if (!text) return route("dashboard_general", "user_context", "genericChimmy", "charge_after_success", "premium_ai")

  /*
   * ⚠ THE STRONG CLAIM NEEDS THE STRONG SIGNAL, WHICH IS WHY THESE ARE TWO
   * SEPARATE TESTS AND NOT ONE.
   *
   * A bracket word is enough to route a question to World Cup GROUNDING — that
   * is a soft default, no_charge, and harmless when wrong. It is NOT enough to
   * declare "we have no live provider for this sport", because that refusal
   * names a sport and blocks the turn.
   *
   * BRACKET_RE carries "champion", "bracket", "quarterfinal", "group stage" —
   * none of them soccer words. Measured 2026-09-11: "Any injuries on the Chiefs
   * playoff bracket?", "NFL playoff bracket injuries", "Who is the defending
   * champion and are there injuries?" and "Is my quarterfinal lineup locked?"
   * all landed on unsupported_live_data with tokenPolicy blocked_no_charge. That
   * suppressed the client's spend-confirm preflight
   * (app/components/ChimmyChat.tsx:427), and once lib/ai/deterministic.ts began
   * preferring this refusal over a cache miss it answered a Chiefs injury
   * question with World Cup copy.
   */
  const namesWorldCup = WORLD_CUP_RE.test(text)
  const isWorldCup = namesWorldCup || BRACKET_RE.test(text)
  if (namesWorldCup && LIVE_DATA_RE.test(text)) {
    return route("unsupported_live_data", "none", "worldCupChimmyGroundingService", "blocked_no_charge", "safe_refusal")
  }
  if (isWorldCup && WORLD_CUP_SCORING_RE.test(text)) {
    return route("world_cup_scoring", "world_cup_cache", "worldCupChimmyGroundingService", "no_charge", "deterministic_answer")
  }
  if (isWorldCup && WORLD_CUP_POOL_RE.test(text)) {
    return route("world_cup_pool", "world_cup_cache", "worldCupChimmyGroundingService", "no_charge", "ask_for_context")
  }
  if (isWorldCup) {
    return route("world_cup_bracket", "world_cup_cache", "worldCupChimmyGroundingService", "no_charge", "ask_for_context")
  }
  if (/\b(soccer|f[uú]tbol|football club|champions\s+league|mls|premier\s+league)\b/i.test(text)) {
    return route("soccer_general", "sports_cache", "chimmySportDataDigest", "charge_after_success", "premium_ai")
  }
  if (COMMISSIONER_RE.test(text)) {
    return route("commissioner", "league_context", "leagueContextEngine", "charge_after_success", "premium_ai")
  }
  if (TRADE_RE.test(text)) {
    return route("fantasy_trade", "league_context", "leagueContextEngine", "charge_after_success", "premium_ai")
  }
  if (DRAFT_RE.test(text)) {
    return route("fantasy_draft", "sports_cache", "chimmySportDataDigest", "charge_after_success", "premium_ai")
  }
  if (NFL_RE.test(text)) {
    return route("nfl_redraft", "sports_cache", "chimmySportDataDigest", "charge_after_success", "premium_ai")
  }
  return route("dashboard_general", "user_context", "genericChimmy", "charge_after_success", "premium_ai")
}

export function isNoChargeChimmyIntent(message: string): boolean {
  const policy = resolveChimmyIntentRoute(message).tokenPolicy
  return policy === "no_charge" || policy === "blocked_no_charge"
}

export function isWorldCupChimmyIntent(message: string): boolean {
  return resolveChimmyIntentRoute(message).category.startsWith("world_cup")
}
