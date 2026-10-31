/**
 * The Survivor checklist on the league home for the commissioner: the handful of things that have to
 * be true for the season to run on its own, read from the commissioner dashboard payload. Pure, for
 * the card and its tests. Anything that is fine says so, so a finished checklist reads as "ready".
 */

export type SurvivorChecklistState = 'done' | 'todo' | 'waiting'
export type SurvivorChecklistItem = { id: string; label: string; detail: string; state: SurvivorChecklistState }

export type SurvivorChecklistFacts = {
  leagueSize: number | null
  claimedManagers: number
  draftScheduled: boolean
  draftStatus: string | null
  tribesDrawn: number
  exileEnabled: boolean
  exileLinked: boolean
  idolCount: number
  /** Setup problems from the dashboard (seat counts excluded; they have their own row). */
  setupIssues: string[]
}

export function survivorCommissionerChecklist(facts: SurvivorChecklistFacts): SurvivorChecklistItem[] {
  const items: SurvivorChecklistItem[] = []
  const size = facts.leagueSize ?? 0
  const open = Math.max(0, size - facts.claimedManagers)
  items.push({
    id: 'seats',
    label: 'Every seat claimed',
    detail: size === 0 ? 'Set the cast size.' : open === 0 ? `All ${size} castaways are in.` : `${open} of ${size} seats are still open. Share the invite link.`,
    state: size > 0 && open === 0 ? 'done' : 'todo',
  })
  const drafted = facts.draftStatus === 'completed' || facts.tribesDrawn > 0
  items.push({
    id: 'draft',
    label: 'Draft scheduled',
    detail: drafted ? 'The draft is done.' : facts.draftScheduled ? 'The draft has a start time. Autopick covers anyone who misses it.' : 'Pick a draft time so the season can start on its own.',
    state: drafted || facts.draftScheduled ? 'done' : 'todo',
  })
  items.push({
    id: 'tribes',
    label: 'Tribes drawn',
    detail: facts.tribesDrawn > 0 ? `${facts.tribesDrawn} tribes are on the island.` : 'Tribes are drawn automatically the moment the draft ends.',
    state: facts.tribesDrawn > 0 ? 'done' : 'waiting',
  })
  items.push({
    id: 'exile',
    label: 'Exile Island',
    detail: !facts.exileEnabled
      ? 'Off. Voted-out managers are out for good.'
      : facts.exileLinked ? 'On, and its side league is ready.' : 'On, but its side league is not linked yet. Open the commissioner hub to check it.',
    state: !facts.exileEnabled || facts.exileLinked ? 'done' : drafted ? 'todo' : 'waiting',
  })
  items.push({
    id: 'idols',
    label: 'Idols',
    detail: facts.idolCount > 0 ? `${facts.idolCount} ${facts.idolCount === 1 ? 'idol' : 'idols'} will be hidden on drafted players.` : 'No idols this season.',
    state: 'done',
  })
  items.push({
    id: 'settings',
    label: 'Settings agree',
    detail: facts.setupIssues.length === 0 ? 'League settings and the Survivor engine match.' : facts.setupIssues.join(' '),
    state: facts.setupIssues.length === 0 ? 'done' : 'todo',
  })
  return items
}

/** Dashboard readiness lines that are about seats; the checklist has its own seat row. */
export function withoutSeatIssues(issues: string[]): string[] {
  return issues.filter(issue => !/seats? still need to be claimed/i.test(issue))
}
