/**
 * Canonical player identity helpers — shared between the pool resolver, the
 * audit script, and any future identity-matching code.
 *
 * RULES (must stay aligned with __tests__/scripts/audit-draft-player-pool-canonical.test.ts):
 *   1. Strip diacritics (NFKD).
 *   2. Lowercase.
 *   3. Strip apostrophes outright (no replacement) — Ja'Marr → jamarr.
 *   4. Strip dots — A.J. → AJ.
 *   5. Replace remaining non-[a-z0-9\s] with space.
 *   6. KEEP suffix tokens (jr, sr, ii, iii, iv, v) — they distinguish father/son.
 *      Marvin Harrison Jr. (Cardinals WR) MUST stay distinct from Marvin Harrison
 *      Sr. (retired Colts WR). Earlier versions of this helper dropped suffixes,
 *      which collapsed the two into one row and lost the son entirely.
 *   7. Collapse adjacent single-letter tokens: "a j" → "aj" (so "A J Brown" = "A.J. Brown").
 *
 * This is STRICTER than the legacy `normalizeLooseName` in
 * `getResolvedDraftPoolForLeague.ts`, which turned apostrophes into spaces and
 * relied on a specific `\bde\s+von\b → devon` alias. That covered Achane but
 * missed Ja'Marr Chase, D'Andre Swift, O'Donnell, etc. The audit revealed 33
 * duplicate identity groups — a meaningful chunk traceable to that gap.
 *
 * Display names are NEVER changed; canonicalization is for matching only.
 */

/** DEF/DST/D/ST aliases — collapse to a single canonical position. */
const DEF_ALIASES = new Set(['DEF', 'DST', 'D/ST'])

/**
 * Strict canonical name for identity matching.
 *
 * @example
 *   canonicalName("De'Von Achane")        // "devon achane"
 *   canonicalName("Ja'Marr Chase")        // "jamarr chase"
 *   canonicalName("A.J. Brown")           // "aj brown"
 *   canonicalName("A J Brown")            // "aj brown"
 *   canonicalName("Marvin Harrison Jr.")  // "marvin harrison jr"  ← preserved
 *   canonicalName("Marvin Harrison")      // "marvin harrison"     ← distinct
 *   canonicalName("Robert Griffin III")   // "robert griffin iii"  ← preserved
 *   canonicalName("Níco Collins")         // "nico collins"
 */
export function canonicalName(input: string | null | undefined): string {
  if (!input) return ''
  const stripped = String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
  const rawTokens = stripped.split(/\s+/).filter(Boolean)
  // Collapse adjacent single-letter tokens: "a j" → "aj".
  // Suffix tokens (jr, sr, ii, iii, iv, v) are KEPT — they distinguish
  // father/son and prevent identity collapse (Marvin Harrison Jr. vs Sr.).
  const tokens: string[] = []
  for (let i = 0; i < rawTokens.length; i += 1) {
    const cur = rawTokens[i]!
    const next = rawTokens[i + 1]
    if (cur.length === 1 && next && next.length === 1) {
      tokens.push(`${cur}${next}`)
      i += 1
      continue
    }
    tokens.push(cur)
  }
  return tokens.join(' ').trim()
}

/** Canonical position. Collapses DEF/DST/D/ST → DEF. */
export function canonicalPosition(pos: string | null | undefined): string {
  const p = (pos ?? '').trim().toUpperCase()
  if (DEF_ALIASES.has(p)) return 'DEF'
  return p
}

/** Canonical team abbreviation (uppercase, trimmed; '' for FA / blank). */
export function canonicalTeam(team: string | null | undefined): string {
  return (team ?? '').trim().toUpperCase()
}

/** True when a team string represents "free agent / no team". */
export function isFreeAgentTeam(team: string | null | undefined): boolean {
  const t = canonicalTeam(team)
  return t === '' || t === 'FA' || t === 'F/A' || t === 'NONE' || t === 'N/A'
}

/** Identity key for primary dedupe — STRICTER than the legacy team-keyed key.
 *  Two rows that match this key are the same player regardless of stale team
 *  drift (e.g., FFC's snapshot says FA, the DB pool says NYG → still one row). */
export function strictIdentityKey(
  name: string | null | undefined,
  position: string | null | undefined,
): string {
  return `${canonicalName(name)}|${canonicalPosition(position)}`
}

/** Optional secondary key including team, for cases where genuinely distinct
 *  players share name + position (e.g., two "Tyler Johnson" WRs on different
 *  rosters). Used as a tiebreaker, not the primary dedupe. */
