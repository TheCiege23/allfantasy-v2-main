/**
 * The one switch for the dynasty prospect tables (`prospect_players`, `rookie_eligibility_records`).
 *
 * 🛑 OFF UNTIL THE OWNER APPLIES `20261020180000_dynasty_prospect_storage`. Code that queries a table
 * production lacks raises P2021 — it does not no-op. So every reader and writer in this directory
 * asks this first and, while it is off, returns empty WITHOUT touching the database.
 *
 * Why a flag rather than catching P2021 and returning empty:
 *   - Off means zero queries, so nothing about any request changes — not even a failed round trip.
 *   - A P2021 catch would make a missing table and an empty table look identical FOREVER. Once the
 *     flag is on the operator has asserted the migration is applied, and a missing table is then a
 *     real fault that should be loud, not a silent "no prospects".
 *   - The writer needs gating too (a vendor import into a missing table is not a read to degrade),
 *     and one flag covers both directions.
 *
 * `1` or `true` (any case) turns it on; anything else, including unset, is off.
 */
export const DYNASTY_PROSPECT_STORAGE_FLAG = 'DYNASTY_PROSPECT_STORAGE_ENABLED'

export type FlagEnv = Readonly<Record<string, string | undefined>>

export function isDynastyProspectStorageEnabled(env: FlagEnv = process.env): boolean {
  const raw = String(env[DYNASTY_PROSPECT_STORAGE_FLAG] ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true'
}
