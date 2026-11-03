import { defaultTribeSlots, type SurvivorTribeSlot } from '@/lib/survivor/survivorTribeIdentity'
/**
 * Per–league-type options collected during create (sport-aware).
 * Deeper tuning stays in League settings after the league exists.
 */

import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { clampSurvivorCastSize } from '@/lib/league-creation-wizard/sport-team-limits'
import type { ZombieUniverseTierId } from '@/lib/zombie/zombie-universe-tier'

export type TournamentLeagueNamingMode = 'commissioner_custom' | 'app_generated' | 'ai_themed'

export type SurvivorTribeNameMode = 'auto' | 'custom'
export type SurvivorCommissionerRole = 'commissioner_only' | 'player_commissioner'
export type SurvivorEntryFeeMode = 'free' | 'paid'

export interface WizardFormatOptions {
  /** Fantasy tournament (multi-league hub) — uses POST /api/tournament/create */
  tournamentParticipantPoolSize: number
  /** Fixed at 12 — each feeder league holds 12 managers. */
  tournamentInitialLeagueSize: 12
  tournamentLeagueNamingMode: TournamentLeagueNamingMode
  /** One name per line when naming mode is commissioner_custom */
  tournamentCustomLeagueNamesLines: string
  /** Survivor — team count (bounded per sport season length) */
  survivorTribeSlots?: SurvivorTribeSlot[]
  survivorTeamCount: number
  survivorTribeNameMode: SurvivorTribeNameMode
  survivorCustomTribeNamesLines: string
  survivorCommissionerRole: SurvivorCommissionerRole
  /** Survivor — optional season headline (e.g. Heroes vs Villains), matches Create League Rules step */
  survivorSeasonThemeLabel: string
  /** Survivor — catalog weekly challenges vs manual (default on) */
  survivorChallengesSystemRun: boolean
  /**
   * Survivor — tribe count sent to create (`survivor_suggested_tribe_count`).
   * `null` = auto from cast size via `suggestedSurvivorTribeCount`; otherwise 2–4.
   */
  survivorTribeCountOverride: null | 2 | 3 | 4 | 5
  /** Survivor — free play vs paid buy-in (amount set by commissioner). */
  survivorEntryFeeMode: SurvivorEntryFeeMode
  /** USD buy-in per manager when `survivorEntryFeeMode === 'paid'`; stored as cents in league settings. */
  survivorEntryFeeUsd: number | null
  /** Keeper */
  keeperMaxKeepers: number
  /** Zombie — universe size (1 / 3 / 6 linked leagues). */
  zombieUniverseTier: ZombieUniverseTierId
  /** @deprecated use zombieUniverseTier */
  zombieUniverseMode: boolean
  /** @deprecated use zombieUniverseTier */
  zombieIntertwinedLeagueCount: number
  /** Zombie — whisperer assignment (passed to `upsertZombieLeagueConfig` at create) */
  zombieWhispererSelection: 'random' | 'veteran_priority'
  /** Salary cap */
  salaryCapStartupCap: number | null
  salaryCapMode: 'dynasty' | 'bestball'
  /** Guillotine — acknowledge rules summary (full chop settings in league settings) */
  guillotineRulesAcknowledged: boolean
  pirateProtectionLimit: number
  pirateClaimHours: number
  piratePlayoffClaims: boolean
  /** Big Brother — optional subtitle shown on league home */
  bigBrotherSubtitle: string
  /** Big Brother — finale format (final_2 or final_3) */
  bigBrotherFinaleFormat: string
  /** Big Brother — jury start mode */
  bigBrotherJuryMode: string
  /** Big Brother — HOH challenge mode */
  bigBrotherChallengeMode: string
  /** Big Brother — eviction tie-break mode */
  bigBrotherTieBreak: string
  /** Big Brother — allow consecutive HOH wins */
  bigBrotherConsecutiveHoh: boolean
  /** IDP — enabled flag for the modifier */
  idpEnabled: boolean
  /** IDP — position mode (standard=grouped DL/LB/DB, advanced=split DE/DT/LB/CB/S) */
  idpPositionMode: string
  /** IDP — roster preset (beginner, standard, advanced) */
  idpRosterPreset: string
  /** IDP — scoring preset (balanced, tackle_heavy, big_play_heavy) */
  idpScoringPreset: string
  /** Taxi / devy — creation-time targets (roster templates still from presets) */
  dynastyTaxiSlots: number
  devyTaxiSlots: number
  devyCollegeSlots: number
  c2cTaxiSlots: number
  c2cCollegeSlots: number
}

