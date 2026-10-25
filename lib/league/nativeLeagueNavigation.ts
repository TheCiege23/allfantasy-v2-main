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

/**
 * Tabs a native league registers that "More tools" leaves out, because a screen above already is
 * them. They stay valid tabs, so a deep link (?view=…) or a button inside a screen still opens them.
 *
 *   home         the classic home; League home replaces it
 *   team         renders the same screen as My team (roster / squad)
 *   redraft      the old season dashboard; Matchup, Standings and My team are its native screens
 *   draft_intel  the live Sleeper draft cockpit; an AllFantasy league has no Sleeper draft to read
 */
function duplicateOfPrimary(id: string, used: ReadonlySet<string>) {
  if (id === 'home') return used.has('native_home')
  if (id === 'team') return used.has('roster') || used.has('squad')
  return id === 'redraft' || id === 'draft_intel'
}

/** Plain names for the "More tools" rows; the registry's labels were written for a desktop tab strip. */
const MORE_LABELS: Record<string, string> = {
  players: 'Player research',
  league: 'League overview',
  commissioner: 'Commissioner hub',
  finance: 'League dues',
  ai_coaching: 'Chimmy coaching',
  history: 'Past seasons',
  legacy: 'League history',
}

export function buildNativeLeagueNavigation(tabs: WorkspaceTab[], commissioner: boolean, isSurvivor = false) {
  const used = new Set<string>()
  const item = (label: string, icon: string, ...ids: string[]): WorkspaceNavItem[] => {
    const id = ids.find(value => tabs.some(tab => tab.id === value))
    if (!id) return []
    used.add(id)
    return [{ id, label, icon }]
  }
  const primary = [
    ...item('League home', 'home', 'native_home', 'home'),
    // A guillotine league's defining screen (chop line, danger zone, history) sat under "More tools".
    ...item('Guilly', 'guillotine', 'guillotine'),
    ...item('My team', 'team', 'roster', 'team', 'squad'),
    ...item('Matchup', 'matchup', 'matchups', 'matchup', 'fixtures'),
    ...item('Players & waivers', 'players', 'waivers', 'players'),
    ...item('Trades', 'trades', 'trades', 'transfers'),
    ...item('Draft HQ', 'draft', 'draft'),
    ...item(isSurvivor ? 'Standings' : 'Standings & playoffs', 'standings', 'standings', 'table'),
    ...item('League chat', 'chat', 'league_chat'),
    // Commissioner lands on the League Settings page (?view=settings); the old commissioner tab stays under More tools.
    ...(commissioner ? item('Commissioner', 'settings', 'settings', 'commissioner', 'league') : []),
  ]
  const survivor = tabs.filter(tab => tab.id.startsWith('survivor')).map(tab => {
    used.add(tab.id)
    const labels: Record<string, string> = { survivor: 'Island', survivor_tribal: 'Elimination Council', survivor_challenges: 'Challenges', survivor_ai: 'Chimmy', survivor_chimmy: 'Chimmy', survivor_exile: 'Exile', survivor_jury: 'Jury & finale', survivor_commissioner: 'Survivor command', survivor_command: 'Commissioner hub' }
    return { ...tab, label: labels[tab.id] ?? tab.label.replace(/^[^\p{L}\p{N}]+/u, ''), icon: 'survivor' }
  })
  const weekly = [
    ...item('War Room', 'war', 'war_room'),
    ...item('Live scores', 'scores', 'scores'),
    ...item('Decision OS', 'insight', 'decide'),
  ]
  // Secondary tools remain reachable; role checks stay in the server and existing tab registry.
  const more = tabs
    .filter(tab => !used.has(tab.id) && tab.id !== 'settings' && (commissioner || tab.id !== 'commissioner') && !duplicateOfPrimary(tab.id, used))
    .map(tab => ({ ...tab, label: MORE_LABELS[tab.id] ?? tab.label.replace(/^[^\p{L}\p{N}]+/u, ''), icon: 'more' }))
  return [{ title: 'This league', items: primary }, { title: 'Survivor', items: survivor }, { title: 'This week', items: weekly }, { title: 'More tools', items: more }].filter(group => group.items.length)
}

/**
 * The phone's bottom tab bar: five screens a manager opens every day, then More, which opens the full
 * league menu. Built from the menu's own items so a tab the league does not have is never drawn.
 *
 * The second slot follows the league: Draft HQ before and during the draft, then the format's own
 * screen (Guilly's chop line, Survivor's Island) or, for everyone else, Matchup.
 */
export function nativeLeagueBottomTabs(groups: ReadonlyArray<{ items: WorkspaceNavItem[] }>, phase: string): WorkspaceNavItem[] {
  const all = groups.flatMap(group => group.items)
  const find = (...ids: string[]) => ids.map(id => all.find(item => item.id === id)).find(Boolean)
  const preDraft = phase === 'Setup' || phase === 'Draft'
  const slots: Array<[WorkspaceNavItem | undefined, string]> = [
    [find('native_home', 'home'), 'League'],
    preDraft && find('draft') ? [find('draft'), 'Draft'] : [find('guillotine', 'survivor', 'matchups', 'matchup', 'fixtures'), ''],
    [find('roster', 'team', 'squad'), 'Team'],
    [find('waivers', 'players'), 'Players'],
    [find('league_chat'), 'Chat'],
  ]
  const short: Record<string, string> = { guillotine: 'Guilly', survivor: 'Island', matchups: 'Matchup', matchup: 'Matchup', fixtures: 'Fixtures' }
  const out: WorkspaceNavItem[] = []
  for (const [item, label] of slots) {
    if (item && !out.some(row => row.id === item.id)) out.push({ ...item, label: label || short[item.id] || item.label })
  }
  return out
}

/**
 * Handoff §2's third nav group, "Your record". These are /core screens, not league tabs, so they are
 * links (the same hrefs /core's own rail builds: `/core/career?league=…`, `/core/rankings?league=…`).
 *
 * "This week" keeps Decision OS where the handoff drew "Season Outlook": Decision OS replaced the
 * outlook screen on 2026-10 and is the live surface; this group is added beside it, not instead of it.
 */
export function nativeLeagueRecordLinks(leagueId: string): Array<{ id: string; label: string; href: string; icon: string }> {
  const q = `?league=${encodeURIComponent(leagueId)}`
  return [
    { id: 'career', label: 'Your career', href: `/core/career${q}`, icon: 'career' },
    { id: 'rankings', label: 'Rankings', href: `/core/rankings${q}`, icon: 'rankings' },
  ]
}

export function leagueSectionHref(league: UserLeague, view: string) {
  const href = resolveLeagueHomeHrefFromListRow(league)
  if (!href.startsWith('/league/')) return href
  return `${href}?view=${encodeURIComponent(view)}`
}
