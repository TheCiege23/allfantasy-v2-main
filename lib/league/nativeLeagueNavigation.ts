import type { UserLeague } from '@/app/dashboard/types'
import { resolveLeagueHomeHrefFromListRow } from '@/lib/dashboard/league-list-destination'

export type WorkspaceTab = { id: string; label: string }
export type WorkspaceNavItem = WorkspaceTab & { icon: string }

export function nativeLeaguePhase(league: Pick<UserLeague, 'lifecycleState' | 'status'>) {
  const phase = String(league.lifecycleState || league.status || 'setup').toLowerCase()
  if (['completed', 'complete', 'offseason', 'archived', 'renewal_pending'].includes(phase)) return 'Offseason'
  if (phase === 'playoffs') return 'Playoffs'
  if (['in_season', 'in season', 'post_draft', 'active'].includes(phase)) return 'Regular season'
  if (['drafting', 'in_progress'].includes(phase)) return 'Draft'
  return 'Setup'
}

export function buildNativeLeagueNavigation(tabs: WorkspaceTab[], commissioner: boolean) {
  const used = new Set<string>()
  const item = (label: string, icon: string, ...ids: string[]): WorkspaceNavItem[] => {
    const id = ids.find(value => tabs.some(tab => tab.id === value))
    if (!id) return []
    used.add(id)
    return [{ id, label, icon }]
  }
  const primary = [
    ...item('League home', 'home', 'native_home', 'home'),
    ...item('My team', 'team', 'roster', 'team', 'squad'),
    ...item('Matchup', 'matchup', 'matchups', 'matchup', 'fixtures'),
    ...item('Players & waivers', 'players', 'waivers', 'players'),
    ...item('Trades', 'trades', 'trades', 'transfers'),
    ...item('Draft HQ', 'draft', 'draft'),
    ...item('Standings & playoffs', 'standings', 'standings', 'table'),
    ...item('League chat', 'chat', 'league_chat'),
    ...(commissioner ? item('Commissioner', 'settings', 'commissioner', 'league') : []),
  ]
  const survivor = tabs.filter(tab => tab.id.startsWith('survivor')).map(tab => {
    used.add(tab.id)
    const labels: Record<string, string> = { survivor: 'Island', survivor_tribal: 'Elimination Council', survivor_challenges: 'Challenges', survivor_ai: 'Chimmy', survivor_exile: 'Exile', survivor_jury: 'Jury & finale', survivor_commissioner: 'Survivor command' }
    return { ...tab, label: labels[tab.id] ?? tab.label.replace(/^[^\p{L}\p{N}]+/u, ''), icon: 'survivor' }
  })
  const weekly = [
    ...item('War Room', 'war', 'war_room'),
    ...item('Live scores', 'scores', 'scores'),
    ...item('Decision OS', 'insight', 'decide'),
  ]
  // Secondary tools remain reachable; role checks stay in the server and existing tab registry.
  const more = tabs.filter(tab => !used.has(tab.id) && tab.id !== 'settings' && !(tab.id === 'home' && used.has('native_home')) && (commissioner || tab.id !== 'commissioner')).map(tab => ({ ...tab, icon: 'more' }))
  return [{ title: 'This league', items: primary }, { title: 'Survivor', items: survivor }, { title: 'This week', items: weekly }, { title: 'More tools', items: more }].filter(group => group.items.length)
}

export function leagueSectionHref(league: UserLeague, view: string) {
  const href = resolveLeagueHomeHrefFromListRow(league)
  if (!href.startsWith('/league/')) return href
  return `${href}?view=${encodeURIComponent(view)}`
}
