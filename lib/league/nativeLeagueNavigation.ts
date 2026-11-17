import type { UserLeague } from '@/app/dashboard/types'
import { resolveLeagueHomeHrefFromListRow } from '@/lib/dashboard/league-list-destination'

export type WorkspaceTab = { id: string; label: string }
type WorkspaceNavItem = WorkspaceTab & { icon: string }

export function nativeLeaguePhase(league: Pick<UserLeague, 'lifecycleState' | 'status'>) {
  const phase = String(league.lifecycleState || league.status || 'setup').toLowerCase()
  if (['completed', 'complete', 'offseason', 'archived', 'renewal_pending'].includes(phase)) return 'Offseason'
  if (phase === 'playoffs') return 'Playoffs'
  if (['in_season', 'in season', 'post_draft', 'active'].includes(phase)) return 'Regular season'
  if (['drafting', 'in_progress'].includes(phase)) return 'Draft'
  return 'Setup'
}

/** A `t` from useLanguage/useOptionalLanguage: returns the key itself when it has no entry. */
type NavTranslate = (key: string) => string

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

/**
 * Big Brother tabs: id → [i18n key, English, icon]. They used to fall into "More tools" with the generic "?" icon,
 * thirteen items deep, the first one labelled "👁 Big Brother" (2026-11-07, Big Brother audit item 4). Labels match the
 * in-page view names; the group title says "Big Brother".
 */
const BIG_BROTHER_NAV: Record<string, [string, string, string]> = {
  big_brother: ['league.nav.bb.house', 'House', 'bbHouse'],
  bb_hoh: ['league.nav.bb.hoh', 'HOH', 'bbHoh'],
  bb_veto: ['league.nav.bb.veto', 'Veto', 'bbVeto'],
  bb_voting: ['league.nav.bb.voting', 'Voting', 'bbVoting'],
  bb_jury: ['league.nav.bb.jury', 'Jury', 'bbJury'],
  bb_twists: ['league.nav.bb.twists', 'Twists', 'bbTwists'],
  bb_history: ['league.nav.bb.history', 'History', 'bbHistory'],
  bb_command: ['league.nav.bb.command', 'Command', 'draft'],
}

/**
 * Tab ids that open the SAME screen (LeagueShell renders `matchups` and `matchup` from one `case`). When one of a set
 * is placed, the rest are not a second destination — they were showing as a second "Matchup" under More tools.
 */
const SAME_SCREEN_ALIASES: string[][] = [['matchups', 'matchup']]

/**
 * More-tools tabs that open a DIFFERENT screen from a main-group item they read as a copy of: `players` is the player
 * search (the main "Players & waivers" is `waivers`), `commissioner` is commissioner operations (the main
 * "Commissioner" is `settings`). Both stay reachable, always under a name of their own.
 */
const DISTINCT_LEFTOVER_LABELS: Record<string, [string, string]> = {
  players: ['league.nav.playerSearch', 'Player search'],
  commissioner: ['league.nav.commissionerTools', 'Commissioner tools'],
}

/** Icons for the known secondary tools — the ones Zombie leagues already drew — instead of the generic "?". */
const MORE_TOOL_ICONS: Record<string, string> = {
  draft_intel: 'intel',
  schedule: 'schedule',
  players: 'players',
  commissioner: 'settings',
  legacy: 'legacy',
  matchup: 'matchup',
}

/**
 * Salary Cap tabs (lib/salary-cap/workspaceTabs.ts): id → [i18n key, English, icon]. A group of their own, like
 * Survivor and Dynasty, rather than seven "?" items under More tools.
 */
const SALARY_CAP_NAV: Record<string, [string, string, string]> = {
  salary_cap: ['league.nav.cap.home', 'Cap home', 'capHome'],
  cap_dashboard: ['league.nav.cap.space', 'Cap space', 'capSpace'],
  cap_contracts: ['league.nav.cap.contracts', 'Contracts', 'capContracts'],
  cap_team_builder: ['league.nav.cap.teamBuilder', 'Team builder', 'capBuilder'],
  cap_auction: ['league.nav.cap.auction', 'Startup auction', 'capAuction'],
  cap_ai: ['league.nav.cap.ai', 'Cap AI', 'insight'],
  cap_rules: ['league.nav.cap.rules', 'Cap rules', 'capRules'],
}

