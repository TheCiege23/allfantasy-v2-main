import { phaseOf, type DraftPhase } from '@/lib/core-app/draftHqAll'

/**
 * The two drafts a college + pro league runs each year, on one card: the NFL rookie draft on the pro
 * half and the college draft on the college half.
 *
 * Pure: the caller supplies what each provider holds. Neither half's board is captured as a
 * DraftSession (measured on Peach Bowl and Cream Bowl), so these read the providers' own records:
 * Sleeper's draft list for the pro half, and the draft board the Fantrax import keeps on the
 * snapshot for the college half (156 of 192 picks on Cream Bowl, 2026).
 */

export type CollegeProDraft = {
  role: 'pro' | 'college'
  season: number | null
  phase: DraftPhase
  /** "Done", "Live now", "Not started", or the provider's own word when it is not one we know. */
  status: string
  /** "4 rounds · snake", "156 of 192 picks made" … or null. */
  detail: string | null
  /** When the draft starts, when the provider has a date. ISO. */
  startsAt: string | null
}

const STATUS: Record<DraftPhase, string> = { done: 'Done', live: 'Live now', upcoming: 'Not started', unknown: 'Unknown' }

const seasonOf = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isInteger(n) && n > 1990 && n < 2100 ? n : null
}

/**
 * Sleeper's drafts for the pro half: the newest two seasons, newest first. A dynasty league usually
 * holds this year's finished draft and next year's unscheduled one.
 */
export function sleeperDraftCards(
  drafts: ReadonlyArray<{ status: string; season?: string | null; type?: string | null; start_time?: number | null; settings?: { rounds?: number | null } | null }>,
): CollegeProDraft[] {
  return drafts
    .map((d) => {
      const phase = phaseOf(d.status)
      const rounds = d.settings?.rounds
      const startsAt = typeof d.start_time === 'number' && d.start_time > 0 ? new Date(d.start_time).toISOString() : null
      return {
        role: 'pro' as const,
        season: seasonOf(d.season),
        phase,
        status: phase === 'unknown' ? d.status || STATUS.unknown : STATUS[phase],
        detail: [typeof rounds === 'number' && rounds > 0 ? `${rounds} rounds` : null, d.type || null].filter(Boolean).join(' · ') || null,
        startsAt,
      }
    })
    .sort((a, b) => (b.season ?? 0) - (a.season ?? 0))
    .slice(0, 2)
}

/** The college half's board as the Fantrax import stored it. Null when no board is on file. */
export function fantraxDraftCard(
  board: { draftState: string | null; slots: number; picks: readonly unknown[] } | null,
  season: number | null,
): CollegeProDraft | null {
  if (!board) return null
  const made = board.picks.length
  const state = String(board.draftState ?? '').toLowerCase()
  const phase: DraftPhase =
    state === 'completed' || state === 'complete' || (board.slots > 0 && made >= board.slots)
      ? 'done'
      : state === 'in_progress' || state === 'live' || state === 'drafting'
        ? 'live'
        : made === 0
          ? 'upcoming'
          : phaseOf(state)
  return {
    role: 'college',
    season,
    phase,
    status: phase === 'unknown' ? board.draftState || STATUS.unknown : STATUS[phase],
    // Fantrax can close a board with slots unused, so say how many picks were made, not "complete".
    detail: board.slots > 0 ? `${made} of ${board.slots} picks made` : made > 0 ? `${made} picks made` : null,
    startsAt: null,
  }
}
