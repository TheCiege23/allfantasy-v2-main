'use client'

import type { ComponentType, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Archive,
  Bell,
  CreditCard,
  FileText,
  Gift,
  Home,
  LayoutDashboard,
  Link2,
  Search,
  Shield,
  Sliders,
  Sparkles,
  Trophy,
  User,
} from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useEntitlement } from '@/hooks/useEntitlement'
import { AVATAR_PRESET_EMOJI } from '@/lib/avatar'
import type { SettingsProfile } from './sections/settings-types'
import '../nocturne-settings.css'

export type SettingsTabId =
  | 'profile'
  | 'preferences'
  | 'security'
  | 'notifications'
  | 'connected'
  | 'billing'
  | 'referral'
  | 'legacy'
  | 'rank'
  | 'command'
  | 'legal'
  | 'chimmy'
  | 'account'

type NavDef = {
  id: SettingsTabId
  icon: ComponentType<{ className?: string }>
}

const NAV_DEFS: NavDef[] = [
  { id: 'profile', icon: User },
  { id: 'preferences', icon: Sliders },
  { id: 'chimmy', icon: Sparkles },
  { id: 'command', icon: LayoutDashboard },
  { id: 'security', icon: Shield },
  { id: 'notifications', icon: Bell },
  { id: 'connected', icon: Link2 },
  { id: 'legacy', icon: Archive },
  { id: 'rank', icon: Trophy },
  { id: 'billing', icon: CreditCard },
  { id: 'referral', icon: Gift },
  { id: 'legal', icon: FileText },
  { id: 'account', icon: AlertTriangle },
]

/** Tab definitions (id + icon). Labels come from `settings.nav.*` via `useLanguage`. */
export const SETTINGS_NAV = NAV_DEFS

export function isSettingsTabId(value: string | null | undefined): value is SettingsTabId {
  return NAV_DEFS.some((n) => n.id === value)
}

function initialsFrom(name: string): string {
  const t = name.trim()
  if (!t) return '?'
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  return t.slice(0, 2).toUpperCase()
}

/**
 * Honest profile-completion score — measures which optional profile fields the
 * user has actually filled. No fabricated denominator.
 */
function completionPct(profile: SettingsProfile): number {
  if (!profile) return 0
  const checks = [
    Boolean(profile.displayName),
    Boolean(profile.bio),
    Boolean(profile.profileImageUrl || profile.avatarPreset),
    Boolean(profile.preferredSports && profile.preferredSports.length > 0),
    Boolean(profile.timezone),
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function SidebarProfileCard({
  profile,
  planLabel,
}: {
  profile: SettingsProfile
  planLabel: string | null
}) {
  const ent = useEntitlement('pro_autocoach')
  const isPro = ent.isActiveOrGrace
  const planText = planLabel ?? (isPro ? 'Pro' : 'Free')

  const name = profile?.displayName || profile?.username || 'Your profile'
  const username = profile?.username
  const level = profile?.xpLevel
  const tier = profile?.rankTier
  const sports = (profile?.preferredSports ?? []).slice(0, 5)
  const pct = completionPct(profile)

  const presetEmoji =
    profile?.avatarPreset && !profile?.profileImageUrl
      ? AVATAR_PRESET_EMOJI[profile.avatarPreset as keyof typeof AVATAR_PRESET_EMOJI]
      : null

  return (
    <div className="ns-profile-card">
      <div className="ns-pc-head">
        <span className="ns-avatar">
          {profile?.profileImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.profileImageUrl} alt="" />
          ) : presetEmoji ? (
            <span className="ns-avatar-emoji">{presetEmoji}</span>
          ) : (
            initialsFrom(name)
          )}
        </span>
        <div className="ns-pc-id">
          <div className="ns-pc-name">{name}</div>
          {username ? <div className="ns-pc-username">@{username}</div> : null}
        </div>
      </div>

      <div className="ns-pc-meta">
        {level != null && tier ? (
          <span className="ns-rank">
            Lv.{level} · {tier}
          </span>
        ) : level != null ? (
          <span className="ns-rank">Lv.{level}</span>
        ) : null}
        <span className={`ns-plan ${isPro ? 'is-pro' : 'is-free'}`}>{planText}</span>
      </div>

      {sports.length > 0 ? (
        <div className="ns-chips">
          {sports.map((s) => (
            <span key={s} className="ns-chip">
              {s}
            </span>
          ))}
        </div>
      ) : null}

      <div className="ns-completion">
        <div className="ns-completion-row">
          <span>Profile completion</span>
          <b>{pct}%</b>
        </div>
        <div className="ns-meter" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

export function SettingsChrome({
  activeTab,
  onTabChange,
  profile = null,
  planLabel = null,
  children,
}: {
  activeTab: SettingsTabId
  onTabChange: (id: SettingsTabId) => void
  profile?: SettingsProfile
  planLabel?: string | null
  children: ReactNode
}) {
  const router = useRouter()
  const { t } = useLanguage()
  const [query, setQuery] = useState('')

  const filteredNav = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return NAV_DEFS
    return NAV_DEFS.filter((n) => t(`settings.nav.${n.id}`).toLowerCase().includes(q))
  }, [query, t])

  return (
    <div className="nocturne-settings ns-root">
      <header className="ns-topbar">
        <div className="ns-brand">
          <span className="ns-brand-mark">AF</span>
          <span className="ns-brand-title">{t('settings.title')}</span>
        </div>

        <div className="ns-search">
          <Search />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.searchPlaceholder')}
            aria-label={t('settings.searchPlaceholder')}
          />
        </div>

        <div className="ns-spacer" />

        <button
          type="button"
          className="ns-home"
          onClick={() => router.push('/dashboard')}
          data-testid="settings-home"
        >
          <Home strokeWidth={2} />
          {t('settings.home')}
        </button>
      </header>

      <div className="ns-shell">
        <aside className="ns-sidebar" aria-label={t('settings.aria.navigation')}>
          <SidebarProfileCard profile={profile} planLabel={planLabel} />

          <nav className="ns-nav" aria-label={t('settings.aria.sections')}>
            {filteredNav.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={`ns-nav-item${active ? ' is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon />
                  <span className="ns-nav-label">{t(`settings.nav.${tab.id}`)}</span>
                </button>
              )
            })}
            {filteredNav.length === 0 ? (
              <p className="ns-nav-empty">No settings match “{query}”.</p>
            ) : null}
          </nav>
        </aside>

        <main className="ns-main">
          <div className="ns-content-card">{children}</div>
        </main>
      </div>
    </div>
  )
}
