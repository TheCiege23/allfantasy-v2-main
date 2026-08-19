/**
 * Team-defense display identity (G8 UI) — readable names for the synthetic
 * `nfl:def:<ABBR>` team-defense rows so the raw id never leaks into user-facing
 * surfaces (roster, lineup, matchup, draft pool).
 *
 * Lightweight on purpose (only depends on the pure team normalizer) so any UI or
 * serializer can import it without pulling the scoring/prisma chain.
 */
import { normalizeNflTeam } from './lineupLock'

/** Human-readable name for a team defense, e.g. "KC" → "KC Defense". */
export function formatNflTeamDefenseName(teamAbbr: string | null | undefined): string {
  const abbr = normalizeNflTeam(teamAbbr)
  return abbr ? `${abbr} Defense` : 'Team Defense'
}

/** True if a string is a raw synthetic team-defense id (`nfl:def:KC`) that must never be shown. */
export function isRawTeamDefenseId(value: string | null | undefined): boolean {
  return /^nfl:def:/i.test(String(value ?? '').trim())
}

/** Readable name from a synthetic id (`nfl:def:KC` → "KC Defense"), or null if not one. */
export function teamDefenseDisplayNameFromId(playerId: string | null | undefined): string | null {
  const m = /^nfl:def:(.+)$/i.exec(String(playerId ?? '').trim())
  return m ? formatNflTeamDefenseName(m[1]) : null
}

/**
 * Resolve a safe display name for any roster/pool player row: if a stored name is
 * present and is not itself a raw `nfl:def:` id, use it; otherwise derive a
 * readable team-defense name from the id. Guarantees the raw id is never returned.
 */
export function safeTeamDefenseDisplayName(playerId: string | null | undefined, storedName?: string | null): string {
  // A team-defense id IS the canonical source of the display name — use it even
  // when the normalized-player foundation returned a placeholder/blank fullName.
  const fromId = teamDefenseDisplayNameFromId(playerId)
  if (fromId) return fromId
  const name = String(storedName ?? '').trim()
  // Non-DEF: pass the stored name through untouched (never fabricate a name for a
  // regular player); only derive when the stored value is itself a raw nfl:def id.
  return isRawTeamDefenseId(name) ? formatNflTeamDefenseName(name.replace(/^nfl:def:/i, '')) : name
}
