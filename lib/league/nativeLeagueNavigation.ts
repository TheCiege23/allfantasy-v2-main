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

/** A `t` from useLanguage/useOptionalLanguage: returns the key itself when it has no entry. */
export type NavTranslate = (key: string) => string

/** English fallback when no `t` is passed or the key is missing, so a server render or a test never shows a raw key. */
function translator(t?: NavTranslate) {
  return (key: string, english: string) => {
    if (!t) return english
    const value = t(key)
    return value && value !== key ? value : english
  }
}

/** Survivor tabs: id → [i18n key, English]. */
const SURVIVOR_NAV_LABELS: Record<string, [string, string]> = {
  survivor: ['league.nav.survivor.island', 'Island'],
  survivor_tribal: ['league.nav.survivor.tribal', 'Elimination Council'],
  survivor_challenges: ['league.nav.survivor.challenges', 'Challenges'],
  survivor_ai: ['league.nav.survivor.chimmy', 'Chimmy'],
  survivor_chimmy: ['league.nav.survivor.chimmy', 'Chimmy'],
  survivor_exile: ['league.nav.survivor.exile', 'Exile'],
  survivor_jury: ['league.nav.survivor.jury', 'Jury & finale'],
  survivor_commissioner: ['league.nav.survivor.commissioner', 'Survivor command'],
  survivor_command: ['league.nav.survivor.command', 'Commissioner hub'],
}

/** Group ids are stable across languages; `title` is what the reader sees. */
export type NativeNavGroupId = 'league' | 'dynasty' | 'survivor' | 'week' | 'more'

/** Keep aliases out of More when a primary screen already covers them. */
function duplicateOfPrimary(id: string, used: ReadonlySet<string>) {
  if (id === 'home') return used.has('native_home')
  if (id === 'team') return used.has('roster') || used.has('squad')
  return id === 'redraft' || id === 'draft_intel'
}

const MORE_LABELS: Record<string, [string, string]> = {
  players: ['league.nav.more.playerResearch', 'Player research'],
  league: ['league.nav.more.leagueOverview', 'League overview'],
  commissioner: ['league.nav.more.commissionerHub', 'Commissioner hub'],
  finance: ['league.nav.more.leagueDues', 'League dues'],
  ai_coaching: ['league.nav.more.chimmyCoaching', 'Chimmy coaching'],
  history: ['league.nav.more.pastSeasons', 'Past seasons'],
  legacy: ['league.nav.more.leagueHistory', 'League history'],
}

export function buildNativeLeagueNavigation(tabs: WorkspaceTab[], commissioner: boolean, isSurvivor = false, t?: NavTranslate) {
  const tr = translator(t)
  const used = new Set<string>()
  const item = (key: string, english: string, icon: string, ...ids: string[]): WorkspaceNavItem[] => {
    const id = ids.find(value => tabs.some(tab => tab.id === value))
    if (!id) return []
    used.add(id)
    return [{ id, label: tr(key, english), icon }]
  }
  const primary = [
    ...item('league.nav.leagueHome', 'League home', 'home', 'native_home', 'home'),
    // A guillotine league's defining screen (chop line, danger zone, history) sat under "More tools".
    ...item('league.nav.guilly', 'Guilly', 'guillotine', 'guillotine'),
    ...item('league.nav.myTeam', 'My team', 'team', 'roster', 'team', 'squad'),
    ...item('league.nav.matchup', 'Matchup', 'matchup', 'matchups', 'matchup', 'fixtures'),
    ...item('league.nav.playersWaivers', 'Players & waivers', 'players', 'waivers', 'players'),
    ...item('league.nav.trades', 'Trades', 'trades', 'trades', 'transfers'),
    ...item('league.nav.draftHq', 'Draft HQ', 'draft', 'draft'),
    ...(isSurvivor ? item('league.nav.standings', 'Standings', 'standings', 'standings', 'table') : item('league.nav.standingsPlayoffs', 'Standings & playoffs', 'standings', 'standings', 'table')),
    ...item('league.nav.leagueChat', 'League chat', 'chat', 'league_chat'),
    // Commissioner lands on the League Settings page (?view=settings); the old commissioner tab stays under More tools.
    ...(commissioner ? item('league.nav.commissioner', 'Commissioner', 'settings', 'settings', 'commissioner', 'league') : []),
  ]
  /*
   * Dynasty / Taxi / Picks used to fall into "More tools" with the generic icon. The tabs only exist when
   * LeagueShell's tab list says the league is dynasty (isDynastyLeague), so this group needs no check of its own.
   */
  const dynasty = [
    ...item('league.nav.dynasty', 'Dynasty hub', 'dynasty', 'dynasty'),
    ...item('league.nav.dynastyTaxi', 'Taxi squad', 'taxi', 'dynasty_taxi'),
    ...item('league.nav.dynastyPicks', 'Draft picks', 'picks', 'dynasty_picks'),
  ]
  const survivor = tabs.filter(tab => tab.id.startsWith('survivor')).map(tab => {
    used.add(tab.id)
    const known = SURVIVOR_NAV_LABELS[tab.id]
    return { ...tab, label: known ? tr(known[0], known[1]) : tab.label.replace(/^[^\p{L}\p{N}]+/u, ''), icon: 'survivor' }
  })
  const weekly = [
    ...item('league.nav.warRoom', 'War Room', 'war', 'war_room'),
    ...item('league.nav.liveScores', 'Live scores', 'scores', 'scores'),
    ...item('league.nav.decisionOs', 'Decision OS', 'insight', 'decide'),
  ]
  // Secondary tools remain reachable; role checks stay in the server and existing tab registry.
  const more = tabs
    .filter(tab => !used.has(tab.id) && tab.id !== 'settings' && (commissioner || tab.id !== 'commissioner') && !duplicateOfPrimary(tab.id, used))
    .map(tab => {
      const copy = MORE_LABELS[tab.id]
      return { ...tab, label: copy ? tr(copy[0], copy[1]) : tab.label.replace(/^[^\p{L}\p{N}]+/u, ''), icon: 'more' }
    })
  const groups: Array<{ id: NativeNavGroupId; title: string; items: WorkspaceNavItem[] }> = [
    { id: 'league', title: tr('league.nav.group.thisLeague', 'This league'), items: primary },
    { id: 'dynasty', title: tr('league.nav.group.dynasty', 'Dynasty'), items: dynasty },
    { id: 'survivor', title: tr('league.nav.group.survivor', 'Survivor'), items: survivor },
    { id: 'week', title: tr('league.nav.group.thisWeek', 'This week'), items: weekly },
    { id: 'more', title: tr('league.nav.group.moreTools', 'More tools'), items: more },
  ]
  return groups.filter(group => group.items.length)
}

