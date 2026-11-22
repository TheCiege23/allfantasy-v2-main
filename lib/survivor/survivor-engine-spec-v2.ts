/**
 * Survivor league “type” enhancements — engine config + feature modules.
 * Persisted on `SurvivorLeagueConfig.engineSpecV2` (JSON). Safe defaults when null.
 */

/** Confessionals: text always; audio/video when clients + storage support it. */
type SurvivorConfessionalMedia = 'text' | 'audio' | 'video'

/** Hidden idol clue chain — sequential reveals toward an idol or advantage. */
type SurvivorIdolClueChainMode = 'linear' | 'branching' | 'merge'

/** Advantage / idol inventory expiration semantics. */
type SurvivorAdvantageExpirationRule =
  | 'at_merge'
  | 'at_fixed_week'
  | 'after_n_tribals'
  | 'none'

/** Tribe swap / merge engine beyond baseline merge week. */
type SurvivorTribeSwapEngineMode = 'manual_only' | 'scheduled_swap' | 'auto_rebalance' | 'auction_draft_order'

type SurvivorMergeStyle = 'standard' | 'absorb' | 'shuffle_into_two' | 'draft_order_pick'

/** Jury + final tribal enhancements. */
type SurvivorJuryChamberMode = 'standard' | 'enhanced_reveal' | 'live_ftc_questions' | 'sealed_finale'

/** Story / recap cadence. */
type SurvivorStoryModeCadence = 'off' | 'weekly' | 'per_tribal' | 'per_episode'

/** Exile / redemption style variants (multiple can be enabled; engine picks active by week rules). */
type SurvivorExileVariantKey =
  | 'classic_exile_island'
  | 'redemption_arena'
  | 'edge_of_extinction_style'
  | 'dual_exile'
  | 'token_buyback'
  | 'challenge_re_entry'

/** Activity + social health tooling. */
type SurvivorActivityPolicy = 'none' | 'nudge_only' | 'strike_system' | 'commissioner_review'

/** Host / co-host control surface. */
type SurvivorHostToolKey =
  | 'ceremony_script'
  | 'vote_clock'
  | 'advantage_reveal_order'
  | 'challenge_run_of_show'
  | 'co_host_approvals'
  | 'broadcast_pins'

/** Season rule presets — commissioner picks one as a starting template. */
type SurvivorSeasonRulePresetId =
  | 'classic_20_2_tribes'
  | 'three_tribe_open'
  | 'day_zero_twist_light'
  | 'heavy_idol_season'
  | 'challenge_heavy_minigames'
  | 'social_first_low_twist'
  | 'custom_commissioner'

/** Expanded mini-game / challenge pool keys (sport-agnostic labels; scoring binds to League.sport). */
const SURVIVOR_MINIGAME_POOL_KEYS = [
  'point_spread_pick',
  'pick_game_winner',
  'pick_a_lineup',
  'game_total_over_under',
  'player_prop_over_under',
  'first_td_scorer',
  'anytime_td_scorer',
  'exact_score',
  'closest_total_points',
  'top_scoring_positions',
  'dfs_salary_cap',
  'dfs_showdown',
  'confidence_pool',
  'parlay_challenge',
  'pick_em_sheet',
  'survivor_trivia',
  'elimination_bracket_light',
] as const

type SurvivorMinigamePoolKey = (typeof SURVIVOR_MINIGAME_POOL_KEYS)[number]

type SurvivorMinigameRandomizer = 'uniform' | 'weighted_by_sport' | 'commissioner_curated'

