/**
 * Decision OS — lineup validator parity (domain binding for `manager.lineup.set`).
 *
 * The reusable comparison engine lives in core (lib/decision-os/core/parity). This module supplies
 * only the LINEUP category vocabulary (how each validator's raw codes normalize, and which categories
 * are shared scope) and binds the core comparator to it — so callers keep the same signature. Pure.
 */
import type { RuleVerdict } from '@/lib/decision-os/core/decision'
import {
  compareValidatorParity as compareValidatorParityCore,
  type ValidatorParity,
  type ValidatorParityConfig,
} from '@/lib/decision-os/core/parity'

export type { ValidatorParity }

/** Map each validator's raw code → a normalized legality category. */
const CATEGORY: Record<string, string> = {
  // shared (both validators check these)
  starter_position_ineligible: 'position_ineligible',
  duplicate_player: 'duplicate',
  bench_slot_overflow: 'section_overflow',
  ir_slot_overflow: 'section_overflow',
  starter_slot_overflow: 'section_overflow',
  section_overflow: 'section_overflow',
  roster_over_max: 'roster_total',
  roster_total_over_limit: 'roster_total',
  // redraft-only coverage
  missing_required_position: 'required_slot',
  missing_starter_slot: 'required_slot',
  illegal_lineup_slot: 'move_validity',
  invalid_lineup_move: 'move_validity',
  lineup_move_source_mismatch: 'move_validity',
  player_not_on_roster: 'move_validity',
  starter_ineligible_injury: 'status',
  starter_injury_risk: 'status',
  starter_on_bye: 'status',
  locked_player_move: 'lock',
  // canonical-only coverage
  ir_ineligible_status: 'ir_eligibility',
  taxi_disabled: 'taxi',
  taxi_non_rookie_disallowed: 'taxi',
  taxi_too_experienced: 'taxi',
  devy_ineligible: 'devy',
  lifecycle_locked: 'lifecycle',
  league_lock_all: 'lifecycle',
  concept_lineup_frozen: 'lifecycle',
  concept_ir_blocked: 'lifecycle',
  concept_devy_blocked: 'lifecycle',
}

/** Categories both validators are expected to cover (the parity scope). */
const SHARED_CATEGORIES = new Set(['position_ineligible', 'duplicate', 'section_overflow', 'roster_total'])

function codeFromRule(rule: string): string {
  const m = /^lineup\.(?:legality|canonical)\.(.+)$/.exec(rule)
  return m ? m[1] : rule
}

const LINEUP_VALIDATOR_PARITY_CONFIG: ValidatorParityConfig = {
  categoryFor: (v: RuleVerdict) => {
    const code = codeFromRule(v.rule)
    return CATEGORY[code] ?? code
  },
  sharedCategories: SHARED_CATEGORIES,
}

/** Lineup-bound parity comparator — same signature callers already use. */
export function compareValidatorParity(
  primary: RuleVerdict[],
  canonical: RuleVerdict[],
  canonicalError?: string,
): ValidatorParity {
  return compareValidatorParityCore(primary, canonical, LINEUP_VALIDATOR_PARITY_CONFIG, canonicalError)
}
