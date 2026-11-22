/**
 * Editable fields of the OLDER Devy / C2C league records (`DevyLeague` / `C2CLeague`), which the
 * Commissioner Settings legacy tabs edit through `PATCH /api/devy` and `PATCH /api/c2c/settings`.
 *
 * Client-safe on purpose (no prisma import): the panels read the same ranges and option lists the
 * routes enforce, so an input can never offer a value the server refuses.
 *
 * ⚠ An explicit ALLOWLIST. A field not named here is refused (400, listed by name); a field named
 * in a LOCKED map is refused with its reason (409). Nothing reaches `prisma.update` unless it is in
 * the allowlist and passed its own type and range check.
 */

export type LegacyFieldSpec =
  | { kind: 'int'; min: number; max: number }
  | { kind: 'bool' }
  | { kind: 'enum'; values: readonly string[] }
  /** ISO date-time string, or null to clear. */
  | { kind: 'datetime' }
  /** A fraction between min and max (e.g. 0.4 = 40%). */
  | { kind: 'fraction'; min: number; max: number }

export const DEVY_STARTUP_DRAFT_FORMATS = ['combined', 'split_vets_first', 'split_devy_first'] as const
export const DEVY_FUTURE_DRAFT_FORMATS = ['combined', 'separate'] as const
/** `processDevyToRookieTransition` branches on exactly these; anything else falls to review. */
export const DEVY_GRAD_BEHAVIORS = ['move_to_taxi', 'move_to_active', 'commissioner_review'] as const

/** `DevyLeague` fields a commissioner may change. */
export const DEVY_LEGACY_FIELDS: Record<string, LegacyFieldSpec> = {
  startupDraftFormat: { kind: 'enum', values: DEVY_STARTUP_DRAFT_FORMATS },
  futureDraftFormat: { kind: 'enum', values: DEVY_FUTURE_DRAFT_FORMATS },
  activeRosterSize: { kind: 'int', min: 1, max: 40 },
  benchSlots: { kind: 'int', min: 0, max: 30 },
  irSlots: { kind: 'int', min: 0, max: 10 },
  taxiSlots: { kind: 'int', min: 0, max: 20 },
  devySlots: { kind: 'int', min: 0, max: 30 },
  maxDevyPerTeam: { kind: 'int', min: 0, max: 30 },
  taxiRookieOnly: { kind: 'bool' },
  taxiAllowNonRookies: { kind: 'bool' },
  taxiMaxExperienceYears: { kind: 'int', min: 0, max: 5 },
  taxiLockDeadline: { kind: 'datetime' },
  taxiCanReturnAfterPromo: { kind: 'bool' },
  taxiDevyToRookieEligible: { kind: 'bool' },
  taxiPointsVisibleDisplay: { kind: 'bool' },
  taxiPoachaingEnabled: { kind: 'bool' },
  devyFreshmenEligible: { kind: 'bool' },
  devyAutoPromoteToRookie: { kind: 'bool' },
  devyDeclarationVisibility: { kind: 'bool' },
  rookiePickTradingEnabled: { kind: 'bool' },
  devyPickTradingEnabled: { kind: 'bool' },
  devyGradBehavior: { kind: 'enum', values: DEVY_GRAD_BEHAVIORS },
}

/** `DevyLeague` fields that exist but are never editable, with the reason the route returns. */
export const DEVY_LEGACY_LOCKED: Record<string, string> = {
  id: 'Record ids never change.',
  leagueId: 'Record ids never change.',
  season: 'The season comes from the league and drives pick inventory; it is not edited here.',
  createdByTheCiege: 'Set when the record was created; it is not a league setting.',
  isDynastyOnly: 'Devy leagues are always dynasty leagues.',
  taxiPointsCountToward: 'Taxi points never count toward the team score: only starters score.',
  createdAt: 'Timestamps are set by the server.',
  updatedAt: 'Timestamps are set by the server.',
}