export type SurvivorEngineSpecV2 = {
  version: 2
  modules: {
    confessionals: {
      enabled: boolean
      mediaTypes: SurvivorConfessionalMedia[]
      moderation: 'host_review' | 'post_only' | 'league_chat_crosspost'
    }
    idolClueChain: {
      enabled: boolean
      mode: SurvivorIdolClueChainMode
      maxCluesPerIdol: number
    }
    advantageInventory: {
      enabled: boolean
      expirationRules: SurvivorAdvantageExpirationRule
      showTimersToHolder: boolean
    }
    tribeSwapMerge: {
      engineMode: SurvivorTribeSwapEngineMode
      mergeStyle: SurvivorMergeStyle
      swapCountCap: number | null
    }
    juryChamber: {
      mode: SurvivorJuryChamberMode
      enhancedFinalTribal: boolean
    }
    storyMode: {
      enabled: boolean
      cadence: SurvivorStoryModeCadence
    }
    threatRankings: {
      enabled: boolean
      visibleToPlayers: boolean
    }
    minigamePool: {
      enabled: boolean
      poolKeys: SurvivorMinigamePoolKey[]
      randomizer: SurvivorMinigameRandomizer
    }
    exileVariants: {
      enabledKeys: SurvivorExileVariantKey[]
    }
    activityEnforcement: {
      policy: SurvivorActivityPolicy
      socialHealthSignals: boolean
    }
    rulePresets: {
      activePresetId: SurvivorSeasonRulePresetId | null
    }
    hostTools: {
      enabledKeys: SurvivorHostToolKey[]
      coHostRoles: boolean
    }
  }
}

export const DEFAULT_SURVIVOR_ENGINE_SPEC_V2: SurvivorEngineSpecV2 = {
  version: 2,
  modules: {
    confessionals: {
      enabled: true,
      mediaTypes: ['text', 'audio', 'video'],
      moderation: 'host_review',
    },
    idolClueChain: {
      enabled: true,
      mode: 'linear',
      maxCluesPerIdol: 4,
    },
    advantageInventory: {
      enabled: true,
      expirationRules: 'at_merge',
      showTimersToHolder: true,
    },
    tribeSwapMerge: {
      engineMode: 'scheduled_swap',
      mergeStyle: 'standard',
      swapCountCap: null,
    },
    juryChamber: {
      mode: 'enhanced_reveal',
      enhancedFinalTribal: true,
    },
    storyMode: {
      enabled: true,
      cadence: 'weekly',
    },
    threatRankings: {
      enabled: true,
      visibleToPlayers: true,
    },
    minigamePool: {
      enabled: true,
      poolKeys: [...SURVIVOR_MINIGAME_POOL_KEYS],
      randomizer: 'weighted_by_sport',
    },
    exileVariants: {
      enabledKeys: ['classic_exile_island', 'redemption_arena'],
    },
    activityEnforcement: {
      policy: 'nudge_only',
      socialHealthSignals: true,
    },
    rulePresets: {
      activePresetId: 'classic_20_2_tribes',
    },
    hostTools: {
      enabledKeys: ['ceremony_script', 'vote_clock', 'advantage_reveal_order', 'co_host_approvals'],
      coHostRoles: true,
    },
  },
}

function mergeModules(
  base: SurvivorEngineSpecV2['modules'],
  patch: Partial<SurvivorEngineSpecV2['modules']> | undefined,
): SurvivorEngineSpecV2['modules'] {
  if (!patch) return base
  const out: SurvivorEngineSpecV2['modules'] = { ...base }
  const keys = Object.keys(base) as Array<keyof SurvivorEngineSpecV2['modules']>
  for (const k of keys) {
    const p = patch[k]
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      // Each module key is a distinct object shape; shallow merge is intentional. Indexed assign hits `never`
      // if union members are intersected — assign through a loose index.
      ;(out as Record<keyof SurvivorEngineSpecV2['modules'], object>)[k] = {
        ...(base[k] as object),
        ...(p as object),
      }
    }
  }
  return out
}

export function parseSurvivorEngineSpecV2(raw: unknown): SurvivorEngineSpecV2 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SURVIVOR_ENGINE_SPEC_V2
  const o = raw as Partial<SurvivorEngineSpecV2>
  if (o.version !== 2) return DEFAULT_SURVIVOR_ENGINE_SPEC_V2
  return {
    version: 2,
    modules: mergeModules(DEFAULT_SURVIVOR_ENGINE_SPEC_V2.modules, o.modules),
  }
}
