/** Lifecycle is more precise than the broad active/setup status on the league. */
export function leagueLifecycleLabel(lifecycleState?: string | null, status?: string | null): string {
  const labels: Record<string, string> = {
    setup: 'League setup', pre_draft: 'Pre-draft', predraft: 'Pre-draft', draft_setup: 'Draft setup',
    drafting: 'Draft in progress', in_draft: 'Draft in progress', post_draft: 'Draft complete',
    active: 'In season', in_season: 'In season', playoffs: 'Playoffs',
    completed: 'Season complete', complete: 'Season complete', offseason: 'Offseason',
    renewal_pending: 'Renewal pending', archived: 'Archived',
  }
  return labels[String(lifecycleState ?? '').trim().toLowerCase()]
    ?? labels[String(status ?? '').trim().toLowerCase()]
    ?? 'Status unavailable'
}

type ManagerSlot = {
  isOrphan?: boolean | null
  claimedByUserId?: string | null
  platformUserId?: string | null
}

/** Imported managers need not have AF accounts; generated open slots are never managers. */
export function countAssignedManagers(teams: readonly ManagerSlot[]): number {
  return teams.filter((team) => {
    if (team.isOrphan) return false
    if (team.claimedByUserId?.trim()) return true
    const owner = team.platformUserId?.trim()
    return Boolean(owner && !owner.startsWith('open-slot-'))
  }).length
}
