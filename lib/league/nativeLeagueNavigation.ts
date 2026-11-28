import type { UserLeague } from '@/app/dashboard/types'
import { resolveLeagueHomeHrefFromListRow } from '@/lib/dashboard/league-list-destination'
import { leagueSwitchHref } from '@/lib/league/leagueSwitchHref'

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
 * The head-to-head tab ids a guillotine league does not show: its Chop tab is that screen (see `guilly` in
 * buildNativeLeagueNavigation). LeagueShell reads this list to send a link to any of them to the Chop page.
 */
export const GUILLY_MATCHUP_ALIASES: readonly string[] = ['matchups', 'matchup', 'fixtures']

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
  cap_ai: ['league.nav.cap.ai', 'Cap Chimmy', 'insight'],
  cap_rules: ['league.nav.cap.rules', 'Cap rules', 'capRules'],
}

/** Group ids are stable across languages; `title` is what the reader sees. */
type NativeNavGroupId = 'league' | 'dynasty' | 'survivor' | 'bigbrother' | 'salarycap'

/**
 * One sidebar entry. A top tab (Matchup, Team, League, …) carries its sub-tabs in `children`, which the workspace
 * draws as a tab strip above the screen; `id` is the sub-tab it opens first. A format item (Dynasty hub, Island, …)
 * is its own only child.
 */
export type NativeNavTab = WorkspaceNavItem & { children: WorkspaceNavItem[] }
export type NativeNavGroup = { id: NativeNavGroupId; title: string; items: NativeNavTab[] }

/** The top tab a sub-tab belongs to (`children` includes it), or null when no sidebar entry reaches it. */
export function nativeNavTabFor(groups: NativeNavGroup[], tabId: string): NativeNavTab | null {
  for (const group of groups) for (const item of group.items) if (item.children.some(child => child.id === tabId)) return item
  return null
}

/** Every screen the sidebar reaches, sub-tabs included: what "is this tab still reachable" means now. */
export function nativeNavLeafIds(groups: NativeNavGroup[]): string[] {
  return groups.flatMap(group => group.items.flatMap(item => item.children.map(child => child.id)))
}

export type NativeNavOptions = {
  /**
   * The draft is over (regular season, playoffs or offseason). Until then Draft is a top tab of its own; after it,
   * Draft HQ moves under League, where the draft results live.
   */
  draftDone?: boolean
  /**
   * False only while a league hosted here has not drafted: its schedule is generated when the draft ends, so
   * there is no Matchup yet. Imported leagues (the host makes the schedule) and callers that omit it keep Matchup.
   */
  scheduleMade?: boolean
}

/**
 * The league sidebar, following Sleeper's six tabs (owner's decision 2026-11-17, docs/league-page/SLEEPER_TABS_PLAN.md,
 * and 2026-11-19: "Sleeper's six only"): Matchup · Team · League · Trade · News · Settings, plus Draft until the draft
 * is done. The 21 flat items the sidebar used to list (four groups: This league, This week, More tools, Your record)
 * are sub-tabs of those, with the same tab ids, so every deep link (`?view=…`) still opens the same screen.
 *
 * Format groups (Dynasty, Survivor, Big Brother, Salary cap) stay groups of their own, below the six.
 */
