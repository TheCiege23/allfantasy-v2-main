import type { NormalizedTradedPick } from '../../types'
import type { SleeperImportPayload } from './types'

/**
 * Block F — map Sleeper `/league/{id}/traded_picks` rows to `NormalizedTradedPick`.
 *
 * Sleeper's field semantics (verified against real leagues during the fidelity audit):
 *   - `roster_id`         → original owner's roster_id (identity of the pick)
 *   - `owner_id`          → current owner's roster_id (who holds it now)
 *   - `previous_owner_id` → most recent prior owner (optional)
 *
 * All roster IDs are Sleeper integers (1..total_rosters); we coerce to strings so
 * they match `league_teams.externalId` / `future_draft_picks.originalRosterId`
 * (both text columns).
 *
 * Rows with missing required fields (season / round / owner) are dropped defensively
 * — the audit corpus had 33 rows all with these fields present, but Sleeper has
 * occasionally shipped partial rows during platform incidents.
 */

function coerceInt(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

export function mapSleeperTradedPicks(
  source: SleeperImportPayload,
): NormalizedTradedPick[] {
  const raw = source.tradedPicks
  if (!Array.isArray(raw) || raw.length === 0) return []

  const out: NormalizedTradedPick[] = []
  for (const row of raw) {
    if (row == null || typeof row !== 'object') continue
    const season = coerceInt(row.season)
    const round = coerceInt(row.round)
    const originalRosterId = coerceInt(row.roster_id)
    const currentOwnerId = coerceInt(row.owner_id)
    if (
      season == null ||
      round == null ||
      originalRosterId == null ||
      currentOwnerId == null
    ) {
      continue
    }
    const previousOwnerId = coerceInt(row.previous_owner_id)
    out.push({
      season,
      round,
      original_roster_id: String(originalRosterId),
      current_owner_roster_id: String(currentOwnerId),
      previous_owner_roster_id:
        previousOwnerId != null ? String(previousOwnerId) : undefined,
    })
  }
  return out
}
