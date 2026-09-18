'use client'

import type { ComponentType, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
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
  Trophy,
  User,
} from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useEntitlements } from '@/hooks/useEntitlements'
import { AVATAR_PRESET_EMOJI } from '@/lib/avatar'
import type { SettingsProfile } from './sections/settings-types'
import { settingsNavBadges } from './settingsNavBadges'
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
  | 'account'

type NavDef = {
  id: SettingsTabId
  icon: ComponentType<{ className?: string }>
}

// Settings honesty (P2-5): the former 'chimmy' AI tab was removed — its 18
// per-user toggles persisted to notificationPreferences.aiSettings but nothing
// server-side ever read them (the real AI gate is league-level in
// lib/league/ai-feature-gate.ts), and its tier badge came from the admin
// allowlist, so every paying subscriber saw "Free" with locked toggles.
const NAV_DEFS: NavDef[] = [
  { id: 'profile', icon: User },
  { id: 'preferences', icon: Sliders },
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
 * The optional profile fields the completion score counts, in the order the
 * hub nudges for them. One list, so the percentage and the nudge cannot drift.
 */
const COMPLETION_FIELDS = ['displayName', 'bio', 'avatar', 'sports', 'timezone'] as const
type CompletionField = (typeof COMPLETION_FIELDS)[number]

function isFilled(profile: NonNullable<SettingsProfile>, field: CompletionField): boolean {
  switch (field) {
    case 'displayName':
      return Boolean(profile.displayName)
    case 'bio':
      return Boolean(profile.bio)
    case 'avatar':
      return Boolean(profile.profileImageUrl || profile.avatarPreset)
    case 'sports':
      return Boolean(profile.preferredSports && profile.preferredSports.length > 0)
    case 'timezone':
      return Boolean(profile.timezone)
  }
}

/**
 * Honest profile-completion score — measures which optional profile fields the
 * user has actually filled. No fabricated denominator.
 */
function completionPct(profile: SettingsProfile): number {
  if (!profile) return 0
  const filled = COMPLETION_FIELDS.filter((f) => isFilled(profile, f)).length
  return Math.round((filled / COMPLETION_FIELDS.length) * 100)
}

/** The first field still empty, for the hub's one-line nudge. Null when complete. */
function firstMissingField(profile: SettingsProfile): CompletionField | null {
  if (!profile) return null
  return COMPLETION_FIELDS.find((f) => !isFilled(profile, f)) ?? null
}

/** The plan name the chrome shows — shared by the sidebar card and the hub, so they cannot disagree. */
function usePlanText(planLabel: string | null) {
  const ent = useEntitlements()
  // Same tier-priority order as BillingSettingsSection.tsx: supreme inherits every lower tier, so
  // it must win the label even though hasCommissioner/hasPro/hasWarRoom are all also true for it.
  // A fetch error must never be conflated with a verified free plan — the hook's own catch path
  // leaves hasSupreme/etc. at their last-known (false, on a first-load failure) value rather than
  // proving "free," so this checks ent.error explicitly instead of trusting those booleans alone.
  const derivedPlanText = ent.loading
    ? null
    : ent.error
      ? 'Unable to verify'
      : ent.hasSupreme
        ? 'AF Supreme'
        : ent.hasCommissioner
          ? 'AF Commissioner'
          : ent.hasPro
            ? 'AF Pro'
            : ent.hasWarRoom
              ? 'AF Legacy'
              : 'Free'
  return { ent, isPro: ent.hasAnyPaid, planText: planLabel ?? derivedPlanText ?? '...' }
}

function SidebarProfileCard({
  profile,
  planLabel,
}: {
  profile: SettingsProfile
  planLabel: string | null
}) {
  const { ent, isPro, planText } = usePlanText(planLabel)

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
        {ent.isAdminBypassAccount && (
          <span className="ns-rank" title="Admin bypass — not a real Stripe subscription" data-testid="sidebar-plan-bypass-notice">
            (bypass)
          </span>
        )}
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

/**
 * Card order on the hub: the 2026-09-13 design's nine first, then the three
 * tabs it does not draw (Command Center, Referrals, Account) — so no tab loses
 * its way in from the landing.
 */
const HUB_ORDER: SettingsTabId[] = [
  'profile',
  'preferences',
  'notifications',
  'security',
  'connected',
  'billing',
  'rank',
  'legacy',
  'legal',
  'command',
  'referral',
  'account',
]

type HubCta = 'edit' | 'manage' | 'review' | 'view' | 'import'

const HUB_CTA: Record<SettingsTabId, HubCta> = {
  profile: 'edit',
  preferences: 'edit',
  notifications: 'manage',
  security: 'review',
  connected: 'manage',
  billing: 'manage',
  rank: 'view',
  legacy: 'import',
  legal: 'view',
  command: 'edit',
  referral: 'view',
  account: 'manage',
}

const NAV_ICON = Object.fromEntries(NAV_DEFS.map((n) => [n.id, n.icon])) as Record<
  SettingsTabId,
  ComponentType<{ className?: string }>
>

/**
 * `/settings` with no tab — the 2026-09-13 Settings handoff.
 *
 * ⚠ EVERY STATE ON THIS SCREEN IS READ, NEVER DRAWN. The design shows "AF Supreme
 * — yearly, $199.99" and "15,000 tokens/mo"; nothing the client holds carries a
 * price, a billing interval or a token allowance (`EntitlementSnapshot` is plans,
 * status and period dates), so the plan banner names the plan, its status and
 * its renewal date and stops there. The card badges are `settingsNavBadges` —
 * the same derivation the sidebar uses — and a card with no real state carries
 * no badge.
 */
function SettingsHub({
  profile,
  planLabel,
  badges,
  query,
  onOpen,
  notice,
}: {
  profile: SettingsProfile
  planLabel: string | null
  badges: ReturnType<typeof settingsNavBadges>
  query: string
  onOpen: (id: SettingsTabId) => void
  notice?: ReactNode
}) {
  const { t } = useLanguage()
  const { ent, isPro, planText } = usePlanText(planLabel)

  const name = profile?.displayName || profile?.username || 'Your profile'
  const username = profile?.username
  const level = profile?.xpLevel
  const tier = profile?.rankTier
  const pct = completionPct(profile)
  const missing = firstMissingField(profile)
  const presetEmoji =
    profile?.avatarPreset && !profile?.profileImageUrl
      ? AVATAR_PRESET_EMOJI[profile.avatarPreset as keyof typeof AVATAR_PRESET_EMOJI]
      : null

  /* Search matches a card's description as well as its title — "password"
     should find Security. */
  const cards = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = HUB_ORDER.map((id) => ({
      id,
      title: t(`settings.nav.${id}`),
      desc: t(`settings.hub.desc.${id}`),
    }))
    return q ? all.filter((c) => `${c.title} ${c.desc}`.toLowerCase().includes(q)) : all
  }, [query, t])

  const snap = ent.snapshot
  const status = snap?.status ?? 'none'
  const periodEnd = snap?.currentPeriodEnd ? new Date(snap.currentPeriodEnd).toLocaleDateString() : null
  const planDetail = ent.loading
    ? null
    : status === 'none'
      ? t('settings.hub.planFreeDetail')
      : periodEnd
        ? `${status === 'active' ? t('settings.billing.renews') : t('settings.billing.accessUntil')} ${periodEnd}`
        : status.replace(/_/g, ' ')
  /* Same gate as BillingSettingsSection: an admin bypass has no Stripe customer to open. */
  const portal = ent.hasAnyPaid && !ent.isAdminBypassAccount

  return (
    <main className="ns-hub" data-testid="settings-hub">
      <h1 className="ns-hub-title">{t('settings.title')}</h1>
      {notice}

      <section className="ns-hub-id" aria-label={name}>
        <span className="ns-hub-avatar">
          {profile?.profileImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.profileImageUrl} alt="" />
          ) : presetEmoji ? (
            <span className="ns-avatar-emoji">{presetEmoji}</span>
          ) : (
            initialsFrom(name)
          )}
        </span>
        <div className="ns-hub-who">
          <div className="ns-hub-name-row">
            <span className="ns-hub-name">{name}</span>
            {username ? <span className="ns-hub-handle">@{username}</span> : null}
          </div>
          <div className="ns-hub-chips">
            {level != null ? (
              <span className="ns-hub-chip">
                Lv.{level}
                {tier ? ` · ${tier}` : ''}
              </span>
            ) : null}
            <span className="ns-hub-chip" data-tone={isPro ? 'plan' : undefined}>
              {planText}
            </span>
            {ent.isAdminBypassAccount ? (
              <span className="ns-hub-chip" title="Admin bypass — not a real Stripe subscription">
                bypass
              </span>
            ) : null}
          </div>
        </div>
        <div className="ns-hub-completion">
          <div className="ns-hub-completion-row">
            <span>{t('settings.hub.completion')}</span>
            <b>{pct}%</b>
          </div>
          <div className="ns-hub-meter" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="ns-hub-nudge">
            {missing ? t(`settings.hub.nudge.${missing}`) : t('settings.hub.nudge.done')}
          </span>
        </div>
      </section>

      <ul className="ns-hub-grid" aria-label={t('settings.aria.sections')}>
        {cards.map((c) => {
          const Icon = NAV_ICON[c.id]
          const badge = badges[c.id]
          return (
            <li key={c.id}>
              <button
                type="button"
                className="ns-hub-card"
                data-tone={badge?.tone === 'warn' ? 'warn' : undefined}
                data-testid={`settings-hub-card-${c.id}`}
                onClick={() => onOpen(c.id)}
              >
                <span className="ns-hub-card-head">
                  <span className="ns-hub-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="ns-hub-card-title">{c.title}</span>
                  {badge ? (
                    <span className="ns-nav-badge" data-tone={badge.tone}>
                      {badge.text}
                    </span>
                  ) : null}
                </span>
                <span className="ns-hub-card-desc">{c.desc}</span>
                <span className="ns-hub-cta" aria-hidden="true">
                  {t(`settings.hub.cta.${HUB_CTA[c.id]}`)} →
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {cards.length === 0 ? <p className="ns-hub-empty">No settings match “{query}”.</p> : null}

      <section className="ns-hub-plan" aria-label={t('settings.billing.currentPlan')}>
        <div className="ns-hub-plan-copy">
          <span className="ns-hub-plan-label">{t('settings.billing.currentPlan')}</span>
          <span className="ns-hub-plan-name">{planText}</span>
          {planDetail ? <span className="ns-hub-plan-detail">{planDetail}</span> : null}
        </div>
        {ent.loading ? null : portal ? (
          <a className="ns-hub-plan-btn" href="/api/subscription/billing-portal" data-testid="settings-hub-manage-billing">
            {t('settings.billing.manageBilling')}
          </a>
        ) : (
          <a className="ns-hub-plan-btn" href="/pricing" data-testid="settings-hub-pricing">
            {ent.hasAnyPaid ? t('settings.billing.changePlan') : t('settings.billing.viewPlans')}
          </a>
        )}
      </section>
    </main>
  )
}

export function SettingsChrome({
  activeTab,
  onTabChange,
  onShowHub,
  profile = null,
  planLabel = null,
  children,
}: {
  /** `null` is the hub — the card grid — rather than any one tab. */
  activeTab: SettingsTabId | null
  onTabChange: (id: SettingsTabId) => void
  /** Back to the hub from a tab. Absent, the sidebar offers no way back. */
  onShowHub?: () => void
  profile?: SettingsProfile
  planLabel?: string | null
  children: ReactNode
}) {
  const router = useRouter()
  const { t } = useLanguage()
  const [query, setQuery] = useState('')

  /*
   * 38a·12 — the state a setting is in, visible without opening it. Derived
   * from the profile the chrome already has; see settingsNavBadges.ts for why
   * there is no placeholder branch.
   */
  const badges = useMemo(() => settingsNavBadges(profile), [profile])

  const filteredNav = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return NAV_DEFS
    return NAV_DEFS.filter((n) => t(`settings.nav.${n.id}`).toLowerCase().includes(q))
  }, [query, t])

  return (
    <div className="nocturne-settings ns-root" data-view={activeTab ? 'tab' : 'hub'}>
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
          onClick={() => router.push('/core')}
          data-testid="settings-home"
        >
          <Home strokeWidth={2} />
          {t('settings.home')}
        </button>
      </header>

      {activeTab == null ? (
        <SettingsHub
          profile={profile}
          planLabel={planLabel}
          badges={badges}
          query={query}
          onOpen={onTabChange}
          notice={children}
        />
      ) : (
      <div className="ns-shell">
        <aside className="ns-sidebar" aria-label={t('settings.aria.navigation')}>
          {onShowHub ? (
            <button type="button" className="ns-back" onClick={onShowHub} data-testid="settings-show-hub">
              <ArrowLeft />
              {t('settings.hub.allSettings')}
            </button>
          ) : null}
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
                  {badges[tab.id] ? (
                    <span className="ns-nav-badge" data-tone={badges[tab.id]!.tone}>
                      {badges[tab.id]!.text}
                    </span>
                  ) : null}
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
      )}
    </div>
  )
}
