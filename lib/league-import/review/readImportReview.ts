/**
 * Validates the `review` field of a preview response on the client.
 *
 * It crossed a network, so it is checked rather than asserted. Anything that is not a recognisable
 * review returns `null`, and the import screen falls back to its plain preview panel — an older
 * server, or a review that failed to build, must never stop an import.
 */

import type { ImportReview } from './types'

export function readImportReview(raw: unknown): ImportReview | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<ImportReview>
  if (r.version !== 1) return null
  if (!r.league || typeof r.league !== 'object' || typeof r.league.name !== 'string') return null
  if (!Array.isArray(r.teams) || !Array.isArray(r.warnings)) return null
  if (!Array.isArray(r.scoring) || !Array.isArray(r.schedule) || !Array.isArray(r.draft)) return null
  if (!Array.isArray(r.rosterSlots) || !Array.isArray(r.notImported)) return null
  if (!r.playerMatching || typeof r.playerMatching !== 'object') return null
  for (const t of r.teams) {
    if (!t || typeof t.teamId !== 'string' || !Array.isArray(t.players)) return null
  }
  return r as ImportReview
}
