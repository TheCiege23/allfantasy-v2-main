'use client'

import Link from 'next/link'
import { usePathname, useParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  History,
  Home,
  LayoutGrid,
  Menu,
  MessageSquare,
  Settings,
  Target,
  Trophy,
  Wrench,
} from 'lucide-react'
import { useTournamentUi } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import { useTournamentParticipantState } from '@/lib/tournament/useTournamentParticipantState'
import { TournamentSettingsModalEditable } from '@/app/tournament/[tournamentId]/components/TournamentSettingsModalEditable'
import { TournamentEntryIntroModal } from '@/components/tournament/TournamentEntryIntroModal'
import { TournamentRenewBanner } from '@/components/tournament/TournamentRenewBanner'
import { SpecialtyLeagueAtmosphere } from '@/components/league-atmosphere/SpecialtyLeagueAtmosphere'

type NavItem = { href: string; label: string; icon: React.ReactNode; commishOnly?: boolean; desktopOnly?: boolean }

export function TournamentChrome({ children }: { children: React.ReactNode }) {
  const tournamentId = useParams<{ tournamentId: string }>()?.tournamentId ?? ''
  const pathname = usePathname()
  const currentPath = pathname ?? ''
  const ctx = useTournamentUi()
  const { shell, conferences, participant, isCommissioner, viewerUserId } = ctx
  const state = useTournamentParticipantState(ctx)

  const [collapsed, setCollapsed] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const base = `/tournament/${tournamentId}`

  const conference = useMemo(
    () => conferences.find((c) => c.id === participant?.currentConferenceId) ?? conferences[0],
    [conferences, participant?.currentConferenceId],
  )

  const primaryMobile: NavItem[] = useMemo(
    () => [
      { href: base, label: 'Home', icon: <Home className="h-5 w-5" strokeWidth={1.75} /> },
      { href: `${base}/league`, label: 'League', icon: <Target className="h-5 w-5" strokeWidth={1.75} /> },
      { href: `${base}/standings`, label: 'Standings', icon: <LayoutGrid className="h-5 w-5" strokeWidth={1.75} /> },
      { href: `${base}/forum`, label: 'Forum', icon: <MessageSquare className="h-5 w-5" strokeWidth={1.75} /> },
      { href: `${base}/progress`, label: 'Progress', icon: <Trophy className="h-5 w-5" strokeWidth={1.75} /> },
    ],
    [base],
  )

  const overflowItems: NavItem[] = useMemo(
    () => [
      { href: `${base}/drafts`, label: 'Drafts', icon: <span className="text-lg">🎲</span> },
      { href: `${base}/history`, label: 'History', icon: <History className="h-5 w-5" strokeWidth={1.75} /> },
      ...(isCommissioner
        ? ([
            {
              href: `/tournament/${tournamentId}/control`,
              label: 'Commissioner ops',
              icon: <Wrench className="h-5 w-5" strokeWidth={1.75} />,
              commishOnly: true,
            },
            {
              href: '#commissioner',
              label: 'Commissioner',
              icon: <Settings className="h-5 w-5" strokeWidth={1.75} />,
              commishOnly: true,
            },
          ] as NavItem[])
        : []),
    ],
    [base, isCommissioner, tournamentId],
  )

  const desktopNav: NavItem[] = useMemo(
    () => [
      { href: base, label: 'Tournament Home', icon: <span className="text-lg">🏆</span> },
      { href: `${base}/league`, label: 'My League', icon: <span className="text-lg">🎯</span> },
      { href: `${base}/standings`, label: 'Standings', icon: <span className="text-lg">📊</span> },
      { href: `${base}/forum`, label: 'Forum', icon: <span className="text-lg">📣</span> },
      { href: `${base}/progress`, label: 'Progress', icon: <span className="text-lg">🗺</span> },
      { href: `${base}/drafts`, label: 'Drafts', icon: <span className="text-lg">🎲</span> },
      { href: `${base}/history`, label: 'History', icon: <span className="text-lg">📜</span> },
      ...(isCommissioner
        ? ([
            {
              href: `/tournament/${tournamentId}/control`,
              label: 'Commissioner ops',
              icon: <span className="text-lg">🛠️</span>,
              commishOnly: true,
            },
            {
              href: '#commissioner',
              label: 'Commissioner',
              icon: <span className="text-lg">⚙️</span>,
              commishOnly: true,
            },
          ] as NavItem[])
        : []),
    ],
    [base, isCommissioner, tournamentId],
  )

  const eliminated = state.status === 'eliminated'
  const hideDrafts = eliminated

  const statusChip = useMemo(() => {
    if (state.status === 'bubble') return 'BUBBLE'
    if (state.status === 'advanced') return 'QUALIFIED'
    if (state.status === 'eliminated') return 'ELIMINATED'
    if (state.status === 'champion') return 'CHAMPION'
    return 'ACTIVE'
  }, [state.status])

  const statusDotClass =
    state.status === 'bubble'
      ? 'bg-[var(--tournament-bubble)]'
      : state.status === 'advanced' || state.status === 'champion'
        ? 'bg-[var(--tournament-gold)]'
        : state.status === 'eliminated'
          ? 'bg-[var(--tournament-elim)]'
          : 'bg-[var(--tournament-active)]'

  const onNav = useCallback(
    (e: React.MouseEvent, href: string) => {
      if (href === '#commissioner') {
        e.preventDefault()
        setSettingsOpen(true)
        setMoreOpen(false)
      }
    },
    [],
  )

  const atmosphereMood = useMemo(() => {
    if (currentPath.includes('/progress')) return 'championship'
    if (currentPath.includes('/drafts')) return 'bracket'
    return 'default'
  }, [currentPath])

  return (
    <>
      <SpecialtyLeagueAtmosphere variant="tournament" mood={atmosphereMood} />
      <div className="relative z-[1] flex min-h-dvh w-full">
        <aside
          className={`relative hidden shrink-0 flex-col border-r border-[var(--tournament-border)] bg-[var(--tournament-panel)]/82 backdrop-blur-xl md:flex ${
            collapsed ? 'w-16' : 'w-[220px]'
          } transition-[width] duration-200`}
        >
          <div className="flex items-center gap-2 border-b border-[var(--tournament-border)] p-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-[var(--tournament-bg)]"
              style={{
                background: `linear-gradient(135deg, var(--tournament-active), var(--tournament-accent))`,
              }}
            >
              🏆
            </div>
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-bold text-[var(--tournament-text-full)]">{shell.name}</p>
                <p className="truncate text-[10px] text-[var(--tournament-text-dim)]">{shell.sport}</p>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-white/50 hover:bg-white/5 hover:text-white"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              data-testid="tournament-sidebar-toggle"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-0.5 p-2">
            {desktopNav.map((item) => {
              if (hideDrafts && item.href.endsWith('/drafts')) return null
              const active = currentPath === item.href || (item.href !== base && currentPath.startsWith(item.href))
              return (
                <Link
                  key={item.href + item.label}
                  href={item.href.startsWith('#') ? base : item.href}
                  onClick={(e) => onNav(e, item.href)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                    active
                      ? 'bg-cyan-500/15 text-[var(--tournament-active)]'
                      : 'text-[var(--tournament-text-mid)] hover:bg-white/[0.06] hover:text-white'
                  }`}
                  data-testid={`tournament-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <span className="flex w-6 justify-center">{item.icon}</span>
                  {!collapsed ? item.label : null}
                </Link>
              )
            })}
          </nav>

          {participant && !collapsed ? (
            <div className="m-2 rounded-xl border border-[var(--tournament-border)] bg-black/20 p-3">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 overflow-hidden rounded-full bg-white/10 text-center text-[11px] leading-9 text-white/70">
                  {participant.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={participant.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    participant.displayName.slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-white">{participant.displayName}</p>
                  <span
                    className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide ${
                      statusChip === 'BUBBLE'
                        ? 'bg-amber-500/20 text-amber-200'
                        : statusChip === 'QUALIFIED' || statusChip === 'CHAMPION'
                          ? 'bg-yellow-500/15 text-yellow-200'
                          : statusChip === 'ELIMINATED'
                            ? 'bg-white/10 text-white/50'
                            : 'bg-cyan-500/15 text-cyan-200'
                    }`}
                  >
                    {statusChip}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-[var(--tournament-text-dim)]">
                Round {shell.currentRoundNumber || 1} of {shell.totalRounds}
              </p>
              {conference ? (
                <p className="truncate text-[10px] text-[var(--tournament-text-mid)]">{conference.name}</p>
              ) : null}
            </div>
          ) : null}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
          <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--tournament-border)] bg-[#060a10]/78 px-3 py-2 backdrop-blur-xl md:px-5">
            <Link
              href="/core"
              className="mr-1 hidden rounded-lg px-2 py-1 text-[11px] text-[var(--tournament-text-dim)] hover:text-white md:inline"
            >
              ← Dashboard
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-white">{shell.name}</p>
              <p className="text-[10px] text-[var(--tournament-text-dim)]">
                <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[var(--tournament-active)]">
                  R{shell.currentRoundNumber || 1}
                </span>
              </p>
            </div>
            {conference ? (
              <span
                className="hidden max-w-[140px] truncate rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold text-white/90 sm:inline-block"
                style={{
                  borderColor: conference.colorHex ? `${conference.colorHex}55` : undefined,
                  background: conference.colorHex ? `${conference.colorHex}18` : 'rgba(255,255,255,0.06)',
                }}
              >
                {conference.name}
              </span>
            ) : null}
            <div className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${statusDotClass}`} title={statusChip} aria-hidden />
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((o) => !o)}
                  className="relative flex h-9 w-9 items-center justify-center rounded-lg text-white/50 hover:bg-white/5 hover:text-white"
                  aria-label="Notifications"
                  data-testid="tournament-notifications"
                >
                  <Bell className="h-5 w-5" strokeWidth={1.75} />
                </button>
                {notifOpen ? (
                  <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-[var(--tournament-border)] bg-[var(--tournament-panel)] p-3 shadow-xl">
                    <p className="text-[12px] font-semibold text-white">Notifications</p>
                    <p className="mt-2 text-[11px] text-[var(--tournament-text-dim)]">
                      You’re all caught up. Alerts for drafts, advancement, and bubble updates will appear here.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          {state.status === 'bubble' ? (
            <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-[12px] font-semibold text-amber-100">
              ⚠ You are in the bubble — every point counts.
            </div>
          ) : null}

          {state.status === 'advanced' && state.hasSeenAdvancement ? (
            <div className="border-b border-yellow-500/25 bg-yellow-500/10 px-4 py-2 text-center text-[12px] font-semibold text-yellow-100">
              🏆 You advanced! Check your new league and draft window.
            </div>
          ) : null}

          <TournamentRenewBanner tournamentId={tournamentId} isCommissioner={Boolean(isCommissioner)} />

          <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6 md:py-6">{children}</main>
        </div>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-[var(--tournament-border)] bg-[#0c1219]/88 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {primaryMobile.map((item) => {
                    const active = currentPath === item.href || (item.href !== base && currentPath.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${
                active ? 'text-[var(--tournament-active)]' : 'text-[var(--tournament-text-dim)]'
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-[var(--tournament-text-dim)]"
          data-testid="tournament-nav-more"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
          More
        </button>
      </nav>

      {moreOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm md:hidden"
          role="presentation"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-[var(--tournament-border)] bg-[var(--tournament-panel)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-3 text-[13px] font-bold text-white">More</p>
            <div className="flex flex-col gap-1">
              {overflowItems.map((item) => {
                if (hideDrafts && item.label === 'Drafts') return null
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href.startsWith('#') ? base : item.href}
                    onClick={(e) => {
                      onNav(e, item.href)
                      setMoreOpen(false)
                    }}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 text-[14px] font-medium text-white/90 hover:bg-white/5"
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}

      <TournamentEntryIntroModal tournamentId={tournamentId} sport={shell.sport} />

      {isCommissioner ? (
        <TournamentSettingsModalEditable
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          tournamentId={tournamentId}
          viewerUserId={viewerUserId}
        />
      ) : null}
    </>
  )
}