export const C2C_DRAFT_FORMATS = ['split_campus_canton', 'combined', 'campus_first', 'canton_first'] as const
/** `computeOfficialScore` and the UI chips know exactly these four. */
export const C2C_SCORING_MODES = ['combined_total', 'split_display_combined', 'dual_track', 'weighted_combined'] as const
export const C2C_TAXI_LOCK_MODES = ['preseason', 'start_of_season', 'no_limit'] as const
export const C2C_BASKETBALL_LINEUP_FREQS = ['weekly', 'daily'] as const
export const C2C_WEIGHT_MIN = 0.3
export const C2C_WEIGHT_MAX = 0.7

/**
 * `C2CLeague` fields a commissioner may change, plus `taxiLockMode`, which lives in
 * `League.settings.c2cTaxiLockMode` (see lib/c2c/taxiLockResolver.ts).
 */
export const C2C_LEGACY_FIELDS: Record<string, LegacyFieldSpec> = {
  scoringMode: { kind: 'enum', values: C2C_SCORING_MODES },
  campusScoreWeight: { kind: 'fraction', min: C2C_WEIGHT_MIN, max: C2C_WEIGHT_MAX },
  cantonScoreWeight: { kind: 'fraction', min: C2C_WEIGHT_MIN, max: C2C_WEIGHT_MAX },
  campusStarterSlots: { kind: 'int', min: 1, max: 20 },
  cantonStarterSlots: { kind: 'int', min: 1, max: 20 },
  benchSlots: { kind: 'int', min: 0, max: 30 },
  taxiSlots: { kind: 'int', min: 0, max: 20 },
  devySlots: { kind: 'int', min: 0, max: 30 },
  irSlots: { kind: 'int', min: 0, max: 10 },
  taxiRookieOnly: { kind: 'bool' },
  taxiMaxExperienceYears: { kind: 'int', min: 0, max: 5 },
  taxiLockDeadline: { kind: 'datetime' },
  taxiPointsVisible: { kind: 'bool' },
  devyScoringEnabled: { kind: 'bool' },
  startupDraftFormat: { kind: 'enum', values: C2C_DRAFT_FORMATS },
  futureDraftFormat: { kind: 'enum', values: C2C_DRAFT_FORMATS },
  basketballLineupFreq: { kind: 'enum', values: C2C_BASKETBALL_LINEUP_FREQS },
  taxiLockMode: { kind: 'enum', values: C2C_TAXI_LOCK_MODES },
}

export const C2C_LEGACY_LOCKED: Record<string, string> = {
  id: 'Record ids never change.',
  leagueId: 'Record ids never change.',
  season: 'The season comes from the league; it is not edited here.',
  createdByTheCiege: 'Set when the record was created; it is not a league setting.',
  isDynastyOnly: 'C2C leagues are always dynasty leagues.',
  sportPair: 'Set at league creation: every roster, player pool and score is keyed to it.',
  footballCampusLockDay: 'Football lineup locks have one supported value each.',
  footballCantonLockDay: 'Football lineup locks have one supported value each.',
  createdAt: 'Timestamps are set by the server.',
  updatedAt: 'Timestamps are set by the server.',
}

export type LegacyPatchParse =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: 400; code: 'UNKNOWN_FIELDS'; unknown: string[] }
  | { ok: false; status: 409; code: 'FIELD_LOCKED'; locked: Array<{ field: string; reason: string }> }
  | { ok: false; status: 400; code: 'INVALID_FIELDS'; invalid: Array<{ field: string; reason: string }> }
  | { ok: false; status: 400; code: 'NO_FIELDS' }

function checkValue(spec: LegacyFieldSpec, v: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  switch (spec.kind) {
    case 'bool':
      return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, reason: 'must be true or false' }
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, reason: 'must be a whole number' }
      if (v < spec.min || v > spec.max) return { ok: false, reason: `must be between ${spec.min} and ${spec.max}` }
      return { ok: true, value: v }
    case 'fraction':
      if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, reason: 'must be a number' }
      if (v < spec.min - 1e-9 || v > spec.max + 1e-9) return { ok: false, reason: `must be between ${spec.min} and ${spec.max}` }
      return { ok: true, value: Math.round(v * 100) / 100 }
    case 'enum':
      return typeof v === 'string' && spec.values.includes(v)
        ? { ok: true, value: v }
        : { ok: false, reason: `must be one of: ${spec.values.join(', ')}` }
    case 'datetime': {
      if (v === null) return { ok: true, value: null }
      if (typeof v !== 'string') return { ok: false, reason: 'must be an ISO date-time or null' }
      const d = new Date(v)
      if (Number.isNaN(d.getTime())) return { ok: false, reason: 'must be an ISO date-time or null' }
      return { ok: true, value: d }
    }
  }
}