export function strictIdentityKeyWithTeam(
  name: string | null | undefined,
  position: string | null | undefined,
  team: string | null | undefined,
): string {
  return `${canonicalName(name)}|${canonicalPosition(position)}|${canonicalTeam(team)}`
}

/**
 * Stable canonical player key using the highest-confidence external ID
 * available, falling back to name+team+position.
 *
 * Priority:
 *   1. sleeperId  (numeric string, most reliable)
 *   2. sportsDataId / apiSportsId
 *   3. thesportsdbId
 *   4. canonicalName + canonicalPosition + canonicalTeam  (name fallback)
 *
 * The name-based fallback preserves suffixes (Jr./Sr./III) so father/son
 * pairs remain distinct even when no external ID is present.
 *
 * @example
 *   getCanonicalPlayerKey({ sleeperId: '5859', name: 'A.J. Brown', position: 'WR', team: 'PHI' })
 *   // → 'sleeper:5859'
 *   getCanonicalPlayerKey({ name: 'Deebo Samuel Sr.', position: 'WR', team: null })
 *   // → 'name:deebo samuel sr|WR|'
 *   getCanonicalPlayerKey({ name: 'Deebo Samuel', position: 'WR', team: 'SF' })
 *   // → 'name:deebo samuel|WR|SF'
 */
export type CanonicalPlayerKeyInput = {
  sleeperId?: string | null
  sportsDataId?: string | null
  apiSportsId?: string | null
  thesportsdbId?: string | null
  name?: string | null
  position?: string | null
  team?: string | null
}

export function getCanonicalPlayerKey(player: CanonicalPlayerKeyInput): string {
  const sid = String(player.sleeperId ?? '').trim()
  if (sid && sid.length >= 2 && /^\d+$/.test(sid)) {
    return `sleeper:${sid}`
  }
  const spid = String(player.sportsDataId ?? player.apiSportsId ?? '').trim()
  if (spid && spid.length >= 2) {
    return `sportsdata:${spid}`
  }
  const tsdbid = String(player.thesportsdbId ?? '').trim()
  if (tsdbid && tsdbid.length >= 2) {
    return `thesportsdb:${tsdbid}`
  }
  // Name-based fallback — suffix-preserving canonical
  return `name:${canonicalName(player.name)}|${canonicalPosition(player.position)}|${canonicalTeam(player.team)}`
}

/** Generational suffix tokens. Kept by `canonicalName`; stripped only by the helper below. */
const GENERATIONAL_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

/**
 * `canonicalName` with generational suffixes REMOVED — "aaron jones sr" → "aaron jones".
 *
 * 🛑 THIS KEY CANNOT IDENTIFY A PLAYER ON ITS OWN AND MUST NEVER BE USED AS IF IT COULD.
 * Collapsing the suffix is precisely what `canonicalName` refuses to do, because Marvin
 * Harrison Jr. and Marvin Harrison Sr. are two people and merging them attributes one man's
 * season to the other.
 *
 * It exists for ONE job: a last-tier bridge when a feed spells a name with a suffix and the
 * player table spells it without. Measured 2026-09-22 — the ADP seed carries "Aaron Jones Sr.",
 * the pool row carries "Aaron Jones" with `sleeperId 4199`, every suffix-preserving key missed,
 * and the draft pool therefore minted the synthetic id `name:Aaron Jones Sr.:RB:MIN` for a
 * player who had a real one. That id then matches no provider feed for the life of the league.
 *
 * A caller may act on this key ONLY after proving the base name resolves to exactly one
 * identity in the data being matched. `getResolvedDraftPoolForLeague` does that with a
 * per-key identity count plus the existing father/son conflict set.
 */
export function suffixlessCanonicalName(input: string | null | undefined): string {
  const tokens = canonicalName(input).split(' ').filter(Boolean)
  while (tokens.length > 1 && GENERATIONAL_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens.pop()
  }
  return tokens.join(' ')
}

/** Returns true when the image URL is a real provider image, not a placeholder. */
export function isProviderImage(url: string | null | undefined): boolean {
  if (!url) return false
  const s = String(url).trim()
  if (!s) return false
  if (s.startsWith('data:')) return false
  if (/\/teamLogos?\//i.test(s)) return false
  return /^https?:\/\//i.test(s)
}

/** True when url looks like an AF-generated SVG placeholder. */
export function isAfPlaceholderImage(url: string | null | undefined): boolean {
  if (!url) return false
  const s = String(url).trim()
  return s.startsWith('data:image/svg') && s.includes('AF')
}