/** Group ids are stable across languages; `title` is what the reader sees. */
type NativeNavGroupId = 'league' | 'dynasty' | 'survivor' | 'bigbrother' | 'salarycap' | 'week' | 'more'

export function buildNativeLeagueNavigation(tabs: WorkspaceTab[], commissioner: boolean, isSurvivor = false, t?: NavTranslate) {
  const tr = translator(t)
  const used = new Set<string>()
  const item = (key: string, english: string, icon: string, ...ids: string[]): WorkspaceNavItem[] => {
    // A tab already placed under another group is not a second destination.
    const id = ids.find(value => !used.has(value) && tabs.some(tab => tab.id === value))
    if (!id) return []
    used.add(id)
    return [{ id, label: tr(key, english), icon }]
  }
  const primary = [
    /*
     * An imported league has no native_home: its landing is the Decide screen (this week's clocks, record,
     * standings, needs-your-call). It takes the League home slot so imported and native leagues read the
     * same (2026-11-09), and so it is not offered a second time as Decision OS below.
     */
    ...item('league.nav.leagueHome', 'League home', 'home', 'native_home', 'home', 'decide'),
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
    // Devy leagues only (lib/devy/workspaceTab.ts): the Devy home — pipeline, promotions, devy draft center.
    ...item('league.nav.devyPipeline', 'Devy pipeline', 'devy', 'devy'),
  ]
  const survivor = tabs.filter(tab => tab.id.startsWith('survivor')).map(tab => {
    used.add(tab.id)
    const known = SURVIVOR_NAV_LABELS[tab.id]
    return { ...tab, label: known ? tr(known[0], known[1]) : tab.label.replace(/^[^\p{L}\p{N}]+/u, ''), icon: 'survivor' }
  })
  const bigBrother = tabs.filter(tab => tab.id in BIG_BROTHER_NAV).map(tab => {
    used.add(tab.id)
    const [key, english, icon] = BIG_BROTHER_NAV[tab.id]
    return { id: tab.id, label: tr(key, english), icon }
  })
  const salaryCap = tabs.filter(tab => tab.id in SALARY_CAP_NAV).map(tab => {
    used.add(tab.id)
    const [key, english, icon] = SALARY_CAP_NAV[tab.id]
    return { id: tab.id, label: tr(key, english), icon }
  })
  for (const set of SAME_SCREEN_ALIASES) if (set.some(id => used.has(id))) for (const id of set) used.add(id)
  const weekly = [
    ...item('league.nav.warRoom', 'War Room', 'war', 'war_room'),
    ...item('league.nav.liveScores', 'Live scores', 'scores', 'scores'),
    ...item('league.nav.decisionOs', 'Decision OS', 'insight', 'decide'),
  ]
  // Secondary tools remain reachable; role checks stay in the server and existing tab registry.
  const more = tabs
    .filter(tab => !used.has(tab.id) && tab.id !== 'settings' && !(tab.id === 'home' && used.has('native_home')) && (commissioner || tab.id !== 'commissioner'))
    .map(tab => {
      const distinct = DISTINCT_LEFTOVER_LABELS[tab.id]
      const label = distinct ? tr(distinct[0], distinct[1]) : tab.label
      return { ...tab, label, icon: MORE_TOOL_ICONS[tab.id] ?? 'more' }
    })
  const groups: Array<{ id: NativeNavGroupId; title: string; items: WorkspaceNavItem[] }> = [
    { id: 'league', title: tr('league.nav.group.thisLeague', 'This league'), items: primary },
    { id: 'dynasty', title: tr('league.nav.group.dynasty', 'Dynasty'), items: dynasty },
    { id: 'survivor', title: tr('league.nav.group.survivor', 'Survivor'), items: survivor },
    { id: 'bigbrother', title: tr('league.nav.group.bigBrother', 'Big Brother'), items: bigBrother },
    { id: 'salarycap', title: tr('league.nav.group.salaryCap', 'Salary cap'), items: salaryCap },
    { id: 'week', title: tr('league.nav.group.thisWeek', 'This week'), items: weekly },
    { id: 'more', title: tr('league.nav.group.moreTools', 'More tools'), items: more },
  ]
  return groups.filter(group => group.items.length)
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