/**
 * Split a PATCH body into allowlisted, validated values. `leagueId` is the request's identifier
 * and is skipped. Unknown fields win over locked ones, which win over invalid values, so a caller
 * always learns about the field it should not have sent at all first.
 */
export function parseLegacyPatch(
  body: Record<string, unknown>,
  fields: Record<string, LegacyFieldSpec>,
  locked: Record<string, string>,
): LegacyPatchParse {
  const keys = Object.keys(body).filter((k) => k !== 'leagueId')
  const unknown = keys.filter((k) => !(k in fields) && !(k in locked))
  if (unknown.length) return { ok: false, status: 400, code: 'UNKNOWN_FIELDS', unknown }
  const lockedHits = keys.filter((k) => k in locked).map((field) => ({ field, reason: locked[field]! }))
  if (lockedHits.length) return { ok: false, status: 409, code: 'FIELD_LOCKED', locked: lockedHits }
  const data: Record<string, unknown> = {}
  const invalid: Array<{ field: string; reason: string }> = []
  for (const k of keys) {
    const r = checkValue(fields[k]!, body[k])
    if (r.ok) data[k] = r.value
    else invalid.push({ field: k, reason: r.reason })
  }
  if (invalid.length) return { ok: false, status: 400, code: 'INVALID_FIELDS', invalid }
  if (Object.keys(data).length === 0) return { ok: false, status: 400, code: 'NO_FIELDS' }
  return { ok: true, data }
}

/** Plain-text value for the league chat notice. */
export function legacyValueText(v: unknown): string {
  if (v === null || v === undefined) return 'none'
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  return String(v)
}

/** English field names for the league chat notice (the notice is written once, for everyone). */
export const LEGACY_CHAT_LABELS: Record<string, string> = {
  startupDraftFormat: 'Startup draft format',
  futureDraftFormat: 'Future draft format',
  activeRosterSize: 'Active roster size',
  benchSlots: 'Bench slots',
  irSlots: 'IR slots',
  taxiSlots: 'Taxi slots',
  devySlots: 'Devy slots',
  maxDevyPerTeam: 'Max devy per team',
  taxiRookieOnly: 'Rookie-only taxi',
  taxiAllowNonRookies: 'Taxi allows non-rookies',
  taxiMaxExperienceYears: 'Taxi max experience (years)',
  taxiLockDeadline: 'Taxi lock deadline',
  taxiCanReturnAfterPromo: 'Taxi return after promotion',
  taxiDevyToRookieEligible: 'Devy-to-rookie taxi eligible',
  taxiPointsVisibleDisplay: 'Taxi points shown',
  taxiPointsVisible: 'Taxi points shown',
  taxiPoachaingEnabled: 'Taxi poaching',
  devyFreshmenEligible: 'Freshmen eligible',
  devyAutoPromoteToRookie: 'Auto-promote devy to rookie',
  devyDeclarationVisibility: 'Declaration year shown',
  rookiePickTradingEnabled: 'Rookie pick trading',
  devyPickTradingEnabled: 'Devy pick trading',
  devyGradBehavior: 'When a devy player enters the NFL',
  scoringMode: 'Scoring mode',
  campusScoreWeight: 'Campus score weight',
  cantonScoreWeight: 'Canton score weight',
  campusStarterSlots: 'Campus starters',
  cantonStarterSlots: 'Canton starters',
  devyScoringEnabled: 'Devy scoring',
  basketballLineupFreq: 'Basketball lineup changes',
  taxiLockMode: 'Taxi lock',
}

/** Same value? Dates compare by instant. */
export function legacySameValue(a: unknown, b: unknown): boolean {
  const norm = (x: unknown) => (x instanceof Date ? x.getTime() : (x ?? null))
  return norm(a) === norm(b)
}
