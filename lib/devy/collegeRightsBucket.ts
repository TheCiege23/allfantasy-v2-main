/**
 * College rights bucket (Option B devy slice) - view model for DevyRights rows
 * joined to DevyPlayer, rendered on the league roster surface. Rights only:
 * college players carry no in-season scoring yet, and that absence is part of
 * the section's label, never a zero.
 *
 * Pure module (no prisma import) so the rows -> view-model mapping is unit
 * testable; the query lives in app/api/league/roster/route.ts because DevyRights
 * has no Prisma relation to DevyPlayer and the join is by devyPlayerId.
 */

export type CollegeRightsRowInput = {
  id: string
  devyPlayerId: string
  state: string
  seasonYear: number | null
}

export type CollegeRightsPlayerInput = {
  id: string
  name: string
  position: string
  school: string
}

export type CollegeRightsEntry = {
  rightsId: string
  devyPlayerId: string
  /** Null when no DevyPlayer row matches the rights row - rendered as a labeled absence, never an invented name. */
  player: { name: string; position: string; school: string } | null
  state: string
  stateLabel: string
  seasonYear: number | null
}

export type CollegeRightsViewModel = {
  heading: 'College rights'
  /** No in-season scoring exists for college rights yet; the label says so instead of showing 0. */
  scoringNote: 'No in-season scoring yet'
  entries: CollegeRightsEntry[]
}

/** Display labels for DevyRights.state (lifecycle documented on the model in prisma/schema.prisma). */
const STATE_LABELS: Record<string, string> = {
  NCAA_DEVY_ACTIVE: 'Active (college)',
  NCAA_DEVY_TAXI: 'College taxi',
  NCAA_DEVY_LOCKED: 'Locked',
  DECLARED: 'Declared',
  DRAFTED_RIGHTS_HELD: 'Drafted (rights held)',
  PROMOTION_ELIGIBLE: 'Promotion eligible',
  PROMOTED_TO_PRO: 'Promoted to pro',
  RETURNED_TO_SCHOOL: 'Returned to school',
  RIGHTS_EXPIRED: 'Rights expired',
  ORPHANED_RIGHTS: 'Orphaned rights',
}

/** Unknown states pass through verbatim rather than being remapped to a label that looks authoritative. */
export function collegeRightsStateLabel(state: string): string {
  return STATE_LABELS[state] ?? state
}

/** Zero rows -> null: the section is absent entirely, never an empty shell. */
export function buildCollegeRightsViewModel(
  rights: CollegeRightsRowInput[],
  players: CollegeRightsPlayerInput[],
): CollegeRightsViewModel | null {
  if (rights.length === 0) return null
  const playersById = new Map(players.map((p) => [p.id, p]))
  return {
    heading: 'College rights',
    scoringNote: 'No in-season scoring yet',
    entries: rights.map((r) => {
      const player = playersById.get(r.devyPlayerId) ?? null
      return {
        rightsId: r.id,
        devyPlayerId: r.devyPlayerId,
        player: player
          ? { name: player.name, position: player.position, school: player.school }
          : null,
        state: r.state,
        stateLabel: collegeRightsStateLabel(r.state),
        seasonYear: r.seasonYear,
      }
    }),
  }
}
