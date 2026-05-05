'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { ChevronRight, LogOut, Plus, PlusCircle, Settings, User } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { LeagueListPanel } from './LeagueListPanel'
import type { RightControlPanelLayoutProps, UserLeague } from '../types'

function profileInitials(name: string): string {
  const t = name.trim()
  if (!t) return '?'
  const at = t.indexOf('@')
  const base = at > 0 ? t.slice(0, at) : t
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  }
  return base.slice(0, 2).toUpperCase() || '?'
}

export function RightControlPanel({
  leagues,
  leaguesLoading,
  selectedId,
  activeLeagueId,
  onSelectLeague,
  userId,
  userName,
  userImage,
  userSubtitle,
  onImport,
  onAfterLeagueNavigate,
  onSettingsNavigate,
  onLeaguesRefresh,
  onLeagueRemoved,
  onRailCollapse,
  hideLeagueList = false,
  inlineDashboardSelect = false,
}: RightControlPanelLayoutProps) {
  const router = useRouter()
  const { t } = useLanguage()
  const resolvedSelectedId = activeLeagueId ?? selectedId
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!userMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (!userMenuRef.current?.contains(e.target as Node)) setUserMenuOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [userMenuOpen])
  const subtitle =
    userSubtitle === ''
      ? null
      : userSubtitle != null && userSubtitle !== ''
        ? userSubtitle
        : t('dashboard.right.brandSubtitle')

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-x-hidden border-l border-white/[0.07] bg-[#0a0a1f]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Always-visible header: MY LEAGUES title + Create + Import + (optional) collapse. */}
        <div className="flex min-w-0 flex-shrink-0 items-center justify-between gap-2 border-b border-white/[0.07] px-2 py-2">
          <p className="min-w-0 truncate text-[16px] dashboard-header-bold header-myleagues uppercase tracking-widest">
            {t('dashboard.right.myLeagues')}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {onRailCollapse ? (
              <button
                type="button"
                onClick={onRailCollapse}
                className="hidden md:inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/80 transition hover:bg-white/[0.08]"
                aria-label="Collapse My Leagues"
                title="Collapse My Leagues"
                data-testid="myleagues-rail-collapse"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => router.push('/create-league')}
              data-testid="dashboard-right-create-league"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-200 transition hover:border-cyan-400/45 hover:bg-cyan-500/20"
              aria-label="Create League"
              title="Create League"
            >
              <PlusCircle className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onImport}
              data-testid="dashboard-right-import-league"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white transition hover:bg-white/[0.08]"
              aria-label={t('dashboard.right.importLeague')}
              title={t('dashboard.right.importLeague')}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        {hideLeagueList ? (
          <div className="flex flex-1 min-h-0 min-w-0 flex-col items-center justify-start px-3 py-4 text-center">
            <p className="text-[11px] text-white/35">
              League list hidden. Use <span className="text-cyan-200">Create</span> or <span className="text-white/70">Import</span> above to add a league.
            </p>
          </div>
        ) : (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <LeagueListPanel
              leagues={leagues}
              selectedId={resolvedSelectedId}
              onSelect={(league: UserLeague) => {
                onSelectLeague(league)
                onAfterLeagueNavigate?.()
              }}
              inlineDashboardSelect={inlineDashboardSelect}
              compact
              loading={leaguesLoading}
              onLeaguesRefresh={onLeaguesRefresh}
              onLeagueRemoved={onLeagueRemoved}
            />
          </div>
        )}
      </div>

      {/* Compact AF Chat icon bar (DM / Groups / Chimmy) — retained for future use; replaced by profile footer */}
      {/*
      <div
        className="flex h-12 max-h-12 min-h-[48px] shrink-0 items-center justify-around border-t border-white/[0.07] bg-[#0a0a1f] px-4 py-2"
        data-af-chat-user-id={userId}
      >
        ... MessageCircle, Users, Bot toggles ...
      </div>
      */}

      <div
        className="relative z-10 flex min-h-[52px] flex-shrink-0 items-center gap-2 border-t border-white/[0.07] bg-[#0a0a1f] px-2 py-2"
        data-dashboard-user-id={userId}
        data-dashboard-profile-footer
      >
        <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-cyan-500 to-blue-600">
          {userImage ? (
            <img src={userImage} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-white">
              {profileInitials(userName)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-white">{userName}</p>
          {subtitle ? (
            <p className="truncate text-[12px] leading-tight text-white/40">{subtitle}</p>
          ) : null}
        </div>
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            data-testid="dashboard-right-settings"
            className="flex shrink-0 rounded-lg p-1 transition-colors hover:bg-white/[0.06]"
            aria-label={t('dashboard.right.settings')}
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen((prev) => !prev)}
          >
            <Settings className="h-3.5 w-3.5 text-white/40 transition-colors hover:text-white/80" />
          </button>
          {userMenuOpen ? (
            <div
              role="menu"
              data-testid="dashboard-right-user-menu"
              className="absolute bottom-full right-0 z-30 mb-2 w-48 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0c0c24] shadow-xl"
            >
              <button
                type="button"
                role="menuitem"
                data-testid="dashboard-right-user-menu-profile"
                onClick={() => {
                  setUserMenuOpen(false)
                  router.push('/profile')
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-white/80 transition hover:bg-white/[0.06] hover:text-white"
              >
                <User className="h-3.5 w-3.5" /> Profile
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="dashboard-right-user-menu-settings"
                onClick={() => {
                  setUserMenuOpen(false)
                  onSettingsNavigate?.()
                  router.push('/settings')
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-white/80 transition hover:bg-white/[0.06] hover:text-white"
              >
                <Settings className="h-3.5 w-3.5" /> Settings
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="dashboard-right-user-menu-signout"
                onClick={() => {
                  setUserMenuOpen(false)
                  void signOut({ callbackUrl: '/login' })
                }}
                className="flex w-full items-center gap-2 border-t border-white/[0.06] px-3 py-2 text-left text-[13px] text-rose-300 transition hover:bg-rose-500/10 hover:text-rose-200"
              >
                <LogOut className="h-3.5 w-3.5" /> Sign Out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