export const DEFAULT_WIZARD_FORMAT_OPTIONS: WizardFormatOptions = {
  tournamentParticipantPoolSize: 72,
  tournamentInitialLeagueSize: 12,
  tournamentLeagueNamingMode: 'app_generated',
  tournamentCustomLeagueNamesLines: '',
  survivorTeamCount: 20,
  survivorTribeNameMode: 'auto',
  survivorCustomTribeNamesLines: '',
  survivorCommissionerRole: 'commissioner_only',
  survivorSeasonThemeLabel: '',
  survivorChallengesSystemRun: true,
  /** Default 4 tribes (no “auto” in UI — cast size still set on step 1). */
  survivorTribeCountOverride: 4,
  survivorEntryFeeMode: 'free',
  survivorEntryFeeUsd: null,
  keeperMaxKeepers: 3,
  zombieUniverseTier: 'single_gamma',
  zombieUniverseMode: false,
  zombieIntertwinedLeagueCount: 1,
  zombieWhispererSelection: 'random',
  salaryCapStartupCap: null,
  salaryCapMode: 'dynasty',
  guillotineRulesAcknowledged: false,
  pirateProtectionLimit: 3,
  pirateClaimHours: 24,
  piratePlayoffClaims: false,
  bigBrotherSubtitle: '',
  bigBrotherFinaleFormat: 'final_2',
  bigBrotherJuryMode: 'after_eliminations',
  bigBrotherChallengeMode: 'deterministic_score',
  bigBrotherTieBreak: 'hoh_vote',
  bigBrotherConsecutiveHoh: false,
  idpEnabled: false,
  idpPositionMode: 'standard',
  idpRosterPreset: 'standard',
  idpScoringPreset: 'balanced',
  dynastyTaxiSlots: 4,
  devyTaxiSlots: 6,
  devyCollegeSlots: 4,
  c2cTaxiSlots: 4,
  c2cCollegeSlots: 6,
}

/** Survivor cast: 16 / 20 / 24 only (all sports). */
export function getSurvivorTeamBounds(_sport: string): { min: number; max: number } {
  return { min: 16, max: 24 }
}

export function clampSurvivorTeamCount(_sport: string, n: number): number {
  return clampSurvivorCastSize(n)
}

/** Tribe count from team count: max 4 tribes, at least 2. */
export function suggestedSurvivorTribeCount(teamCount: number): number {
  if (teamCount <= 8) return 2
  if (teamCount <= 16) return 3
  return 4
}

