/**
 * Resolves full waiver config for a league (processing + FAAB + sport/variant).
 * Used by app waiver/config API and WaiverSettingsPanel.
 */
import { getWaiverProcessingConfigForLeague } from './WaiverProcessingConfigResolver'
import { getFAABConfigForLeague } from './FAABConfigResolver'
/*
 * ⚠ THE LEAF, NOT THE `@/lib/waiver-wire` BARREL, AND THIS IMPORT IS LOAD-BEARING
 * FOR THE WHOLE `league-runtime` GRAPH. The barrel re-exports `claim-service`,
 * which reaches `ai-learning-system/recordEvent.ts` and its `import 'server-only'`.
 * Because this resolver sits under `league-runtime/canonicalLeagueRules`, importing
 * the barrel here for ONE function dragged that server tail into every consumer of
 * league-runtime -- including, on 2026-09-07, a `'use client'` component, which
 * failed `next build` and held main red for ~80 minutes across six deploys.
 *
 * A barrel is a server module if ANY of its re-exports is. Import the leaf.
 */
import { getEffectiveLeagueWaiverSettings } from '@/lib/waiver-wire/settings-service'

export interface WaiverConfigForLeague {
  waiver_type: string
  processing_days: number[]
  processing_time_utc: string | null
  claim_limit_per_period: number | null
  claim_priority_behavior: string | null
  game_lock_behavior: string | null
  drop_lock_behavior: string | null
  same_day_add_drop_rules: string | null
  free_agent_unlock_behavior: string
  continuous_waivers: boolean
  max_claims_per_period: number | null
  faab_enabled: boolean
  faab_budget: number | null
  faab_reset_rules: string | null
  sport: string
  variant: string | null
  tiebreak_rule: string | null
  instant_fa_after_clear: boolean
}

export async function getWaiverConfigForLeague(leagueId: string): Promise<WaiverConfigForLeague | null> {
  const [processing, faab, effective] = await Promise.all([
    getWaiverProcessingConfigForLeague(leagueId),
    getFAABConfigForLeague(leagueId),
    getEffectiveLeagueWaiverSettings(leagueId),
  ])
  if (!processing) return null
  return {
    waiver_type: processing.waiver_type,
    processing_days: processing.processing_days ?? [],
    processing_time_utc: processing.processing_time_utc,
    claim_limit_per_period: processing.claim_limit_per_period,
    claim_priority_behavior: processing.claim_priority_behavior,
    game_lock_behavior: processing.game_lock_behavior,
    drop_lock_behavior: processing.drop_lock_behavior,
    same_day_add_drop_rules: processing.same_day_add_drop_rules,
    free_agent_unlock_behavior: processing.free_agent_unlock_behavior,
    continuous_waivers: processing.continuous_waivers,
    max_claims_per_period: processing.max_claims_per_period,
    faab_enabled: faab?.faab_enabled ?? false,
    faab_budget: faab?.faab_budget ?? null,
    faab_reset_rules: faab?.faab_reset_rules ?? null,
    sport: processing.sport,
    variant: processing.variant,
    tiebreak_rule: effective?.tiebreakRule ?? null,
    instant_fa_after_clear: effective?.instantFaAfterClear ?? processing.free_agent_unlock_behavior === 'instant',
  }
}
