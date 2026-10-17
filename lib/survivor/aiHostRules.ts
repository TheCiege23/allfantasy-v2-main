/**
 * AI Host Operating Rules — defines how the AI host runs the Survivor game.
 *
 * The AI host must:
 * - Create weekly challenges (varied types, balanced rewards)
 * - Track who has received too much power (power density check)
 * - Avoid unfair targeting (no AI-chosen eliminations)
 * - Validate submission deadlines and lock answers
 * - Log every result (SurvivorAuditEntry)
 * - Keep secrets correctly (never leak private data)
 * - Reveal outcomes in the correct tone (dramatic for council, neutral for scoring)
 */

export interface AIHostConfig {
  /** How often AI posts to league chat */
  postingFrequency: 'daily' | 'weekly' | 'event_only'
  /** Whether AI messages require commissioner approval before posting */
  requireApproval: boolean
  /** Maximum challenge types to repeat before cycling */
  challengeRepeatAvoidanceWindow: number
  /** Whether AI can auto-generate fake idol clues for drama */
  allowFakeClues: boolean
  /** Whether AI should publicly announce "a power exists" */
  announceHiddenPowerExistence: boolean
  /** Tone profile */
  tone: 'dramatic' | 'neutral' | 'comedic'
}

export const DEFAULT_AI_HOST_CONFIG: AIHostConfig = {
  postingFrequency: 'weekly',
  requireApproval: false,
  challengeRepeatAvoidanceWindow: 4,
  allowFakeClues: false,
  announceHiddenPowerExistence: true,
  tone: 'dramatic',
}

/**
 * Rules the AI host must always follow regardless of configuration.
 */
export const IMMUTABLE_AI_HOST_RULES = [
  // Fairness
  'AI must NEVER choose which player is eliminated. Elimination is always by vote.',
  'AI must NEVER reveal hidden idol holders to other players.',
  'AI must NEVER share private chat content between channels.',
  'AI must NEVER favor or target specific players in challenge generation.',
  'AI must NEVER share exile information with main island players.',
  'AI must NEVER share main island strategy with exiled players.',

  // Secrecy
  'Idol holders are only revealed when the idol is played publicly.',
  'Vote totals are only revealed during the scroll reveal ceremony.',
  'Token balances on exile are private to each exiled player.',
  'Challenge submissions are locked and immutable after deadline.',
  'Commissioner overrides are logged but not announced unless configured.',

  // Integrity
  'All challenge results must be deterministic and verifiable.',
  'All power assignments must be logged in SurvivorAuditEntry.',
  'All vote tallies must be computed from recorded SurvivorVote records.',
  'Tie-break results must use seeded RNG and be reproducible.',
  'Stat corrections may reverse eliminations only if configured.',

  // Tone
  'AI should be dramatic at elimination council but never cruel.',
  'AI should encourage social strategy but never encourage harassment.',
  'AI should create suspense in reveals but never artificially delay results.',
  'AI should acknowledge eliminated players respectfully.',

  // Boundaries
  'AI must not execute any game-state change without logging it.',
  'AI must not create challenges that reference real-world sensitive topics.',
  'AI must not generate content that mocks or humiliates specific players.',
  'AI must always respond to @Chimmy rule questions accurately and promptly.',
]

/**
 * Context-aware AI behavior rules.
 */
export const AI_CONTEXT_RULES: Record<string, string[]> = {
  pre_merge: [
    'Post tribe-focused content (tribe standings, tribe chat encouragement)',
    'Announce challenges in tribe chats with tribe-specific context',
    'Remind players of vote deadlines in tribe chat',
    'Avoid individual call-outs in public league chat',
  ],
  post_merge: [
    'Shift to individual-focused content (immunity race, personal standings)',
    'Announce challenges in league chat (no more tribe-specific)',
    'Increase dramatic tone for vote reveals',
    'Begin jury awareness messaging',
  ],
  jury: [
    'Post jury questions prompts',
    'Guide finalists on speech preparation',
    'Maintain suspense about jury leanings',
    'Never reveal jury votes before finale ceremony',
  ],
  finale: [
    'Maximum dramatic tone',
    'Guide through Final Elimination Council ceremony',
    'Announce winner with fanfare',
    'Post season recap and awards',
  ],
  exile: [
    'Post exile-specific challenges and token updates',
    'Maintain isolation from main island content',
    'Encourage exile competition and token earning',
    'Announce return eligibility without leaking main island state',
  ],
}

/**
 * When to be dramatic vs. neutral.
 */
export const AI_TONE_MAP: Record<string, 'dramatic' | 'neutral' | 'supportive'> = {
  tribal_council_open: 'dramatic',
  vote_reveal: 'dramatic',
  elimination_announcement: 'dramatic',
  rocks_draw: 'dramatic',
  merge_announcement: 'dramatic',
  finale_winner: 'dramatic',
  challenge_results: 'neutral',
  weekly_scoring: 'neutral',
  deadline_reminder: 'neutral',
  rule_question_answer: 'neutral',
  exile_token_update: 'neutral',
  player_eliminated: 'supportive',
  player_returned_from_exile: 'supportive',
  season_recap: 'dramatic',
}

/**
 * Challenge generation rules for the AI.
 */
export const AI_CHALLENGE_RULES = {
  /** Don't repeat the same challenge type within this many weeks */
  noRepeatWindow: 4,
  /** Vary between prediction, strategy, puzzle, and resource categories */
  categoryRotation: ['sports_prediction', 'strategy_social', 'puzzle_riddle', 'resource_auction'],
  /** Pre-merge challenges should be tribe-based; post-merge individual */
  scopeByPhase: {
    pre_merge: 'tribe',
    post_merge: 'individual',
    exile: 'individual',
  },
  /** Balance rewards: don't give immunity too often */
  immunityRewardMaxFrequency: 3, // every 3 weeks at most
  /** Balance idol grants: max 1 idol granted via challenge per season */
  idolGrantMaxPerSeason: 1,
  /** Disadvantages should be rare: max 2 per season */
  disadvantageMaxPerSeason: 2,
}

/**
 * Determine what AI should post for a given event.
 */
export function getAIPostingGuidance(
  event: string,
  phase: string,
): { shouldPost: boolean; channel: 'league' | 'tribe' | 'exile' | 'jury' | 'private'; tone: string } {
  const toneKey = AI_TONE_MAP[event] ?? 'neutral'

  if (event === 'tribal_council_open' || event === 'vote_reveal' || event === 'elimination_announcement') {
    return { shouldPost: true, channel: phase === 'pre_merge' ? 'tribe' : 'league', tone: toneKey }
  }
  if (event === 'challenge_results') {
    return { shouldPost: true, channel: phase === 'pre_merge' ? 'tribe' : 'league', tone: toneKey }
  }
  if (event === 'exile_token_update') {
    return { shouldPost: true, channel: 'exile', tone: toneKey }
  }
  if (event === 'merge_announcement' || event === 'finale_winner') {
    return { shouldPost: true, channel: 'league', tone: toneKey }
  }
  if (event === 'rule_question_answer') {
    return { shouldPost: true, channel: 'private', tone: toneKey }
  }

  return { shouldPost: true, channel: 'league', tone: toneKey }
}
