/**
 * Draft brain sport coverage: Prisma-backed leagues + extended fantasy verticals.
 * Use `normalizeDraftBrainSport` for scoring adapters; do not assume NFL-only.
 */

import { type SupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'

/** Additional draft-room verticals (best ball, tournament, specialty). */
const DRAFT_BRAIN_EXTENDED_SPORTS = ['GOLF', 'NASCAR'] as const

type DraftBrainExtendedSport = (typeof DRAFT_BRAIN_EXTENDED_SPORTS)[number]

export type DraftBrainSportId = SupportedSport | DraftBrainExtendedSport | (string & {})

/** Map unknown strings to a supported league sport when possible; else preserve extended id. */
export function normalizeDraftBrainSport(raw: string | null | undefined): DraftBrainSportId {
  const u = raw?.trim()
  if (!u) return normalizeToSupportedSport(null)
  const up = u.toUpperCase()
  if ((DRAFT_BRAIN_EXTENDED_SPORTS as readonly string[]).includes(up)) return up as DraftBrainExtendedSport
  return normalizeToSupportedSport(u)
}
