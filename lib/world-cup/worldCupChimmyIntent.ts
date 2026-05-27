// Lightweight intent classifier for Chimmy AI chat — pure regex, no model call.

export type ChimmyIntent =
  | "live_score"
  | "live_stats"
  | "schedule"
  | "standings"
  | "bracket_strategy"
  | "group_strategy"
  | "third_place_strategy"
  | "scoring_rules"
  | "leaderboard_rank"
  | "general_chat"

// ── Pattern bank (evaluated in priority order) ────────────────────────────────

const PATTERNS: Array<{ intent: ChimmyIntent; re: RegExp }> = [
  // live_stats — detailed stats (xg, possession, shots, etc.)  ← check BEFORE live_score
  {
    intent: "live_stats",
    re: /\b(stats?|statistics?|possession|xg|expected goal|shots?|pass|corner|card|foul|assist|chance|attack|defend|performance)\b/i,
  },

  // live_score — plain score/result questions
  {
    intent: "live_score",
    re: /\b(score|result|winning|losing|winning by|losing by|goal|goals?|what.{0,20}(happening|going on)|live|halftime|half.?time|who.{0,20}winning|who.{0,20}leading|current score|latest score)\b/i,
  },

  // schedule — upcoming fixtures / kick-off times
  {
    intent: "schedule",
    re: /\b(when|schedule|fixture|kick.?off|play today|play tomorrow|tomorrow|next game|next match|upcoming|tip.?off|playtime|what.{0,15}time|who plays today|who plays tomorrow)\b/i,
  },

  // standings — group table / points table
  {
    intent: "standings",
    re: /\b(standings?|table|group table|points table|group stage|qualif(y|ied)|advances? from|eliminated|top (of|the) group)\b/i,
  },

  // leaderboard_rank — pool rank / score / how am I doing
  // Note: avoid matching bare "rank" since "rank first in Group A" is group_strategy.
  // Require "my rank", "pool rank", or a longer phrase.
  {
    intent: "leaderboard_rank",
    re: /\b(leaderboard|my rank\b|pool rank\b|how (am|am i|i am) doing|my (score|points|total|position)\b|pool (score|total|points)|where (am|do) i (stand|rank|sit)|ahead of|behind in (the |)pool|catch up|points? (away|behind|ahead))\b/i,
  },

  // scoring_rules — how points work
  {
    intent: "scoring_rules",
    re: /\b(how (many|much) point|points? (for|per|worth|do|if)|scoring (rule|system|work)|point (system|breakdown|value|worth)|how (do|does) (point|scoring) work|champion bonus|bonus point)\b/i,
  },

  // third_place_strategy — third-place match specific
  {
    intent: "third_place_strategy",
    re: /\b(third.?place|3rd.?place|bronze|consolation (match|game)|third place (match|pick|game))\b/i,
  },

  // group_strategy — group-stage ranking picks
  {
    intent: "group_strategy",
    re: /\b(group (rank|pick|prediction|stage)|rank(ing)? (team|group|pick)|who (should|to) (put|pick|rank|place) (first|second|third|fourth|last|1st|2nd|3rd|4th)|group (a|b|c|d|e|f|g|h)\b|predicted (order|ranking))\b/i,
  },

  // bracket_strategy — knockout/bracket picks
  {
    intent: "bracket_strategy",
    re: /\b(bracket|knockout|pick|round of (16|32|8)|quarter.?final|semi.?final|final|champion|who (will|should|to) win|dark horse|upset|advance|who do i (pick|choose)|my pick|strategy|risky|safe pick|hedge)\b/i,
  },
]

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify a user prompt into a Chimmy intent.
 * Falls back to "general_chat" when no pattern matches.
 */
export function detectChimmyIntent(prompt: string): ChimmyIntent {
  const text = prompt.trim()
  for (const { intent, re } of PATTERNS) {
    if (re.test(text)) return intent
  }
  return "general_chat"
}

/**
 * Returns true for intents where live match data is the primary answer source.
 * If live data is absent, Chimmy should short-circuit with a no-data message.
 */
export function isLiveDataIntent(intent: ChimmyIntent): boolean {
  return intent === "live_score" || intent === "live_stats"
}

/**
 * Returns true for intents where schedule data is the primary answer source.
 */
export function isScheduleIntent(intent: ChimmyIntent): boolean {
  return intent === "schedule"
}
