'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import Link from 'next/link'
import { ChevronRight, LogOut, Plus, PlusCircle, Settings, User } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useTokenBalance } from '@/hooks/useTokenBalance'
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

function resolvePlanChip(ents: ReturnType<typeof useEntitlements>): {
  label: string
  dotClass: string
} | null {
  if (ents.loading) return null
  if (ents.hasSupreme) return { label: 'AF Supreme', dotClass: 'bg-purple-400' }
  if (ents.hasCommissioner) return { label: 'AF Commissioner', dotClass: 'bg-amber-400' }
  if (ents.hasWarRoom) return { label: 'AF Legacy', dotClass: 'bg-blue-400' }
  if (ents.hasPro) return { label: 'AF Pro', dotClass: 'bg-cyan-400' }
  return { label: 'Free', dotClass: 'bg-white/30' }
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
  const entitlements = useEntitlements()
  const tokenBalance = useTokenBalance()

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
    <div className="relative flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-x-hidden border-l border-cyan-300/10 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.08),transparent_34%),linear-gradient(180deg,#07101f_0%,#07091b_100%)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Always-visible header: MY LEAGUES title + Create + Import + (optional) collapse. */}
        <div className="flex min-w-0 flex-shrink-0 items-center justify-between gap-2 border-b border-cyan-300/10 bg-cyan-300/[0.025] px-3 py-3">
          {hideLeagueList ? (
            <span className="min-w-0" aria-hidden />
          ) : (
            <p className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100/70">
              {t('dashboard.right.myLeagues')}
            </p>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {onRailCollapse ? (
              <button
                type="button"
                onClick={onRailCollapse}
                className="hidden h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/75 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.08] hover:text-white md:inline-flex"
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
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-300/[0.10] text-cyan-50 shadow-[0_0_18px_-10px_rgba(34,211,238,0.85)] transition hover:border-cyan-200/55 hover:bg-cyan-300/[0.16]"
              aria-label="Create League"
              title="Create League"
            >
              <PlusCircle className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onImport}
              data-testid="dashboard-right-import-league"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-amber-300/25 bg-amber-300/[0.08] text-amber-50 transition hover:border-amber-200/40 hover:bg-amber-300/[0.14]"
              aria-label={t('dashboard.right.importLeague')}
              title={t('dashboard.right.importLeague')}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        {hideLeagueList ? null : (
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
        className="relative z-10 m-2 flex min-h-[76px] flex-shrink-0 items-center gap-3 rounded-2xl border border-[#262c6a] bg-[radial-gradient(circle_at_top_left,rgba(255,61,129,0.14),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.035))] px-3 py-3 shadow-[0_18px_44px_-30px_rgba(255,61,129,0.6)]"
        data-dashboard-user-id={userId}
        data-dashboard-profile-footer
      >
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-2xl border border-cyan-200/25 bg-gradient-to-br from-cyan-400 to-blue-600 shadow-[0_0_22px_-8px_rgba(34,211,238,0.9)]">
          {userImage ? (
            <img src={userImage} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[13px] font-black uppercase text-white">
              {profileInitials(userName)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-black text-white">{userName}</p>
          {subtitle ? (
            <p className="truncate text-[11px] leading-tight text-cyan-100/45">{subtitle}</p>
          ) : null}
          {(() => {
            const chip = resolvePlanChip(entitlements)
            if (!chip) return null
            const visibleTokenCount =
              !tokenBalance.loading && tokenBalance.balance != null && tokenBalance.balance > 0
                ? tokenBalance.balance
                : null
            return (
              <Link
                href="/settings?tab=billing"
                className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-white/12 bg-black/20 px-2 py-1 transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.07]"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${chip.dotClass}`} />
                <span className="truncate text-[9px] font-bold text-white/72">{chip.label}</span>
                {visibleTokenCount != null ? (
                  tokenBalance.isAdminBypassAccount ? (
                    <span
                      className="text-[9px] text-white/35"
                      title="Admin bypass — synthetic balance, no ledger history"
                    >
                      · Admin bypass
                    </span>
                  ) : (
                    <span className="text-[9px] text-white/35">· {visibleTokenCount.toLocaleString()} tokens</span>
                  )
                ) : null}
              </Link>
            )
          })()}
        </div>
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            data-testid="dashboard-right-settings"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] transition-colors hover:border-cyan-300/25 hover:bg-cyan-300/[0.08]"
            aria-label={t('dashboard.right.settings')}
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen((prev) => !prev)}
          >
            <Settings className="h-4 w-4 text-white/60 transition-colors hover:text-white/90" />
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
