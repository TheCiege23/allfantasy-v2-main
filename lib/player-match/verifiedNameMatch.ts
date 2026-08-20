/**
 * Verified name matching (Slice 15 — wrong-row joins).
 *
 * Several in-memory joins bind a player by lowercased NAME alone and take the
 * first hit: injury maps, projection-enrichment maps, market-value lookups.
 * Real fantasy player pools contain genuine name collisions across positions
 * and sports (the canonical example: QB Josh Allen vs LB Josh Allen), so a
 * name-only bind can attach one athlete's injury, projection or market value
 * to a different athlete — silently, and with full confidence downstream.
 *
 * This module is the pure, in-memory counterpart to
 * `lib/shared-services/player-identity` (which is DB-backed and async): index
 * candidates by normalized name, then require POSITION and/or TEAM agreement
 * before binding, and REFUSE the bind when the remaining candidates are
 * ambiguous rather than silently taking row 0.
 *
 * Refusing is the point. A missing injury badge is a gap; the wrong player's
 * injury badge is a false statement.
 */

export interface NameMatchCandidate {
  name: string
  position?: string | null
  team?: string | null
}

export type NameMatchReason =
  | 'unique_name'
  | 'position_verified'
  | 'team_verified'
  | 'position_and_team_verified'
  | 'ambiguous'
  | 'not_found'

export interface NameMatchResult<T> {
  match: T | null
  reason: NameMatchReason
  /** How many candidates shared the normalized name before verification. */
  candidateCount: number
}

/**
 * Name normalization for joining. Deliberately conservative: lowercase, strip
 * punctuation and generational suffixes, collapse whitespace. It never strips
 * enough to merge two genuinely different names.
 */
export function normalizeMatchName(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeToken(value: string | null | undefined): string | null {
  const token = String(value ?? '').trim().toUpperCase()
  return token ? token : null
}

/** Index candidates by normalized name. Collisions are preserved, not overwritten. */
export function buildNameIndex<T extends NameMatchCandidate>(rows: readonly T[]): Map<string, T[]> {
  const index = new Map<string, T[]>()
  for (const row of rows) {
    const key = normalizeMatchName(row.name)
    if (!key) continue
    const bucket = index.get(key)
    if (bucket) bucket.push(row)
    else index.set(key, [row])
  }
  return index
}

/**
 * Resolve one lookup against the index.
 *
 * Rules, in order:
 *  1. No candidates → `not_found`.
 *  2. Exactly one candidate → bind (`unique_name`). A unique name is not a
 *     collision risk, so position data is not required.
 *  3. Multiple candidates → narrow by position, then by team. Bind only if
 *     exactly one survives; otherwise `ambiguous` and NO bind.
 *
 * Note on step 3: when the lookup carries no position/team, multiple
 * candidates can never be narrowed, so the result is `ambiguous` — which is
 * the honest outcome, not a defect.
 */
export function resolveVerifiedMatch<T extends NameMatchCandidate>(
  index: Map<string, T[]>,
  lookup: { name: string; position?: string | null; team?: string | null },
): NameMatchResult<T> {
  const key = normalizeMatchName(lookup.name)
  const candidates = key ? index.get(key) ?? [] : []
  if (candidates.length === 0) return { match: null, reason: 'not_found', candidateCount: 0 }
  if (candidates.length === 1) {
    return { match: candidates[0]!, reason: 'unique_name', candidateCount: 1 }
  }

  const wantPosition = normalizeToken(lookup.position)
  const wantTeam = normalizeToken(lookup.team)

  let narrowed = candidates
  let usedPosition = false
  let usedTeam = false

  if (wantPosition) {
    const byPosition = narrowed.filter((c) => normalizeToken(c.position) === wantPosition)
    if (byPosition.length > 0) {
      narrowed = byPosition
      usedPosition = true
    }
  }
  if (narrowed.length > 1 && wantTeam) {
    const byTeam = narrowed.filter((c) => normalizeToken(c.team) === wantTeam)
    if (byTeam.length > 0) {
      narrowed = byTeam
      usedTeam = true
    }
  }

  if (narrowed.length !== 1) {
    return { match: null, reason: 'ambiguous', candidateCount: candidates.length }
  }

  const reason: NameMatchReason =
    usedPosition && usedTeam
      ? 'position_and_team_verified'
      : usedPosition
        ? 'position_verified'
        : usedTeam
          ? 'team_verified'
          : 'ambiguous'

  // Narrowed to one without using any verifying field means the collision was
  // never actually resolved — refuse rather than bind on luck.
  if (reason === 'ambiguous') {
    return { match: null, reason: 'ambiguous', candidateCount: candidates.length }
  }
  return { match: narrowed[0]!, reason, candidateCount: candidates.length }
}

/** Convenience: the matched row or null, discarding provenance. */
export function findVerified<T extends NameMatchCandidate>(
  index: Map<string, T[]>,
  lookup: { name: string; position?: string | null; team?: string | null },
): T | null {
  return resolveVerifiedMatch(index, lookup).match
}
