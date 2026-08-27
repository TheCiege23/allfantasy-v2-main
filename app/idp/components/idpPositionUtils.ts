/**
 * Client-side offense vs IDP defense split (NFL). No scoring engine imports.
 *
 * ⚠ THE FABRICATION GENERATORS THAT LIVED HERE ARE GONE. This file used to export
 * `mockStatPills`, `mockIdpPoints`, `mockOffensePoints`, `idpRoleLabel` and `mockYearsRemaining`
 * — hashes of the player id that surfaces rendered as box scores, points, archetypes and
 * contracts beside real names. The four with no callers left are deleted outright so they
 * cannot be picked up again; real replacements live in `lib/idp-projections/idpPlayerCard.ts`
 * and `lib/idp-projections/defenderRole.ts`.
 *
 * The two below survive only because the unmounted design mock `IDPDraftFilters` still calls
 * them. Do not import them into anything that renders.
 */

export function isOffensivePosition(pos: string): boolean {
  const p = pos.toUpperCase()
  return ['QB', 'RB', 'WR', 'TE', 'K', 'FLEX', 'SUPER_FLEX', 'SF', 'SUPER FLEX'].includes(p)
}

export function isIdpDefensivePosition(pos: string): boolean {
  const p = pos.toUpperCase()
  return ['DE', 'DT', 'DL', 'LB', 'CB', 'S', 'SS', 'FS', 'DB', 'IDP_FLEX', 'DEF'].includes(p)
}

export function mockIdpPoints(playerId: string, week: number): { pts: number; proj: number } {
  let s = 0
  for (let i = 0; i < playerId.length; i++) s = (s * 31 + playerId.charCodeAt(i)) | 0
  const base = 4 + (Math.abs(s) % 80) / 10
  const wobble = (week % 5) * 0.4
  return { pts: Math.round((base + wobble) * 10) / 10, proj: Math.round((base + 1.2) * 10) / 10 }
}

/** Deterministic mock annual salary (millions) for UI-only cap previews. */
export function mockContractSalaryM(playerId: string): number {
  let s = 0
  for (let i = 0; i < playerId.length; i++) s = (s * 19 + playerId.charCodeAt(i)) | 0
  return Math.round((1.2 + (Math.abs(s) % 2600) / 100) * 10) / 10
}
