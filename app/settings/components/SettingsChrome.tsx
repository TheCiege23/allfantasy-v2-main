'use client'

import type { ComponentType, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Archive,
  Bell,
  CreditCard,
  FileText,
  Gift,
  Home,
  Link2,
  Shield,
  Sliders,
  Sparkles,
  User,
} from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

export type SettingsTabId =
  | 'profile'
  | 'preferences'
  | 'security'
  | 'notifications'
  | 'connected'
  | 'billing'
  | 'referral'
  | 'legacy'
  | 'legal'
  | 'ai'
  | 'account'

type NavDef = {
  id: SettingsTabId
  icon: ComponentType<{ className?: string }>
}

const NAV_DEFS: NavDef[] = [
  { id: 'profile', icon: User },
  { id: 'preferences', icon: Sliders },
  { id: 'ai', icon: Sparkles },
  { id: 'security', icon: Shield },
  { id: 'notifications', icon: Bell },
  { id: 'connected', icon: Link2 },
  { id: 'billing', icon: CreditCard },
  { id: 'referral', icon: Gift },
  { id: 'legacy', icon: Archive },
  { id: 'legal', icon: FileText },
  { id: 'account', icon: AlertTriangle },
]

/** Tab definitions (id + icon). Labels come from `settings.nav.*` via `useLanguage`. */
export const SETTINGS_NAV = NAV_DEFS

export function isSettingsTabId(value: string | null | undefined): value is SettingsTabId {
  return NAV_DEFS.some((n) => n.id === value)
}

export function SettingsChrome({
  activeTab,
  onTabChange,
  children,
}: {
  activeTab: SettingsTabId
  onTabChange: (id: SettingsTabId) => void
  children: ReactNode
}) {
  const router = useRouter()
  const { t } = useLanguage()

  /** Desktop sidebar button — icon + full label */
  const SidebarNavButton = ({ tab }: { tab: NavDef }) => {
    const Icon = tab.icon
    const active = activeTab === tab.id
    const label = t(`settings.nav.${tab.id}`)
    return (
      <button
        type="button"
        onClick={() => onTabChange(tab.id)}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
          active
            ? 'border-l-2 border-cyan-400 bg-cyan-500/10 text-white'
            : 'border-l-2 border-transparent text-white/55 hover:bg-white/[0.04] hover:text-white/85'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0 text-cyan-400/80" />
        {label}
      </button>
    )
  }

  /** Mobile top strip button — icon only, active dot indicator */
  const MobileNavButton = ({ tab }: { tab: NavDef }) => {
    const Icon = tab.icon
    const active = activeTab === tab.id
    const label = t(`settings.nav.${tab.id}`)
    return (
      <button
        type="button"
        onClick={() => onTabChange(tab.id)}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        title={label}
        className={`relative flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-2.5 py-2 transition ${
          active
            ? 'bg-cyan-500/15 text-cyan-300'
            : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
        }`}
      >
        <Icon className="h-5 w-5 shrink-0" />
        {active && (
          <span className="h-1 w-1 rounded-full bg-cyan-400" aria-hidden />
        )}
      </button>
    )
  }

  const activeLabel = t(`settings.nav.${activeTab}`)

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#0d1117] text-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.08] bg-[#0d1117] px-4 py-3">
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/[0.08]"
          data-testid="settings-home"
        >
          <Home className="h-5 w-5 text-cyan-400/90" strokeWidth={2} />
          {t('settings.home')}
        </button>
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-bold tracking-tight text-white">{t('settings.title')}</h1>
          {/* Show active section name on mobile, subtitle on desktop */}
          <p className="text-xs text-white/45 md:hidden">{activeLabel}</p>
          <p className="hidden text-xs text-white/45 md:block">{t('settings.subtitle')}</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Mobile top nav — icon-only scrollable strip with fade edges */}
        <div className="relative border-b border-white/[0.08] md:hidden">
          {/* Fade left */}
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-4 bg-gradient-to-r from-[#0d1117] to-transparent" />
          {/* Fade right */}
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-4 bg-gradient-to-l from-[#0d1117] to-transparent" />
          <nav
            className="flex gap-0.5 overflow-x-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label={t('settings.aria.sections')}
          >
            {SETTINGS_NAV.map((tab) => (
              <MobileNavButton key={tab.id} tab={tab} />
            ))}
          </nav>
        </div>

        {/* Desktop sidebar */}
        <aside
          className="hidden w-60 shrink-0 flex-col border-r border-white/[0.08] bg-[#0a0e1a] p-3 md:flex"
          aria-label={t('settings.aria.navigation')}
        >
          <div className="rounded-xl border border-white/[0.06] bg-[#1a1f3a]/50 p-2">
            {SETTINGS_NAV.map((tab) => (
              <SidebarNavButton key={tab.id} tab={tab} />
            ))}
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-10">
          <div className="mx-auto max-w-3xl rounded-2xl border border-white/[0.08] bg-[#1a1f3a] p-5 shadow-xl sm:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
