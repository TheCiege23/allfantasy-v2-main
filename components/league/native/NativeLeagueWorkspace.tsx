'use client'

import Link from 'next/link'
import { CustomizeLeagueLink } from '@/components/league/LeagueDisplayPreferences'
import { useEffect, useRef, useState } from 'react'
import { useMyLeaguesRailCollapse } from '@/hooks/useMyLeaguesRailCollapse'
import { Award, Axe, BarChart3, Bot, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Home, LayoutDashboard, List, Menu, MessageSquare, Plus, Search, Settings, Shield, Star, Swords, Trophy, Users, X, Zap, ArrowLeftRight } from 'lucide-react'
import AppShell, { type AppShellProps } from '@/app/components/AppShell'
import { LeagueMark } from '@/components/core-app/LeagueMark'
import type { UserLeague } from '@/app/dashboard/types'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { ALL_LEAGUES_DASHBOARD_HREF, leagueDashboardHref } from '@/lib/league/league-workspace-navigation'
import { buildNativeLeagueNavigation, leagueSectionHref, nativeLeaguePhase, nativeLeagueRecordLinks, type WorkspaceTab } from '@/lib/league/nativeLeagueNavigation'
import { adjacentLeagueId, unreadBadgeText } from '@/lib/league/leagueRailStatus'
import { LeagueRailRow, useLeagueRail, type LeagueRailData, type LeagueRailRowView } from './LeagueRail'
import '@/components/core-app/af-core-shell.css'
import './native-league.css'

type Props = AppShellProps & {
  native: boolean
  league: UserLeague
  leagues: UserLeague[]
  tabs: WorkspaceTab[]
  activeTab: string
  isCommissioner: boolean
  onSelectTab: (id: string) => void
  onOpenSettings: () => void
  /** Kept for callers; on phone Chimmy is now the gold #chimmy channel inside League chat. */
  onOpenChimmy?: () => void
  /** /core's rail data for every league in the list — see LeagueRail.tsx. */
  rail?: LeagueRailData | null
  /** Native guillotine leagues: the header becomes the guillotine banner (see useGuillotineAtmosphere). */
  guillotineBanner?: { line: string; mood: string } | null
}
const icons = { career: Star, rankings: Award, home: Home, team: List, matchup: Swords, players: Users, trades: ArrowLeftRight, draft: LayoutDashboard, standings: Trophy, chat: MessageSquare, settings: Settings, survivor: Shield, guillotine: Axe, war: Swords, scores: Zap, insight: Bot, more: CircleHelp }
const memoryKey = (id: string) => `af:league-section:${id}`
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'AF'

/**
 * Unread league-chat counts per league, from the chat bubble's own route (`/api/chat/unread` →
 * `byLeague`), so the rail badge and the bubble are one number. Read on mount and whenever the
 * switcher opens; a failed read just draws no badges.
 */
function useLeagueUnread(enabled: boolean, refreshKey: unknown) {
  const [byLeague, setByLeague] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!enabled) return
    let active = true
    fetch('/api/chat/unread', { credentials: 'include', cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((json: { byLeague?: Record<string, number> } | null) => { if (active && json?.byLeague) setByLeague(json.byLeague) })
      .catch(() => {})
    return () => { active = false }
  }, [enabled, refreshKey])
  return byLeague
}

const SWITCHER_GROUP_ORDER = ['needs', 'live', 'other'] as const

