/**
 * Survivor mini-game type registry: challenge types and reward application (PROMPT 346). Deterministic.
 */

import type { SurvivorChallengeType } from './types'
import type { SurvivorRewardType } from './survivorRewardModel'

export const MINIGAME_TYPES: SurvivorChallengeType[] = [
  'score_prediction',
  'over_under',
  'player_prop',
  'tribe_vs',
  'immunity_auction',
  'puzzle',
  'trivia',
  'point_boost',
  'individual_safety',
]

export interface MinigameTypeDef {
  id: SurvivorChallengeType
  label: string
  /**
   * Reward types this game can output. The first six are the original effect-engine rewards; the
   * `SurvivorRewardType`s (score_penalty, faab_transfer, tribemate_points, free_trade_token,
   * steal_blocker, steal, …) are paid through `applySurvivorReward` (SurvivorEffectEngine.ts).
   */
  rewardTypes: ('immunity' | 'tribe_immunity' | 'score_boost' | 'faab' | 'advantage' | 'voting_safety' | SurvivorRewardType)[]
  /** Submission schema hint: roster-only, tribe-only, or both. */
  submissionScope: 'roster' | 'tribe' | 'both'
}

export const MINIGAME_REGISTRY: Record<SurvivorChallengeType, MinigameTypeDef> = {
  score_prediction: {
    id: 'score_prediction',
    label: 'Score prediction',
    rewardTypes: ['score_boost', 'immunity', 'faab'],
    submissionScope: 'roster',
  },
  over_under: {
    id: 'over_under',
    label: 'Over/under',
    rewardTypes: ['score_boost', 'immunity', 'faab'],
    submissionScope: 'roster',
  },
  player_prop: {
    id: 'player_prop',
    label: 'Player prop',
    rewardTypes: ['score_boost', 'faab'],
    submissionScope: 'roster',
  },
  tribe_vs: {
    id: 'tribe_vs',
    label: 'Tribe vs tribe',
    rewardTypes: ['tribe_immunity', 'score_boost'],
    submissionScope: 'tribe',
  },
  immunity_auction: {
    id: 'immunity_auction',
    label: 'Immunity auction',
    rewardTypes: ['immunity', 'advantage'],
    submissionScope: 'roster',
  },
  puzzle: {
    id: 'puzzle',
    label: 'Puzzle / clue',
    rewardTypes: ['advantage', 'immunity', 'voting_safety'],
    submissionScope: 'both',
  },
  trivia: {
    id: 'trivia',
    label: 'Trivia',
    rewardTypes: ['faab', 'score_boost'],
    submissionScope: 'roster',
  },
  point_boost: {
    id: 'point_boost',
    label: 'Point boost game',
    rewardTypes: ['score_boost'],
    submissionScope: 'roster',
  },
  individual_safety: {
    id: 'individual_safety',
    label: 'Individual safety',
    rewardTypes: ['voting_safety', 'immunity'],
    submissionScope: 'roster',
  },
}

export function getMinigameDef(type: SurvivorChallengeType): MinigameTypeDef | null {
  return MINIGAME_REGISTRY[type] ?? null
}
