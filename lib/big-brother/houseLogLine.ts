/**
 * Big Brother house log — the client-safe half: the entry type and the sentence for each entry.
 *
 * Kept apart from `publicHouseLog.ts` on purpose. That module builds entries from audit rows and imports
 * `publicEvictionResult` from `lib/league-specialty/bigBrotherHome`, which imports Prisma; the History panel is a
 * client component and must not pull the database layer into the browser bundle (or into its SSR pass).
 */
export type HouseLogKind =
  | 'season_start'
  | 'phase'
  | 'hoh'
  | 'nominations'
  | 'replacement'
  | 'veto'
  | 'have_nots'
  | 'eviction'
  | 'jury'
  | 'finale'

export interface PublicHouseLogEntry {
  kind: HouseLogKind
  at: string
  week: number | null
  /** The houseguests the event is about, the subject first (the evictee, the HOH, the veto winner…). */
  rosterIds: string[]
  /** `phase` only: the phase the week moved into. */
  phase?: string
  /** `nominations` / `replacement` only: set by the automation because the HOH did not act in time. */
  auto?: boolean
  /** `eviction` / `finale` only: counts, present ONLY when the league shows exact totals. */
  votesByNominee?: Record<string, number> | null
  votes?: number | null
  tied?: boolean
}

/** Phases worth a line in the log; the rest are bookkeeping between them. */
export const PUBLIC_PHASES: Record<string, string> = {
  HOH_OPEN: 'Head of Household competition opened',
  NOMINATION_LOCKED: 'Nominations locked',
  VETO_CHALLENGE_OPEN: 'Power of Veto competition opened',
  VOTING_OPEN: 'Eviction voting opened',
  VOTING_LOCKED: 'Eviction voting closed',
}

/** One readable line. `name` resolves a roster id; unknown ids read as "A houseguest". */
export function houseLogLine(e: PublicHouseLogEntry, name: (rosterId: string) => string | undefined): string {
  const n = (id: string | undefined) => (id && name(id)) || 'A houseguest'
  const [first, second] = e.rosterIds
  switch (e.kind) {
    case 'season_start':
      return 'The house opened'
    case 'phase':
      return PUBLIC_PHASES[e.phase ?? ''] ?? 'The week moved on'
    case 'hoh':
      return `${n(first)} won Head of Household`
    case 'nominations':
      return e.rosterIds.length > 1
        ? `${n(first)} and ${n(second)} were nominated${e.auto ? ' automatically' : ''}`
        : `${n(first)} was nominated${e.auto ? ' automatically' : ''}`
    case 'replacement':
      return `${n(first)} went on the block as the replacement${e.auto ? ' (automatic)' : ''}`
    case 'veto':
      return `${n(first)} won the Power of Veto`
    case 'have_nots':
      return `Have-Nots this week: ${e.rosterIds.map((id) => n(id)).join(', ')}`
    case 'jury':
      return `${n(first)} joined the jury`
    case 'eviction': {
      const counts = e.votesByNominee
      if (counts) {
        const tally = e.rosterIds.map((id) => counts[id] ?? 0).join('–')
        return `${n(first)} was evicted, ${tally}${e.tied ? ' (tie broken)' : ''}`
      }
      return `${n(first)} was evicted${e.tied ? ' after a tie' : ''}`
    }
    case 'finale':
      return e.votes != null ? `${n(first)} won the season with ${e.votes} jury votes` : `${n(first)} won the season`
  }
}