/** Five daily phone destinations from the league's registered tabs. */
export function nativeLeagueBottomTabs(groups: ReadonlyArray<{ items: WorkspaceNavItem[] }>, phase: string, t?: NavTranslate): WorkspaceNavItem[] {
  const tr = translator(t)
  const all = groups.flatMap(group => group.items)
  const find = (...ids: string[]) => ids.map(id => all.find(item => item.id === id)).find(Boolean)
  const preDraft = phase === 'Setup' || phase === 'Draft'
  const slots: Array<[WorkspaceNavItem | undefined, string]> = [
    [find('native_home', 'home'), tr('nativeLeague.bottom.league', 'League')],
    preDraft && find('draft') ? [find('draft'), tr('nativeLeague.bottom.draft', 'Draft')] : [find('guillotine', 'survivor', 'matchups', 'matchup', 'fixtures'), ''],
    [find('roster', 'team', 'squad'), tr('nativeLeague.bottom.team', 'Team')],
    [find('waivers', 'players'), tr('nativeLeague.bottom.players', 'Players')],
    [find('league_chat'), tr('nativeLeague.bottom.chat', 'Chat')],
  ]
  const short: Record<string, string> = {
    guillotine: tr('league.nav.guilly', 'Guilly'), survivor: tr('league.nav.survivor.island', 'Island'),
    matchups: tr('nativeLeague.bottom.matchup', 'Matchup'), matchup: tr('nativeLeague.bottom.matchup', 'Matchup'),
    fixtures: tr('league.nav.fixtures', 'Fixtures'),
  }
  const out: WorkspaceNavItem[] = []
  for (const [item, label] of slots) {
    if (item && !out.some(row => row.id === item.id)) out.push({ ...item, label: label || short[item.id] || item.label })
  }
  return out
}

/** The "Your record" group heading (see nativeLeagueRecordLinks). */
export function nativeLeagueRecordTitle(t?: NavTranslate) {
  return translator(t)('league.nav.group.yourRecord', 'Your record')
}

/**
 * Handoff §2's third nav group, "Your record". These are /core screens, not league tabs, so they are
 * links (the same hrefs /core's own rail builds: `/core/career?league=…`, `/core/rankings?league=…`).
 *
 * "This week" keeps Decision OS where the handoff drew "Season Outlook": Decision OS replaced the
 * outlook screen on 2026-10 and is the live surface; this group is added beside it, not instead of it.
 */
export function nativeLeagueRecordLinks(leagueId: string, t?: NavTranslate): Array<{ id: string; label: string; href: string; icon: string }> {
  const tr = translator(t)
  const q = `?league=${encodeURIComponent(leagueId)}`
  return [
    { id: 'career', label: tr('league.nav.yourCareer', 'Your career'), href: `/core/career${q}`, icon: 'career' },
    { id: 'rankings', label: tr('league.nav.rankings', 'Rankings'), href: `/core/rankings${q}`, icon: 'rankings' },
  ]
}

export function leagueSectionHref(league: UserLeague, view: string) {
  const href = resolveLeagueHomeHrefFromListRow(league)
  if (!href.startsWith('/league/')) return href
  return `${href}?view=${encodeURIComponent(view)}`
}
