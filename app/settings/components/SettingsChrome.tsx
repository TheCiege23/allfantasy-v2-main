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

  const NavButton = ({ tab, mobile }: { tab: NavDef; mobile?: boolean }) => {
    const Icon = tab.icon
    const active = activeTab === tab.id
    const label = t(`settings.nav.${tab.id}`)
    return (
      <button
        type="button"
        onClick={() => onTabChange(tab.id)}
        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition ${
          active ? 'font-semibold' : 'font-medium hover:bg-surface-hover'
        } ${
          mobile ? 'shrink-0 whitespace-nowrap' : ''
        } ${active ? 'border-l-2 border-cyan-400' : 'border-l-2 border-transparent'}`}
        style={
          active
            ? {
                background: 'color-mix(in srgb, var(--accent-cyan) 15%, transparent)',
                color: 'var(--text)',
              }
            : {
                color: 'var(--muted)',
              }
        }
      >
        <Icon
          className="h-4 w-4 shrink-0"
          style={{ color: 'var(--accent-cyan-strong)' }}
        />
        {label}
      </button>
    )
  }

  return (
    <div
      className="flex min-h-[100dvh] flex-col bg-app text-primary"
    >
      <header
        className="flex shrink-0 items-center gap-3 border-b border-subtle bg-app px-4 py-3"
      >
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-2 rounded-lg border border-subtle bg-surface-muted px-3 py-2 text-sm font-medium text-primary transition hover:bg-surface-hover"
          data-testid="settings-home"
        >
          <Home className="h-5 w-5" style={{ color: 'var(--accent-cyan-strong)' }} strokeWidth={2} />
          {t('settings.home')}
        </button>
        <h1
          className="text-lg font-bold tracking-tight text-primary"
        >
          {t('settings.title')}
        </h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-subtle px-2 py-2 md:hidden"
          aria-label={t('settings.aria.sections')}
        >
          {SETTINGS_NAV.map((tab) => (
            <NavButton key={tab.id} tab={tab} mobile />
          ))}
        </nav>

        <aside
          className="hidden w-60 shrink-0 flex-col border-r border-subtle bg-app p-3 md:flex"
          aria-label={t('settings.aria.navigation')}
        >
          <div
            className="rounded-xl border border-subtle bg-surface p-2"
          >
            {SETTINGS_NAV.map((tab) => (
              <NavButton key={tab.id} tab={tab} />
            ))}
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-10">
          <div
            className="mx-auto max-w-3xl rounded-2xl border border-subtle bg-surface p-5 shadow-soft sm:p-8"
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
