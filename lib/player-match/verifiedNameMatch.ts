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
 * Name normalization for joining. Lowercase, strip accents, strip a TRAILING
 * generational suffix, strip punctuation, collapse whitespace.
 *
 * 🛑 THE SUFFIX STRIP IS ANCHORED TO THE END, AND THAT ANCHOR IS THE WHOLE POINT.
 * It used to be `\b(jr|sr|ii|iii|iv|v)\.?\b/g` — unanchored and global, so it fired
 * wherever those letters stood alone, including inside a FIRST name. Measured
 * against the 12,594 distinct NFL names in `SportsPlayer` on 2026-09-07:
 *
 *     "JR Pace"           -> "pace"             the first name, deleted outright
 *     "V'Angelo Bentley"  -> "angelo bentley"   the V eaten as a suffix
 *
 * Anchoring changes the key of 4 names out of 12,594 (0.032%) and leaves all 401
 * trailing-suffix names stripped exactly as before, so no intended merge is lost.
 * Two of those four are corrupt rows — `"Reggie Jr. White"`, `"Larry Jr. Allen"` —
 * where the old regex silently "repaired" the data by deleting a token; they now
 * key as written, which is the honest outcome for a row that is wrong upstream.
 *
 * ⚠ AND THE OLD DOCBLOCK'S CLAIM — "it never strips enough to merge two genuinely
 * different names" — WAS NOT TRUE, so it is not repeated here. Stripping a trailing
 * suffix merges `Marvin Harrison Jr.` into `Marvin Harrison`, and `David Long Jr.`
 * (CB) into `David Long` (LB). That merge is DELIBERATE and is why the anchor was
 * fixed rather than the strip removed: `SportsPlayer` holds the same player under
 * several spellings ("Quincy Skinner", "Quincy Skinner JR", "Quincy Skinner Jr."),
 * and stripping is what reunites him. `lib/draft-room/player-canonical-identity`
 * makes the OPPOSITE choice for the same reason in reverse — it keeps suffixes so a
 * father and son stay distinct. Both are defensible; they are not interchangeable,
 * and a key built by one must never be looked up in an index built by the other.
 *
 * The residual risk is real and is the caller's to manage: this returns a KEY, and
 * `resolveVerifiedMatch` is what refuses an ambiguous bind. Do not treat a matching
 * key as an identity on its own.
 */
export function normalizeMatchName(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?\s*$/, '')
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
