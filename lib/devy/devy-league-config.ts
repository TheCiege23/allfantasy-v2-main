/**
 * Devy league configuration — single JSON shape stored on `League.settings.devy_league_config`.
 * UI binds here; backend services merge with roster/draft engines over time.
 */

import type { LeagueSport } from '@prisma/client'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

/** Sports where Devy is a first-class long-term format in production (no MLB/NHL Devy). */
export const DEVY_SUPPORTED_SPORTS = ['NFL', 'NCAAF', 'NBA', 'NCAAB'] as const
export type DevySupportedSport = (typeof DEVY_SUPPORTED_SPORTS)[number]

export function supportsDevyLeagueFormat(sport: LeagueSport | string): sport is DevySupportedSport {
  const s = normalizeToSupportedSport(sport) as DevySupportedSport
  return (DEVY_SUPPORTED_SPORTS as readonly string[]).includes(s)
}

export type DevyModeId =
  | 'standard_devy'
  | 'campus_to_canton'
  | 'expanded_pipeline'
  | 'future_placeholder'

export type DevyFeederSourceId =
  | 'ncaaf_for_nfl'
  | 'ncaab_for_nba'
  | 'custom_prospect_pool'

export type DevyPromotionModelId =
  | 'manual_commissioner'
  | 'auto_pro_eligible'
  | 'commissioner_rules_gated'

export type DevyRookieDevyDraftStructureId = 'separate_rookie' | 'separate_devy' | 'combined'

/** Annual rookie/devy draft order styles — includes weighted lottery (not allowed for startup). */
export type DevyAnnualDraftOrderStyleId =
  | 'linear'
  | 'snake'
  | 'auction'
  | 'weighted_lottery'

export type DevyProspectEligibilityModelId =
  | 'class_year'
  | 'age_declaration'
  | 'manual_curated_pool'
  | 'hybrid'

export type DevyDraftPacingId = 'live_timer' | 'relaxed_timer' | 'commissioner_paused'

export interface DevyLeagueConfigV1 {
  version: 1
  devyMode: DevyModeId
  /** Feature flags for modes not yet globally enabled */
  featureFlags?: {
    campusToCanton?: boolean
    expandedPipeline?: boolean
  }
  feederSource: DevyFeederSourceId
  /** How many devy rounds occur each league year (annual devy draft). */
  devyRoundsPerSeason: number
  /** Devy + taxi are always part of default Devy format; counts are editable in settings. */
  rosterSlots: {
    devy: number
    taxi: number
    bench: number
    ir: number
  }
  futurePickTradingEnabled: boolean
  /**
   * Market units per one devy point, for grading a trade that spans college and NFL assets.
   *
   * 🛑 OPTIONAL, AND ABSENT MEANS REFUSE. Nothing prices college players, so a mixed-scale
   * trade is reported ungradeable unless the commissioner states a conversion himself. See
   * lib/devy/devyMarketBridge.ts — the number is a house rule, never a measurement.
   */
  devyMarketUnitsPerDevyPoint?: number | null
  promotionModel: DevyPromotionModelId
  rookieDevyDraftStructure: DevyRookieDevyDraftStructureId
  /** Order style for combined or separate annual rookie/devy drafts (not startup). */
  annualRookieDevyOrderStyle: DevyAnnualDraftOrderStyleId
  /** Startup draft uses `draft_type` on league; never weighted lottery at create. */
  startupWeightedLotteryAllowed: false
  prospectEligibility: {
    model: DevyProspectEligibilityModelId
    includeFreshmen: boolean
    includeSophomores: boolean
    includeJuniors: boolean
    includeSeniors: boolean
    declaredOnly: boolean
  }
  poolControls: {
    lockAtSeasonStart: boolean
    dynamicUpdates: boolean
    manualCommissionerEdits: boolean
  }
  draftPacing: DevyDraftPacingId
  /** Seconds per pick for live/relaxed pacing (drives auto slow vs fast feel — not a separate “slow draft” type). */
  draftTimerSeconds: number
  chimmy: {
    devyPlaybookEnabled: boolean
    surfaceFuturePicks: boolean
    surfacePromotionHints: boolean
  }
  /** Placeholder blocks for merged Devy + advanced pipeline leagues */
  mergedPipeline?: {
    enabled: boolean
  }
}

export type DevyLeagueSetupState = DevyLeagueConfigV1

export function getDefaultFeederForSport(sport: LeagueSport | string): DevyFeederSourceId {
  const s = normalizeToSupportedSport(sport)
  if (s === 'NBA' || s === 'NCAAB') return 'ncaab_for_nba'
  return 'ncaaf_for_nfl'
}

export function defaultDevyLeagueSetup(sport: LeagueSport | string): DevyLeagueSetupState {
  const s = normalizeToSupportedSport(sport)
  const isBb = s === 'NBA' || s === 'NCAAB'
  return {
    version: 1,
    devyMode: 'standard_devy',
    featureFlags: {
      campusToCanton: false,
      expandedPipeline: false,
    },
    feederSource: getDefaultFeederForSport(s),
    devyRoundsPerSeason: isBb ? 4 : 5,
    rosterSlots: {
      devy: isBb ? 4 : 5,
      taxi: isBb ? 4 : 5,
      bench: isBb ? 10 : 12,
      ir: 2,
    },
    futurePickTradingEnabled: true,
    promotionModel: 'commissioner_rules_gated',
    rookieDevyDraftStructure: 'separate_devy',
    annualRookieDevyOrderStyle: 'snake',
    startupWeightedLotteryAllowed: false,
    prospectEligibility: {
      model: 'class_year',
      includeFreshmen: true,
      includeSophomores: true,
      includeJuniors: true,
      includeSeniors: true,
      declaredOnly: false,
    },
    poolControls: {
      lockAtSeasonStart: false,
      dynamicUpdates: true,
      manualCommissionerEdits: true,
    },
    draftPacing: 'live_timer',
    draftTimerSeconds: isBb ? 120 : 90,
    chimmy: {
      devyPlaybookEnabled: true,
      surfaceFuturePicks: true,
      surfacePromotionHints: true,
    },
    mergedPipeline: { enabled: false },
  }
}

export function parseDevyLeagueConfig(raw: unknown): DevyLeagueSetupState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<DevyLeagueConfigV1>
  if (o.version !== 1) return null
  return o as DevyLeagueSetupState
}
