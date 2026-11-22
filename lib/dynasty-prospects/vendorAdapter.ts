import type { PlayerKeyRef } from './playerKey'

/**
 * What a prospect vendor importer must supply. No vendor is chosen yet
 * (docs/DYNASTY_PROSPECT_DATA_PLAN.md §7, D-2); this is the seam a real one plugs into.
 *
 * A real adapter is the ONLY place a vendor call may live, and it follows the CFBD shape
 * (CLAUDE.md "CFBD is the worked example"): its own `contracts/<vendor>/` directory with committed
 * fixtures first, its host added to `DATA_API_HOST_PATTERNS` in the same commit, and the writer in
 * ./ingestProspects.ts as its sole runtime importer. The adapter maps the vendor's shape into the
 * records below and does nothing else — no database, no hashing; the writer owns both.
 *
 * ⚠ THE ADAPTER'S `source` IS THE ONLY SOURCE ITS RECORDS ARE WRITTEN UNDER. Records do not carry
 * their own, so one adapter cannot write into another vendor's id space by mistake.
 */

export type ProspectSport = 'MLB' | 'NBA' | 'NHL'

export const PROSPECT_SPORTS: readonly ProspectSport[] = ['MLB', 'NBA', 'NHL']

export function toProspectSport(sport: string | null | undefined): ProspectSport | null {
  const s = String(sport ?? '').trim().toUpperCase()
  return (PROSPECT_SPORTS as readonly string[]).includes(s) ? (s as ProspectSport) : null
}

export type ProspectStatus = 'prospect' | 'graduated' | 'released' | 'unknown'

/** One prospect as a vendor describes him, already mapped into our vocabulary. */
export type VendorProspectRecord = {
  /** The vendor's own id. Stored only beside the adapter's `source`. */
  sourcePlayerId: string
  name: string
  position?: string | null
  /** ISO date (YYYY-MM-DD) or a Date. */
  birthDate?: string | Date | null
  nationality?: string | null
  /** Pro organisation holding his rights (MLB org / NHL club); null when unsigned. */
  currentOrg?: string | null
  currentTeam?: string | null
  currentLevel?: string | null
  draftYear?: number | null
  draftRound?: number | null
  draftPick?: number | null
  draftOverall?: number | null
  draftTeam?: string | null
  etaYear?: number | null
  status?: ProspectStatus | null
  /** Level stats, vendor-shaped but labelled. Hashed with the rest. */
  stats?: Record<string, unknown> | null
  /** When the vendor says the record last changed, if it says. */
  sourceUpdatedAt?: string | Date | null
  /** The vendor's record as received, kept for audit. NOT hashed (it may carry volatile fields). */
  raw?: unknown
}

/** One rookie verdict a vendor supplies for a season. */
export type VendorRookieEligibilityRecord = {
  /**
   * Who it is about: our own SportsPlayer row, or a player in THIS vendor's id space. A key in a
   * different vendor's space is refused by the writer.
   */
  player: PlayerKeyRef
  isRookie: boolean
  /** Human-readable reason; required, because a verdict nobody can explain cannot be trusted. */
  basis: string
  evidence?: Record<string, unknown> | null
}

export interface ProspectVendorAdapter {
  /** Vendor slug, e.g. `sportradar`. Lowercase, ≤ 32 chars (see playerKey.isValidSourceSlug). */
  readonly source: string
  readonly sports: readonly ProspectSport[]
  /** The vendor's current prospect universe for one sport. */
  fetchProspects(sport: ProspectSport): Promise<VendorProspectRecord[]>
  /** Optional: rookie verdicts for one sport and season (season labelled by its start year). */
  fetchRookieEligibility?(sport: ProspectSport, season: number): Promise<VendorRookieEligibilityRecord[]>
}
