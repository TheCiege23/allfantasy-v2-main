/**
 * leagueTabGroups — slice 2B of the Broadcast Deck league redesign.
 *
 * Pure mapping that folds the league page's flat tab strip (15+ ids across
 * sports/variants) into five ordered groups: Decide · Draft · Roster · League ·
 * Legacy · Commish. Presentation-only: every existing tab id survives as a
 * sub-tab (same ids, same deep links, same testids), so no view is orphaned —
 * an unknown/new tab id simply lands in the League group instead of vanishing.
 */

export type LeagueTabGroupId = 'decide' | 'draft' | 'roster' | 'league' | 'legacy' | 'commish'

export const LEAGUE_TAB_GROUP_ORDER: { id: LeagueTabGroupId; label: string }[] = [
  { id: 'decide', label: 'Decide' },
  { id: 'draft', label: 'Draft' },
  { id: 'roster', label: 'Roster' },
  { id: 'league', label: 'League' },
  { id: 'legacy', label: 'Legacy' },
  { id: 'commish', label: 'Commish' },
]

const GROUP_BY_TAB: Record<string, LeagueTabGroupId> = {
  // Decide — the brain-first surfaces
  decide: 'decide',
  ai_coaching: 'decide',

  // Draft — live drafts + draft-adjacent views
  draft: 'draft',
  redraft: 'draft',
  draft_intel: 'draft',

  // Roster — my team + roster construction
  team: 'roster',
  roster: 'roster',
  squad: 'roster',
  keeper: 'roster',
  dynasty: 'roster',
  dynasty_taxi: 'roster',
  dynasty_picks: 'roster',
  'my-picks': 'roster',

  // Legacy — history + the AF Legacy product surface
  legacy: 'legacy',
  history: 'legacy',
  war_room: 'legacy',
  bb_history: 'legacy',

  // Commish — permissioned controls
  commissioner: 'commish',
  settings: 'commish',
  survivor_command: 'commish',
  bb_command: 'commish',
  finance: 'commish',
}

export function groupForLeagueTab(tabId: string): LeagueTabGroupId {
  return GROUP_BY_TAB[tabId] ?? 'league'
}

export type LeagueTabLike = { id: string; label: string }

export type LeagueTabGroup<T extends LeagueTabLike> = {
  id: LeagueTabGroupId
  label: string
  tabs: T[]
}

/** Fold an ordered tab list into ordered, non-empty groups (tab order preserved within each). */
/**
 * Preferred landing tab per group. Clicking a group pill opens the group's
 * FIRST tab, but tabDefs assembly can put variant hubs ahead of the primary
 * view — e.g. dynasty leagues prepend dynasty/taxi/picks when the base tab
 * list has no `redraft` anchor, so the ROSTER pill landed on the Dynasty hub
 * instead of the manager's actual roster. This stable-reorders each bucket so
 * the primary view leads (and is therefore the pill's landing tab) while
 * every other tab keeps its relative order. Presentation-only.
 */
const GROUP_LANDING_PREFERENCE: Partial<Record<LeagueTabGroupId, string[]>> = {
  roster: ['roster', 'team', 'squad'],
  draft: ['draft'],
  decide: ['decide'],
  legacy: ['legacy'],
}

function leadWithPreferred<T extends LeagueTabLike>(gid: LeagueTabGroupId, tabs: T[]): T[] {
  const pref = GROUP_LANDING_PREFERENCE[gid]
  if (!pref) return tabs
  const rank = (t: T) => {
    const i = pref.indexOf(t.id)
    return i === -1 ? pref.length : i
  }
  // Stable: Array.prototype.sort is stable in modern JS — non-preferred tabs keep their order.
  return [...tabs].sort((a, b) => rank(a) - rank(b))
}

export function buildLeagueTabGroups<T extends LeagueTabLike>(tabs: T[]): LeagueTabGroup<T>[] {
  const buckets = new Map<LeagueTabGroupId, T[]>()
  for (const tab of tabs) {
    const gid = groupForLeagueTab(tab.id)
    const list = buckets.get(gid)
    if (list) list.push(tab)
    else buckets.set(gid, [tab])
  }
  return LEAGUE_TAB_GROUP_ORDER.filter((g) => buckets.has(g.id)).map((g) => ({
    id: g.id,
    label: g.label,
    tabs: leadWithPreferred(g.id, buckets.get(g.id) as T[]),
  }))
}