export function buildNativeLeagueNavigation(tabs: WorkspaceTab[], commissioner: boolean, isSurvivor = false, t?: NavTranslate, options: NativeNavOptions = {}): NativeNavGroup[] {
  const tr = translator(t)
  const used = new Set<string>()
  const item = (key: string, english: string, icon: string, ...ids: string[]): WorkspaceNavItem[] => {
    const id = ids.find(value => tabs.some(tab => tab.id === value))
    if (!id) return []
    used.add(id)
    return [{ id, label: tr(key, english), icon }]
  }
  /** A top tab from its sub-tabs; no sub-tab, no tab. */
  const top = (key: string, english: string, icon: string, children: WorkspaceNavItem[]): NativeNavTab[] =>
    children.length ? [{ id: children[0].id, label: tr(key, english), icon, children }] : []
  const solo = (items: WorkspaceNavItem[]): NativeNavTab[] => items.map(entry => ({ ...entry, children: [entry] }))

  /*
   * Keepers (2026-11-22, keeper audit item 5): LeagueShell adds a `keeper` tab only while a keeper league's keeper
   * window is open, the one thing every manager has to do then. It leads "This league" as a tab of its own, as Draft
   * does before the draft, where it used to fall to the end of League's sub-tabs (after Legacy, clipped on a phone).
   */
  const keepers = solo(item('league.nav.keepers', 'Keepers', 'career', 'keeper'))
  const draftHq = () => item('league.nav.draftHq', 'Draft HQ', 'draft', 'draft')
  const draftTab = options.draftDone ? [] : top('league.nav.tab.draft', 'Draft', 'draft', draftHq())
  /*
   * A guillotine league has no opponent, so it has no Matchup: its first tab is Chop, as Sleeper's is (owner's
   * decision, 2026-11-25 — "too many tabs"). The Chop page IS the matchup screen there (one list, the whole
   * league against the chop line), so the head-to-head tab is not offered as a second sub-tab beside it.
   * LeagueShell sends a `matchups` link in such a league to the Chop page, so nothing that opens it is lost.
   */
  const guilly = tabs.some(tab => tab.id === 'guillotine')
  if (guilly) for (const id of GUILLY_MATCHUP_ALIASES) used.add(id)
  /*
   * No Matchup until the draft is done (owner, 2026-11-28: "the system auto creates the schedule after the
   * draft concludes, not before"). Before it there is no schedule to show, so neither the tab nor any of its
   * ids appears; a deep link to one gets LeagueShell's "after the draft" note.
   */
  const noSchedule = options.scheduleMade === false
  if (noSchedule) for (const id of [...GUILLY_MATCHUP_ALIASES, 'guillotine', 'scores', 'schedule']) used.add(id)
  const matchup = noSchedule ? [] : top(guilly ? 'league.nav.tab.chop' : 'league.nav.tab.matchup', guilly ? 'Chop' : 'Matchup', guilly ? 'guillotine' : 'matchup', [
    ...item('league.nav.chop', 'Chop', 'guillotine', 'guillotine'),
    ...(guilly ? [] : item('league.nav.matchup', 'Matchup', 'matchup', 'matchups', 'matchup', 'fixtures')),
    ...item('league.nav.liveScores', 'Live scores', 'scores', 'scores'),
    ...item('league.nav.schedule', 'Schedule', 'schedule', 'schedule'),
    ...item('league.nav.warRoom', 'War Room', 'war', 'war_room'),
  ])
  const team = top('league.nav.tab.team', 'Team', 'team', [
    ...item('league.nav.myTeam', 'My team', 'team', 'roster', 'team', 'squad'),
    ...item('league.nav.playersWaivers', 'Players & waivers', 'players', 'waivers'),
    ...item('league.nav.playerSearch', 'Player search', 'players', 'players'),
    ...item('league.nav.myPicks', 'My picks', 'picks', 'my-picks'),
    ...item('league.nav.chimmyCoaching', 'Chimmy Coaching', 'insight', 'ai_coaching'),
  ])
  /*
   * An imported league has no League home tab: its first page is Decide (What's next, record, standing, standings),
   * which is that league's overview. It sits where native leagues keep theirs, under League, rather than as a Trade
   * sub-tab it would open on (2026-11-22, imported leagues moved into this workspace).
   */
  const nativeOverview = item('league.nav.overview', 'Overview', 'home', 'native_home', 'home')
  const overview = nativeOverview.length ? nativeOverview : item('league.nav.overview', 'Overview', 'home', 'decide')
  /*
   * League is Sleeper-simple (owner, 2026-11-25): it opens on Standings & playoffs, then History.
   * After the draft the finished draft lives ONLY in History (owner: "only from history"): Draft HQ is
   * no longer a League sub-tab, and `draft` is marked used so it cannot fall in as a leftover tab.
   * History links to the draft results page. The League overview stays reachable, last.
   */
  if (options.draftDone) used.add('draft')
  // Survivor and guillotine seasons end with the last team standing: neither has playoffs to name here.
  const standingsItem = isSurvivor || guilly ? item('league.nav.standings', 'Standings', 'standings', 'standings', 'table') : item('league.nav.standingsPlayoffs', 'Standings & playoffs', 'standings', 'standings', 'table')
  /*
   * A league hosted here: League is ONE page (owner, 2026-11-27: "those 3 things are the only things on the
   * league page") — this week's matchups, the standings and the activity, as Sleeper's League tab. History
   * is a link at the bottom of that page, chat is in the bottom bar, and the old overview is retired from
   * the nav. They are marked used so none of them comes back as a leftover sub-tab; each still opens by its
   * id. An imported league keeps its sub-tabs: its standings tab is a different screen.
   */
  const onePage = nativeOverview.length > 0 && standingsItem.length > 0
  // Chat lives in the chat bubble, never in the nav (owner, 2026-11-28).
  used.add('league_chat')
  if (onePage) for (const id of ['legacy', 'history', 'activity', 'league_chat', 'native_home', 'home']) used.add(id)
  /*
   * The older redraft screens a hosted redraft league still carries (LeagueTabs: Redraft hub, My Team, League)
   * repeat the Team and League tabs, and fell into League as leftover sub-tabs — the row the owner asked to
   * remove (live check, 2026-11-27). They still open by id. Finance (dues tracking) is real: it moves to Settings.
   */
  if (onePage) for (const id of ['redraft', 'team', 'league']) used.add(id)
  const leagueChildren = onePage
    ? standingsItem
    : [
        ...standingsItem,
        ...item('league.nav.leagueHistory', 'League history', 'legacy', 'legacy', 'history'),
        ...item('league.nav.activity', 'Activity', 'more', 'activity'),
        ...overview,
      ]
  const trade = top('league.nav.tab.trade', 'Trade', 'trades', [
    ...item('league.nav.trades', 'Trades', 'trades', 'trades', 'transfers'),
    ...(used.has('decide') ? [] : item('league.nav.decisionOs', 'Decision OS', 'insight', 'decide')),
  ])
  const news = top('league.nav.tab.news', 'News', 'intel', [
    ...item('league.nav.news', 'News', 'intel', 'news'),
    ...item('league.nav.liveIntel', 'Live Intel', 'intel', 'draft_intel'),
  ])
  // Native Settings is the League Settings page, read-only for members (LeagueShell); commissioner tools are theirs only.
  const settings = top('league.nav.tab.settings', 'Settings', 'settings', [
    ...item('league.nav.leagueSettings', 'League settings', 'settings', 'settings'),
    ...(commissioner ? item('league.nav.commissionerTools', 'Commissioner tools', 'settings', 'commissioner') : []),
    ...(onePage ? item('league.nav.finance', 'Finance', 'capHome', 'finance') : []),
  ])
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
  /*
   * Any other tab (a format's own screen such as the Pirate Deck, or one added later) is still reachable: it becomes a
   * sub-tab of League, which is where Sleeper keeps the rest of the league. It used to be a "More tools" item. Role
   * checks stay in the server and in LeagueShell's tab list; Settings and Commissioner tools are placed above.
   */
  const rest: WorkspaceNavItem[] = tabs
    .filter(tab => !used.has(tab.id) && tab.id !== 'settings' && tab.id !== 'commissioner' && !(tab.id === 'home' && used.has('native_home')))
    .map(tab => {
      used.add(tab.id)
      const distinct = DISTINCT_LEFTOVER_LABELS[tab.id]
      return { id: tab.id, label: distinct ? tr(distinct[0], distinct[1]) : tab.label, icon: MORE_TOOL_ICONS[tab.id] ?? 'more' }
    })
  const league = top('league.nav.tab.league', 'League', 'standings', [...leagueChildren, ...rest])
  const groups: NativeNavGroup[] = [
    { id: 'league', title: tr('league.nav.group.thisLeague', 'This league'), items: [...keepers, ...draftTab, ...matchup, ...team, ...league, ...trade, ...news, ...settings] },
    { id: 'dynasty', title: tr('league.nav.group.dynasty', 'Dynasty'), items: solo(dynasty) },
    { id: 'survivor', title: tr('league.nav.group.survivor', 'Survivor'), items: solo(survivor) },
    { id: 'bigbrother', title: tr('league.nav.group.bigBrother', 'Big Brother'), items: solo(bigBrother) },
    { id: 'salarycap', title: tr('league.nav.group.salaryCap', 'Salary cap'), items: solo(salaryCap) },
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

/**
 * The rail, ⌘K switcher and phone prev/next link: the other league, on the page open now. An imported target opens the
 * matching /core screen (lib/league/leagueSwitchHref.ts), where it used to drop the page and open /core's front page. A
 * tournament hub row keeps its own destination.
 */
export function leagueSectionHref(league: UserLeague, view: string) {
  const href = resolveLeagueHomeHrefFromListRow(league)
  const native = /^\/league\/([^/?#]+)$/.exec(href)
  const imported = /^\/core\?league=([^&#]+)$/.exec(href)
  const id = native?.[1] ?? imported?.[1]
  if (!id) return href
  return leagueSwitchHref({ id: decodeURIComponent(id), platform: native ? 'allfantasy' : 'imported' }, { view })
}

/**
 * The tab a league opens on when the URL names none (owner, 2026-11-25):
 * - before and during the draft, the first top tab — Draft (or Keepers while a keeper window is open);
 * - after the draft, the first top tab — Matchup (Chop in a guillotine league).
 *
 * 🛑 AFTER THE DRAFT THE MATCHUP ALWAYS WINS (owner, 2026-11-28: "The first screen should be the matchup
 * screen if the draft happens already. When I opened the league, roster was first"). The tab last open in
 * a league used to win in every phase (owner, 2026-11-19: "it resets to home"), so a manager who had last
 * looked at the roster reopened a drafted league on the roster. Now the remembered tab is kept only before
 * and during the draft; once the league has drafted, every fresh open lands on its matchup.
 * Switching leagues carries `?view=` in the URL, which never reaches this function, so a deliberate
 * jump to another league's roster still opens the roster.
 */
export function nativeLeagueLandingTab(input: {
  remembered: string | null
  firstTopTabId: string | null
  draftDone: boolean
}): string | null {
  if (input.draftDone) return input.firstTopTabId
  const remembered = input.remembered?.trim() || null
  const stale = !remembered || remembered === 'native_home' || remembered === 'home' || remembered === 'decide'
  return stale ? input.firstTopTabId : remembered
}
