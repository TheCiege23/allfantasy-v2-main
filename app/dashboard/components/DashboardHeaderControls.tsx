'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import Link from 'next/link'
import { LogOut, Plus, PlusCircle, Settings, User } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useTokenBalance } from '@/hooks/useTokenBalance'

/**
 * Dashboard V2 Phase 3.8D — header-hosted rehome of the (removed) desktop right rail's affordances:
 * Create League, Import, and the profile/plan/account menu. This intentionally parallels the footer
 * inside `RightControlPanel` (which still owns those affordances on mobile and on the shared league
 * shell) rather than sharing code with it, so removing the dashboard rail never touches
 * `RightControlPanel`'s behaviour anywhere else. Desktop-only; mobile keeps its own topbar + drawer.
 */

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

function resolvePlanChip(ents: ReturnType<typeof useEntitlements>): { label: string; dotClass: string } | null {
  if (ents.loading) return null
  if (ents.hasSupreme) return { label: 'AF Supreme', dotClass: 'bg-purple-400' }
  if (ents.hasCommissioner) return { label: 'AF Commissioner', dotClass: 'bg-amber-400' }
  if (ents.hasWarRoom) return { label: 'AF Legacy', dotClass: 'bg-blue-400' }
  if (ents.hasPro) return { label: 'AF Pro', dotClass: 'bg-cyan-400' }
  return { label: 'Free', dotClass: 'bg-white/30' }
}

export interface DashboardHeaderControlsProps {
  userName: string
  userImage?: string | null
  onImport: () => void
  onSettingsNavigate?: () => void
}

export function DashboardHeaderControls({
  userName,
  userImage,
  onImport,
  onSettingsNavigate,
}: DashboardHeaderControlsProps) {
  const router = useRouter()
  const { t } = useLanguage()
  const entitlements = useEntitlements()
  const tokenBalance = useTokenBalance()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const chip = resolvePlanChip(entitlements)
  const visibleTokenCount =
    !tokenBalance.loading && tokenBalance.balance != null && tokenBalance.balance > 0
      ? tokenBalance.balance
      : null

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => router.push('/create-league')}
        data-testid="dashboard-header-create-league"
        className="warroom-pressable inline-flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-300/[0.10] text-cyan-50 shadow-[0_0_18px_-10px_rgba(34,211,238,0.85)] hover:border-cyan-200/55 hover:bg-cyan-300/[0.16]"
        aria-label="Create League"
        title="Create League"
      >
        <PlusCircle className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onImport}
        data-testid="dashboard-header-import-league"
        className="warroom-pressable inline-flex h-9 w-9 items-center justify-center rounded-xl border border-amber-300/25 bg-amber-300/[0.08] text-amber-50 hover:border-amber-200/40 hover:bg-amber-300/[0.14]"
        aria-label={t('dashboard.right.importLeague')}
        title={t('dashboard.right.importLeague')}
      >
        <Plus className="h-4 w-4" />
      </button>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          data-testid="dashboard-header-profile"
          aria-label={t('dashboard.right.settings')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
          className="warroom-pressable flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-1 pl-1 pr-2 hover:border-cyan-300/25 hover:bg-cyan-300/[0.08]"
        >
          <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-lg border border-cyan-200/25 bg-gradient-to-br from-cyan-400 to-blue-600">
            {userImage ? (
              <img src={userImage} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[10px] font-black uppercase text-white">
                {profileInitials(userName)}
              </span>
            )}
          </span>
          {chip ? (
            <span className="hidden items-center gap-1 lg:inline-flex">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${chip.dotClass}`} />
              <span className="text-[10px] font-bold text-white/70">{chip.label}</span>
              {visibleTokenCount != null ? (
                tokenBalance.isAdminBypassAccount ? (
                  <span
                    className="text-[10px] text-white/35"
                    title="Admin bypass — synthetic balance, no ledger history"
                  >
                    · Admin
                  </span>
                ) : (
                  <span className="text-[10px] text-white/35">· {visibleTokenCount.toLocaleString()}</span>
                )
              ) : null}
            </span>
          ) : null}
        </button>
        {menuOpen ? (
          <div
            role="menu"
            data-testid="dashboard-header-user-menu"
            className="warroom-menu-in absolute right-0 top-full z-30 mt-2 w-48 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0c0c24] shadow-xl"
          >
            <div className="border-b border-white/[0.06] px-3 py-2">
              <p className="truncate text-[13px] font-bold text-white">{userName}</p>
              {chip ? (
                <Link
                  href="/settings?tab=billing"
                  onClick={() => setMenuOpen(false)}
                  className="mt-1 inline-flex items-center gap-1 rounded-full border border-white/12 bg-black/20 px-2 py-0.5 transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.07]"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${chip.dotClass}`} />
                  <span className="text-[9px] font-bold text-white/72">{chip.label}</span>
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
              ) : null}
            </div>
            <button
              type="button"
              role="menuitem"
              data-testid="dashboard-header-user-menu-profile"
              onClick={() => {
                setMenuOpen(false)
                router.push('/profile')
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-white/80 transition hover:bg-white/[0.06] hover:text-white"
            >
              <User className="h-3.5 w-3.5" /> Profile
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="dashboard-header-user-menu-settings"
              onClick={() => {
                setMenuOpen(false)
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
              data-testid="dashboard-header-user-menu-signout"
              onClick={() => {
                setMenuOpen(false)
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
  )
}
