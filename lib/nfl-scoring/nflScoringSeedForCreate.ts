/**
 * The NFL scoring a new league is seeded with, from the wizard's choices.
 *
 * Seeding is what the live scorer reads (`settings.nfl_scoring_config`, bridged to engine keys),
 * so this is where a scoring choice becomes points. Pure, so the exact store creation writes can
 * be fed straight into `buildLeagueStatScorer` in a test.
 */
import { receptionPointsForScoringPresetId } from '@/lib/league-creation-preset/scoring-presets'
import { buildFullNflScoringConfig, nflScoringPresetKeyForReceptionPoints, type NflScoringPresetKey } from './NflScoringPresets'

/** Wizard presets that stand for a site's own default league scoring → that site's NFL preset. */
const PLATFORM_PRESET_FOR_SCORING_ID: Readonly<Record<string, NflScoringPresetKey>> = {
  fb_espn_ppr: 'espn_ppr',
  fb_sleeper_ppr: 'sleeper_default',
}

/** The TE-premium amounts a commissioner can pick: extra points per tight-end catch. */
export const TE_PREMIUM_POINT_OPTIONS = [0.25, 0.5, 0.75, 1] as const

export function isValidTePremiumPoints(value: unknown): value is number {
  return typeof value === 'number' && (TE_PREMIUM_POINT_OPTIONS as readonly number[]).includes(value)
}

export type NflScoringSeed = {
  presetKey: NflScoringPresetKey
  rules: Record<string, number>
  /** Turns on the engine's TE_PREMIUM toggle — without it a `te_premium` rule is never scored. */
  enableTEPremium: boolean
}

export function nflScoringSeedForCreate(input: {
  scoringPresetId: string | null | undefined
  tePremiumPoints?: unknown
}): NflScoringSeed {
  const platform = input.scoringPresetId ? PLATFORM_PRESET_FOR_SCORING_ID[input.scoringPresetId] : undefined
  const presetKey = platform ?? nflScoringPresetKeyForReceptionPoints(receptionPointsForScoringPresetId(input.scoringPresetId))
  const rules = buildFullNflScoringConfig(presetKey)
  const tePremium = isValidTePremiumPoints(input.tePremiumPoints) ? input.tePremiumPoints : null
  if (tePremium !== null) rules.te_premium = tePremium
  return { presetKey, rules, enableTEPremium: tePremium !== null }
}
