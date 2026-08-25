import { describe, expect, it } from 'vitest'

import { getDraftTypeOptions } from '@/lib/create-league-v2/rules-engine'
import {
  getAllowedDraftTypesForLeagueType,
  isDraftTypeAllowedForLeagueType,
} from '@/lib/league-creation-wizard/league-type-registry'

/**
 * ⚠ "ALLOWED" AND "PICKABLE" ARE TWO DIFFERENT QUESTIONS, AND THIS FILE USED TO CONFLATE THEM.
 *
 * It asserted that `getAllowedDraftTypesForLeagueType('redraft', 'NFL')` was exactly
 * `['snake', 'linear', 'auction']` — treating the *validation* allowlist as the *startup* menu.
 * Those are separate surfaces with deliberately different answers:
 *
 *   - `getAllowedDraftTypesForLeagueType` → what canonical validation will accept for the format.
 *     Backs `/api/league/create`, `validateCreateLeague`, and `LeagueSettingsValidator`, so it must
 *     also accept what already-created leagues carry.
 *   - `getDraftTypeOptions` → what the create-league wizard actually offers, which is narrower:
 *     `NON_PICKABLE_REDFRAFT_DRAFT_IDS` (lib/create-league-v2/rules-engine.ts) subtracts
 *     `slow_draft` for redraft, because a slow draft is a clock configuration rather than a
 *     pick-order algorithm — keeper, which does surface it, keeps it.
 *
 * The old assertion predated `595959f64` (2026-06-12), which widened both lists and shipped 256
 * lines of its own tests for the new shape (`redraft-defaults-nfl-ncaaf`, `keeper-defaults-nfl-ncaaf`).
 * It stayed red for two months because Vitest does not run in CI. Pinning both halves here is what
 * keeps the next reader from "fixing" the narrow surface by widening it, or the wide one by
 * narrowing it — either of which breaks the other file.
 */
describe('startup draft type allowlist', () => {
  it('accepts the full redraft set through validation, including what the wizard will not offer', () => {
    const allowed = getAllowedDraftTypesForLeagueType('redraft', 'NFL')
    expect(allowed).toEqual(['snake', 'linear', 'auction', 'slow_draft', 'mock_draft'])

    // `slow_draft` is valid to persist even though redraft's wizard hides it — an existing league
    // carrying it must not start failing LeagueSettingsValidator.
    expect(isDraftTypeAllowedForLeagueType('slow_draft', 'redraft', 'NFL')).toBe(true)
    expect(isDraftTypeAllowedForLeagueType('mock_draft', 'redraft', 'NFL')).toBe(true)
  })

  it('keeps keeper aligned with redraft, since the two are defined as one pair', () => {
    // `d9a657df4` widened keeper the same day `595959f64` widened redraft; they must not diverge.
    expect(getAllowedDraftTypesForLeagueType('keeper', 'NFL')).toEqual(
      getAllowedDraftTypesForLeagueType('redraft', 'NFL')
    )
  })

  it('withholds slow draft from the redraft wizard while keeper still offers it', () => {
    // The narrower half of the contract, and the reason the two must be asserted together.
    const redraft = getDraftTypeOptions('redraft', 'NFL').map((option) => option.id)
    expect(redraft).toContain('snake')
    expect(redraft).not.toContain('slow_draft')

    expect(getDraftTypeOptions('keeper', 'NFL').map((option) => option.id)).toContain('slow_draft')
  })

  it('keeps C2C startup options to snake, linear, and auction variants', () => {
    const allowed = getAllowedDraftTypesForLeagueType('c2c', 'NFL')
    expect(allowed).toEqual(['c2c_snake', 'c2c_linear', 'c2c_auction'])
  })
})