export function NativeLeagueWorkspace({ native, league, leagues, tabs, activeTab, isCommissioner, onSelectTab, onOpenSettings, rail, guillotineBanner = null, children, ...shell }: Props) {
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)')
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false) }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    desktop.addEventListener('change', closeOnDesktop)
    window.addEventListener('keydown', closeOnEscape)
    return () => { desktop.removeEventListener('change', closeOnDesktop); window.removeEventListener('keydown', closeOnEscape) }
  }, [])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const searchRef = useRef<HTMLInputElement>(null)
  const switcherRef = useRef<HTMLDialogElement>(null)
  const survivor = league.leagueVariant === 'survivor' || league.format.toLowerCase() === 'survivor'
  const groups = buildNativeLeagueNavigation(tabs, isCommissioner, survivor)
  const primary = groups[0]?.items ?? []
  const restoredLeague = useRef<string | null>(null)
  const phase = nativeLeaguePhase(league)
  /* The full league list is the desktop default, as on /core; collapsing to crests is remembered per tab session. */
  const railCollapse = useMyLeaguesRailCollapse({ storageKey: 'af-league-native-rail-collapsed', defaultCollapsed: false })
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1200px)')
    const sync = () => setWide(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  const railExpanded = wide && !railCollapse.collapsed
  // Poll live scores only while an expanded list is on screen — /core's `railOpen` gate.
  const railView = useLeagueRail(leagues, rail, native && !shell.embedCenterOnly && (railExpanded || switcherOpen))
  // Reading the current league's chat marks it read, so refresh the badges when the section changes too.
  const unread = useLeagueUnread(native && !shell.embedCenterOnly, `${switcherOpen}:${league.id}:${activeTab}`)

  useEffect(() => {
    if (!native) return
    try {
      if (restoredLeague.current !== league.id) {
        restoredLeague.current = league.id
        const explicit = new URLSearchParams(window.location.search)
        const previous = localStorage.getItem(memoryKey(league.id))
        if (!explicit.has('view') && !explicit.has('tab') && previous && tabs.some(tab => tab.id === previous)) { onSelectTab(previous); return }
      }
      localStorage.setItem(memoryKey(league.id), activeTab)
    } catch { /* storage is optional */ }
  }, [native, league.id, activeTab, tabs, onSelectTab])
  useEffect(() => {
    const dialog = switcherRef.current
    if (switcherOpen && dialog && !dialog.open) { dialog.showModal(); searchRef.current?.focus() }
    if (!switcherOpen && dialog?.open) dialog.close()
  }, [switcherOpen])
  useEffect(() => {
    if (!native) return
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSwitcherOpen(true) }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [native])

  if (!native) return <AppShell {...shell}>{children}</AppShell>
  const choose = (id: string) => { onSelectTab(id); setMenuOpen(false) }
  const openSwitcher = () => { setQuery(''); setSwitcherOpen(true) }
  const visibleLeagues = leagues.filter(row => {
    const hosted = isNativePlatform(row.platform)
    return row.name.toLowerCase().includes(query.toLowerCase()) && (filter === 'All' || filter === 'On AF' && hosted || filter === 'Synced' && !hosted || filter === 'Live' && nativeLeaguePhase(row) === 'Regular season')
  })
  const leagueTile = (row: UserLeague, expanded = false, onClick?: () => void, view: LeagueRailRowView = railView(row)) => <LeagueRailRow key={row.id} view={view} href={leagueSectionHref(row, activeTab)} active={row.id === league.id} expanded={expanded} isCommissioner={row.isCommissioner} onClick={onClick} unread={unread[row.id] ?? 0} />
  const chatBadge = unreadBadgeText(activeTab === 'league_chat' ? 0 : unread[league.id])
  const navGroup = (title: string, items: typeof primary) => <section key={title} className="nl-nav-group"><h2>{title}</h2>{items.map(item => {
    const Icon = icons[item.icon as keyof typeof icons] ?? CircleHelp
    const count = item.id === 'league_chat' ? chatBadge : null
    return <button key={item.id} type="button" onClick={() => choose(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}><Icon size={16} aria-hidden /><span>{item.label}</span>{count ? <span className="nl-nav-count" aria-label={`${count} unread`}>{count}</span> : null}</button>
  })}</section>
  const recordGroup = <section className="nl-nav-group" aria-label="Your record"><h2>Your record</h2>{nativeLeagueRecordLinks(league.id).map(item => {
    const Icon = icons[item.icon as keyof typeof icons] ?? CircleHelp
    return <Link key={item.id} href={item.href}><Icon size={16} aria-hidden /><span>{item.label}</span></Link>
  })}</section>
  const leagueIds = leagues.map(row => row.id)
  const stepLeague = (step: -1 | 1) => leagues.find(row => row.id === adjacentLeagueId(leagueIds, league.id, step)) ?? null
  const prevLeague = stepLeague(-1)
  const nextLeague = stepLeague(1)
  const currentView = railView(league)
  const switcherRows = visibleLeagues.map(row => ({ row, view: railView(row) }))
  const liveWeek = switcherRows.find(item => item.view.status.group === 'live')?.view.weekLabel
  const groupTitle = { needs: 'Needs you', live: liveWeek ? `Live now · ${liveWeek}` : 'Live now', other: 'Your other leagues' } as const

  return <div className={`af-core nl-workspace ${shell.embedCenterOnly ? 'nl-embedded' : ''}`} data-testid="native-league-workspace" data-rail-collapsed={railCollapse.collapsed ? 'true' : undefined} data-format={guillotineBanner ? 'guillotine' : undefined} data-guillotine-mood={guillotineBanner?.mood}>
    {!shell.embedCenterOnly && <>
      <aside className="nl-rail" aria-label="Your leagues" data-expanded={railExpanded ? 'true' : undefined}>
        <div className="nl-rail-head"><Link className="nl-brand" href={ALL_LEAGUES_DASHBOARD_HREF} aria-label="AllFantasy dashboard">AF</Link><button type="button" className="af-rail-toggle nl-rail-toggle" aria-expanded={railExpanded} aria-controls="nl-rail-leagues" onClick={railCollapse.toggle} title={railCollapse.collapsed ? 'Expand the league rail' : 'Collapse the league rail'}><span className="af-rail-toggle-icon" aria-hidden>{railCollapse.collapsed ? '»' : '«'}</span><span className="nl-rail-toggle-text">{leagues.length} {leagues.length === 1 ? 'league' : 'leagues'}</span></button></div>
        <div className="nl-rail-leagues" id="nl-rail-leagues">{leagues.map(row => leagueTile(row, railExpanded))}</div>
        <Link className="nl-add" href="/create-league" aria-label="Create a league"><Plus aria-hidden /><span className="nl-rail-toggle-text">Create a league</span></Link>
      </aside>
      <aside className={`nl-sidebar ${menuOpen ? 'nl-menu-open' : ''}`} aria-label="League navigation">
        <Link className="nl-back" href={ALL_LEAGUES_DASHBOARD_HREF}><ChevronLeft size={16} aria-hidden /> All leagues</Link>
        <div className="nl-nav-league"><span className="nl-initial">{initials(league.name)}</span><div><strong>{league.name}</strong><span className="nl-eyebrow">{phase}</span></div></div>
        {groups.map(group => navGroup(group.title, group.items))}
        {recordGroup}
        {!native && <Link className="nl-back" href={leagueDashboardHref(league.id)}><BarChart3 size={16} aria-hidden /> League Dashboard</Link>}
        <CustomizeLeagueLink returnTo={`/league/${encodeURIComponent(league.id)}`} className="nl-back" />
        <Link className="nl-back" href="/settings"><Settings size={16} aria-hidden /> Your settings</Link>
      </aside>
      <header className="nl-mobile-top"><button type="button" onClick={() => setMenuOpen(value => !value)} aria-expanded={menuOpen} aria-label={menuOpen ? 'Close league navigation' : 'Open league navigation'}>{menuOpen ? <X aria-hidden /> : <Menu aria-hidden />}</button><div className="nl-mobile-pill">{prevLeague ? <Link className="nl-mobile-step" href={leagueSectionHref(prevLeague, activeTab)} aria-label={`Previous league: ${prevLeague.name}`}><ChevronLeft size={18} aria-hidden /></Link> : null}<button type="button" className="nl-mobile-league" onClick={openSwitcher} aria-label={`${league.name}, switch league`} data-ring={currentView.status.tone ?? undefined}><span className="nl-mobile-crest" data-ring={currentView.status.tone ?? undefined}><LeagueMark src={currentView.imageUrl ?? league.logoUrl} letter={initials(league.name)} className="nl-heading-image" /></span><span className="nl-mobile-name">{league.name}</span><span className="nl-rail-tag nl-mobile-tag" data-platform={currentView.platform}>{currentView.platformLabel}</span><ChevronDown size={16} aria-hidden /></button>{nextLeague ? <Link className="nl-mobile-step" href={leagueSectionHref(nextLeague, activeTab)} aria-label={`Next league: ${nextLeague.name}`}><ChevronRight size={18} aria-hidden /></Link> : null}</div></header>
    </>}
    <div className="nl-main">
      {!shell.embedCenterOnly && <header className="nl-topbar"><button type="button" className="nl-viewing" onClick={openSwitcher}><span>Viewing</span><strong>{league.name}</strong><ChevronDown size={14} aria-hidden /></button><button type="button" className="nl-search" onClick={openSwitcher}><Search size={16} aria-hidden /><span>Jump to a league</span><kbd>⌘K</kbd></button><span className="nl-chip nl-accent">Hosted on AF · Beta</span><span className="nl-sport-week">{league.sport}{league.currentWeek ? ` · Wk ${league.currentWeek}` : ` · ${league.season ?? ''}`}</span></header>}
      <div className="nl-content">
        <header className="nl-league-heading" data-format={guillotineBanner ? 'guillotine' : undefined} data-testid={guillotineBanner ? 'guillotine-league-banner' : undefined}>{guillotineBanner && <img className="nl-guillotine-art" src="/artwork/tournaments/specialty/guillotine/assets/banner.svg" alt="" aria-hidden />}<span className="nl-heading-avatar"><LeagueMark src={currentView.imageUrl ?? league.logoUrl} letter={initials(league.name)} className="nl-heading-image" /></span><div className="nl-heading-name"><div className="nl-badges"><span className="nl-chip nl-accent">Native on AllFantasy</span>{guillotineBanner && <span className="nl-chip nl-guillotine-chip">Guilly</span>}{isCommissioner && <span className="nl-chip nl-gold">Commissioner</span>}</div><h1>{league.name}</h1>{guillotineBanner?.line && <p className="nl-guillotine-line" data-testid="guillotine-banner-line">{guillotineBanner.line}</p>}<p>{league.sport} · {league.season} · {league.teamCount} teams · {league.scoring || league.format}</p></div><button type="button" className="nl-button" aria-label="League settings" onClick={onOpenSettings}><Settings size={16} aria-hidden /><span>League settings</span></button><ol className="nl-phase" aria-label="League progress">{(survivor ? ['Setup', 'Draft', 'Island', 'Finale', 'Complete'] : ['Setup', 'Draft', 'Regular season', 'Playoffs', 'Offseason']).map(label => <li key={label} aria-current={(survivor ? ({ 'Regular season': 'Island', Playoffs: 'Finale', Offseason: 'Complete' } as Record<string, string>)[phase] ?? phase : phase) === label ? 'step' : undefined}>{label}</li>)}</ol></header>
        <label className="nl-section-picker"><span>Section</span><select aria-label="League section" value={activeTab} onChange={event => choose(event.target.value)}>{!groups.some(group => group.items.some(item => item.id === activeTab)) && <option value={activeTab}>Current section</option>}{groups.map(group => <optgroup key={group.title} label={group.title}>{group.items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
        <nav className="nl-mobile-tabs" aria-label="League sections">{primary.map(item => <button key={item.id} type="button" aria-current={activeTab === item.id ? 'page' : undefined} onClick={() => choose(item.id)}>{item.label}</button>)}</nav>
        <div className="nl-tab-content">{children}</div>
      </div>
    </div>
    {!shell.embedCenterOnly && <nav className="nl-bottom-nav" aria-label="Mobile league navigation">{['native_home', 'matchups', 'roster', 'waivers', 'league_chat'].map((id, index) => {
      const item = primary.find(row => row.id === id) ?? (index === 3 ? primary.find(row => row.id === 'players') : undefined)
      if (!item) return null
      const Icon = icons[item.icon as keyof typeof icons] ?? Home
      return <button key={id} type="button" aria-current={activeTab === item.id ? 'page' : undefined} onClick={() => choose(item.id)}><Icon size={22} aria-hidden /><span>{['League', 'Matchup', 'Team', 'Players', 'Chat'][index]}</span></button>
    })}</nav>}
    <dialog ref={switcherRef} className="nl-switcher" onCancel={() => setSwitcherOpen(false)} onClose={() => setSwitcherOpen(false)} aria-label="Switch league">
      <div className="nl-switcher-title"><span className="nl-switcher-brand" aria-hidden>AF</span><h2>Your leagues</h2><button type="button" onClick={() => setSwitcherOpen(false)} aria-label="Close league switcher"><X aria-hidden /></button></div>
      <label className="nl-switcher-search"><Search size={18} aria-hidden /><input ref={searchRef} autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your leagues" aria-label="Search your leagues" /></label>
      <div className="nl-switcher-filters" aria-label="League filters">{['All', 'On AF', 'Synced', 'Live'].map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'All' ? `All ${leagues.length}` : value}</button>)}</div>
      <div className="nl-switcher-list">{switcherRows.length ? SWITCHER_GROUP_ORDER.map(group => {
        const rows = switcherRows.filter(item => item.view.status.group === group)
        if (!rows.length) return null
        return <section key={group} className="nl-switcher-group" data-group={group} aria-label={groupTitle[group]}><h3>{groupTitle[group]}</h3>{rows.map(({ row, view }) => leagueTile(row, true, () => setSwitcherOpen(false), view))}</section>
      }) : <p role="status">No leagues match your search.</p>}</div>
      <footer><Link className="nl-button nl-primary" href="/create-league">Create league</Link><Link className="nl-button" href="/import">Import league</Link></footer>
    </dialog>
  </div>
}
