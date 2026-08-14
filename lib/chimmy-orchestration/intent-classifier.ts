import type { ChimmyOrchestrationIntent } from './types'

export type ChimmyIntentClassification = {
  intent: ChimmyOrchestrationIntent
  label: string
  confidence: number
}

const LABELS: Record<ChimmyOrchestrationIntent, string> = {
  trade: 'Trade analysis',
  waiver: 'Waiver / adds',
  start_sit: 'Start / sit decision',
  player_value: 'Player value / outlook',
  draft: 'Draft strategy',
  matchup: 'Matchup outlook',
  league_strength: 'League strength / standings',
  // These four belong to ChimmyOrchestrationIntent and were missing from this
  // record, so it failed to typecheck — a red that had been sitting on main.
  commissioner: 'Commissioner / league administration',
  bracket: 'Bracket / tournament',
  injury: 'Injury status',
  weather: 'Weather impact',
  manager_psychology: 'Manager behavior / psychology',
  story_recap: 'Story / recap / narrative',
  general: 'General fantasy help',
}

/**
 * Lightweight deterministic intent router for Chimmy orchestration.
 * Order: most specific patterns first.
 */
export function classifyChimmyIntent(
  message: string,
  recentUserSnippet?: string
): ChimmyIntentClassification {
  const text = `${recentUserSnippet ?? ''}\n${message}`.toLowerCase()

  const score = (intent: ChimmyOrchestrationIntent, weight: number): ChimmyIntentClassification => ({
    intent,
    label: LABELS[intent],
    confidence: Math.min(0.97, 0.55 + weight * 0.12),
  })

  if (
    /\b(recap|storyline|narrative|tell the story|week\s*\d+\s*recap|hall of fame|social clip|caption)\b/.test(text)
  ) {
    return score('story_recap', 3)
  }
  if (
    // Stems carry \w* because the closing \b otherwise makes them unmatchable:
    // `\bpsycholog\b` cannot match "psychology" (g and y are both word chars, so
    // there is no boundary between them). That was true of the original pattern,
    // which means this intent never fired for the single most obvious word
    // someone would use for it — and it failed silently, as a plausible general
    // answer rather than an error.
    /\b(psycholog\w*|tilt|toxic|collusion|bad\s*manager|behavio\w*|trash\s*talk|mind\s*game\w*|manager\s*profil\w*|tendenc\w*)\b/.test(
      text
    ) ||
    // Questions about a PERSON rather than an asset: "how does Stavros draft",
    // "what kind of trader is he". Without these they fell through to the
    // generic draft/trade branches, which answer about players instead of about
    // the manager being asked about.
    /\bhow\s+does\s+\w+\s+(draft|trade)\b/.test(text) ||
    /\bwhat\s+kind\s+of\s+(manager|drafter|trader)\b/.test(text)
  ) {
    return score('manager_psychology', 3)
  }
  if (
    /\b(weakest\s*team|strongest\s*team|league\s*strength|who\s*to\s*fear|power\s*rank|standings\s*overview|playoff\s*picture)\b/.test(
      text
    )
  ) {
    return score('league_strength', 2.5)
  }
  if (
    /\b(matchup|oppone|spread|vegas|game\s*total|pace|implied|who\s*do\s*i\s*play\s*against)\b/.test(text) &&
    !/\bstart\b.*\bor\b.*\b(sit|bench)\b/.test(text)
  ) {
    return score('matchup', 2.5)
  }
  if (/\b(mock\s*draft|draft\s*pick|rookie\s*class|adp|sleeper\s*pick|draft\s*strategy|when\s*to\s*draft)\b/.test(text)) {
    return score('draft', 3)
  }
  if (
    /\b(start|sit|flex|superflex|who\s*do\s*i\s*start|bench|lineup|line\s*up|this\s*week)\b/.test(text) &&
    /\b(or|vs\.?|versus|between|pick\s*(one|between))\b/.test(text)
  ) {
    return score('start_sit', 3.5)
  }
  if (/\b(start|sit|flex|superflex|lineup|bench\s*him|start\s*him)\b/.test(text)) {
    return score('start_sit', 2)
  }
  if (/\b(waiver|wire|faab|free\s*agent|pick\s*up|add|drop|stream)\b/.test(text)) {
    return score('waiver', 3)
  }
  if (/\b(trade|offer|counter|accept|decline|deal|swap|send|receive)\b/.test(text)) {
    return score('trade', 3)
  }
  if (
    /\b(value|worth|ros|rest\s*of\s*season|outlook|sell\s*high|buy\s*low|tier|rank\s*him)\b/.test(text)
  ) {
    return score('player_value', 2.5)
  }

  return {
    intent: 'general',
    label: LABELS.general,
    confidence: 0.62,
  }
}
