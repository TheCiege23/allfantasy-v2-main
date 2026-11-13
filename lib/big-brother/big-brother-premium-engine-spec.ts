/**
 * Big Brother premium engine — twists, competition types, optional America’s vote.
 * Persisted on `BigBrotherLeagueConfig.premiumEngineSpec`.
 */

export type BigBrotherTwistKey =
  | 'double_eviction'
  | 'triple_eviction'
  | 'battle_back'
  | 'secret_hoh'
  | 'americas_vote'
  | 'hidden_powers'
  | 'safety_pass'

type BigBrotherCompetitionKind = 'fantasy_scoring' | 'mini_game' | 'trivia' | 'random_event'

type BigBrotherPremiumEngineSpec = {
  version: 2
  twists: {
    enabledKeys: BigBrotherTwistKey[]
    /** Weeks when a twist fires (commissioner / automation). */
    scheduledTwistWeeks: number[]
  }
  competitions: {
    hohKinds: BigBrotherCompetitionKind[]
    vetoKinds: BigBrotherCompetitionKind[]
  }
  chimmy: {
    autoPostHohResults: boolean
    autoPostVetoResults: boolean
    autoTallyEviction: boolean
  }
  aiSurfaces: {
    allianceDetection: boolean
    threatLevel: boolean
    votePrediction: boolean
    betrayalAlerts: boolean
    powerMap: boolean
  }
}

export const DEFAULT_BIG_BROTHER_PREMIUM_ENGINE_SPEC: BigBrotherPremiumEngineSpec = {
  version: 2,
  twists: {
    enabledKeys: ['double_eviction', 'battle_back', 'secret_hoh', 'hidden_powers', 'safety_pass'],
    scheduledTwistWeeks: [],
  },
  competitions: {
    hohKinds: ['fantasy_scoring', 'mini_game', 'trivia', 'random_event'],
    vetoKinds: ['fantasy_scoring', 'mini_game', 'trivia'],
  },
  chimmy: {
    autoPostHohResults: true,
    autoPostVetoResults: true,
    autoTallyEviction: true,
  },
  aiSurfaces: {
    allianceDetection: true,
    threatLevel: true,
    votePrediction: true,
    betrayalAlerts: true,
    powerMap: true,
  },
}

export function parseBigBrotherPremiumEngineSpec(raw: unknown): BigBrotherPremiumEngineSpec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_BIG_BROTHER_PREMIUM_ENGINE_SPEC
  const o = raw as Partial<BigBrotherPremiumEngineSpec>
  if (o.version !== 2) return DEFAULT_BIG_BROTHER_PREMIUM_ENGINE_SPEC
  return {
    ...DEFAULT_BIG_BROTHER_PREMIUM_ENGINE_SPEC,
    ...o,
    twists: { ...DEFAULT_BIG_BROTHER_PREMIUM_ENGINE_SPEC.twists, ...(o.twists ?? {}) },
    competitions: { ...DEFAULT_BIG_BROTHER_PREMIUM_ENGINE_SPEC.competitions, ...(o.competitions ?? {}) },
    chimmy: { ...DEFAULT_BIG_BROTHER_PREMIUM_ENGINE_SPEC.chimmy, ...(o.chimmy ?? {}) },
    aiSurfaces: { ...DEFAULT_BIG_BROTHER_PREMIUM_ENGINE_SPEC.aiSurfaces, ...(o.aiSurfaces ?? {}) },
  }
}