export function formatOptionsApplyToLeagueType(
  leagueType: string,
  options: WizardFormatOptions,
  sport: string
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    creation_format_options_version: 1,
  }

  if (leagueType === 'pirate') {
    out.pirate_protection_limit = Math.max(1, Math.min(10, Math.floor(options.pirateProtectionLimit || 3)))
    out.pirate_claim_hours = Math.max(1, Math.min(72, Math.floor(options.pirateClaimHours || 24)))
    out.pirate_playoff_claims = options.piratePlayoffClaims === true
  }

  if (leagueType === 'survivor') {
    out.survivor_creation_team_count = clampSurvivorTeamCount(sport, options.survivorTeamCount)
    const feeMode = options.survivorEntryFeeMode === 'paid' ? 'paid' : 'free'
    out.survivor_entry_fee_mode = feeMode
    if (feeMode === 'paid') {
      const usd = Number(options.survivorEntryFeeUsd)
      if (Number.isFinite(usd) && usd > 0) {
        out.survivor_entry_fee_amount_cents = Math.round(usd * 100)
      } else {
        out.survivor_entry_fee_amount_cents = null
      }
    } else {
      out.survivor_entry_fee_amount_cents = null
    }
    out.survivor_tribe_name_mode = options.survivorTribeNameMode
    out.survivor_commissioner_role = options.survivorCommissionerRole
    out.survivor_challenges_system_run = options.survivorChallengesSystemRun !== false
    if (options.survivorSeasonThemeLabel.trim()) {
      out.survivor_season_theme_label = options.survivorSeasonThemeLabel.trim()
    }
    const cast = clampSurvivorTeamCount(sport, options.survivorTeamCount)
    const tribeCount =
      options.survivorTribeCountOverride != null
        ? Math.min(5, Math.max(2, options.survivorTribeCountOverride))
        : Math.min(4, Math.max(2, suggestedSurvivorTribeCount(cast)))
    out.survivor_suggested_tribe_count = tribeCount
    out.survivorTribeSlots = options.survivorTribeSlots ?? defaultTribeSlots(cast, tribeCount)
    if (options.survivorCustomTribeNamesLines.trim()) {
      out.survivor_custom_tribe_names = options.survivorCustomTribeNamesLines
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    }
    if (options.survivorCommissionerRole === 'player_commissioner') {
      out.survivor_commissioner_fair_play_limited_visibility = true
    }
  }

  if (leagueType === 'keeper') {
    out.keeper_max_keepers = options.keeperMaxKeepers
  }

  if (leagueType === 'zombie') {
    const tier = options.zombieUniverseTier ?? 'single_gamma'
    out.zombie_universe_tier = tier
    out.zombie_creation_universe_mode = tier !== 'single_gamma' || options.zombieUniverseMode
    out.zombie_creation_intertwined_league_count =
      tier === 'alpha_hex' ? 6 : tier === 'beta_trio' ? 3 : 1
    out.zombie_whisperer_selection = options.zombieWhispererSelection === 'veteran_priority' ? 'veteran_priority' : 'random'
  }

  if (leagueType === 'salary_cap') {
    if (options.salaryCapStartupCap != null) out.salary_cap_startup_cap = options.salaryCapStartupCap
    out.salary_cap_mode = options.salaryCapMode
  }

  if (leagueType === 'big_brother') {
    if (options.bigBrotherSubtitle.trim()) {
      out.big_brother_subtitle = options.bigBrotherSubtitle.trim()
    }
    out.big_brother_finale_format = options.bigBrotherFinaleFormat || 'final_2'
    out.big_brother_jury_mode = options.bigBrotherJuryMode || 'after_eliminations'
    out.big_brother_challenge_mode = options.bigBrotherChallengeMode || 'deterministic_score'
    out.big_brother_tie_break = options.bigBrotherTieBreak || 'hoh_vote'
    out.big_brother_consecutive_hoh = options.bigBrotherConsecutiveHoh ?? false
  }

  // IDP applies as a modifier across league types (sport support is enforced by sport-scope).
  if (options.idpEnabled) {
    out.idp_enabled = true
    out.idp_position_mode = options.idpPositionMode || 'standard'
    out.idp_roster_preset = options.idpRosterPreset || 'standard'
    out.idp_scoring_preset = options.idpScoringPreset || 'balanced'
  }

  if (leagueType === 'dynasty') {
    out.dynasty_taxi_slots_creation = options.dynastyTaxiSlots
  }

  if (leagueType === 'devy') {
    out.devy_taxi_slots_creation = options.devyTaxiSlots
    out.devy_college_slots_creation = options.devyCollegeSlots
    /** Required by `validateLeagueSettings` for devy leagues (college / devy reserve count). */
    out.devy_slots = Math.max(1, options.devyCollegeSlots)
  }

  if (leagueType === 'c2c') {
    out.c2c_taxi_slots_creation = options.c2cTaxiSlots
    out.c2c_college_slots_creation = options.c2cCollegeSlots
  }

  if (leagueType === 'guillotine') {
    out.guillotine_rules_acknowledged_at_create = options.guillotineRulesAcknowledged
  }

  return out
}
