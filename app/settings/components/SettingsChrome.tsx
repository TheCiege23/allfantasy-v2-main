'use client'

import type { ComponentType, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { safeInternalPathOr } from '@/lib/auth/auth-intent-resolver'
import {
  Archive,
  ArrowLeft,
  Bell,
  CreditCard,
  FileText,
  Gift,
  Home,
  LayoutList,
  LayoutDashboard,
  Link2,
  Newspaper,
  Search,
  Shield,
  Sliders,
  Trophy,
  User,
  UserCog,
} from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { useEntitlements } from '@/hooks/useEntitlements'
import { AVATAR_PRESET_EMOJI } from '@/lib/avatar'
import type { SettingsProfile } from './sections/settings-types'
import { settingsNavBadges } from './settingsNavBadges'
import {
  completionPct,
  firstMissingField,
  hubIssues,
  linkedAccountNames,
  securityState,
  type HubIssue,
} from './settingsHubGuide'
import { languageName, settingsHubGuideMessages } from './settingsHubGuideMessages'
import '../nocturne-settings.css'
import './settings-hub-guide.css'

export type SettingsTabId =
  | 'profile'
  | 'preferences'
  | 'home'
  | 'leagues'
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
// server-side ever read them, and its tier badge came from the admin
// allowlist, so every paying subscriber saw "Free" with locked toggles.
const NAV_DEFS: NavDef[] = [
  { id: 'profile', icon: User },
  { id: 'preferences', icon: Sliders },
  // Which /core home sections show, and their alerts (2026-10-24) — HomeSectionsSettingsSection.
  { id: 'home', icon: LayoutList },
  { id: 'leagues', icon: LayoutDashboard },
  { id: 'command', icon: Newspaper },
  { id: 'security', icon: Shield },
  { id: 'notifications', icon: Bell },
  { id: 'connected', icon: Link2 },
  { id: 'legacy', icon: Archive },
  { id: 'rank', icon: Trophy },
  { id: 'billing', icon: CreditCard },
  { id: 'referral', icon: Gift },
  { id: 'legal', icon: FileText },
  { id: 'account', icon: UserCog },
]

/** Tab definitions (id + icon). Labels come from `settings.nav.*` via `useLanguage`. */
export const SETTINGS_NAV = NAV_DEFS

/** `settingsNavBadges` returns the literal 'OFF'; it is translated here, at render. */
function badgeText(text: string, t: (key: string) => string): string {
  return text === 'OFF' ? t('settings.hub.badgeOff') : text
}

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

/** The plan name the chrome shows — shared by the sidebar card and the hub, so they cannot disagree. */
function usePlanText(planLabel: string | null) {
  const ent = useEntitlements()
  const { t } = useLanguage()
  // Same tier-priority order as BillingSettingsSection.tsx: supreme inherits every lower tier, so
  // it must win the label even though hasCommissioner/hasPro/hasWarRoom are all also true for it.
  // A fetch error must never be conflated with a verified free plan — the hook's own catch path
  // leaves hasSupreme/etc. at their last-known (false, on a first-load failure) value rather than
  // proving "free," so this checks ent.error explicitly instead of trusting those booleans alone.
  const derivedPlanText = ent.loading
    ? null
    : ent.error
      ? t('settings.billing.unableToVerify')
      : ent.hasSupreme
        ? 'AF Supreme'
        : ent.hasCommissioner
          ? 'AF Commissioner'
          : ent.hasPro
            ? 'AF Pro'
            : ent.hasWarRoom
              ? 'AF Legacy'
              : t('settings.billing.statusFree')
  return { ent, isPro: ent.hasAnyPaid, planText: planLabel ?? derivedPlanText ?? '...' }
}

function SidebarProfileCard({
  profile,
  planLabel,
}: {
  profile: SettingsProfile
  planLabel: string | null
}) {
  const { t, tInterpolate } = useLanguage()
  const { ent, isPro, planText } = usePlanText(planLabel)

  const name = profile?.displayName || profile?.username || t('settings.hub.yourProfile')
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
            {tInterpolate('settings.hub.levelShort', { level })} · {tier}
          </span>
        ) : level != null ? (
          <span className="ns-rank">{tInterpolate('settings.hub.levelShort', { level })}</span>
        ) : null}
        <span className={`ns-plan ${isPro ? 'is-pro' : 'is-free'}`}>{planText}</span>
        {ent.isAdminBypassAccount && (
          <span className="ns-rank" title={t('settings.hub.bypassTitle')} data-testid="sidebar-plan-bypass-notice">
            ({t('settings.hub.bypassTag')})
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
          <span>{t('settings.hub.completion')}</span>
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
 * The hub's four groups, in reading order (2026-11-14 guide pass). Every tab appears in exactly one —
 * the hub test pins that. "What you see and hear" holds the five tabs that decide what the app shows
 * and sends; they used to be split across "App" and "Leagues & history" by where they were built
 * rather than by what they change.
 */
const HUB_GROUPS: ReadonlyArray<{ id: 'account' | 'app' | 'leagues' | 'plan'; tabs: SettingsTabId[] }> = [
  { id: 'account', tabs: ['profile', 'security', 'account'] },
  { id: 'app', tabs: ['preferences', 'notifications', 'home', 'leagues', 'command'] },
  { id: 'leagues', tabs: ['connected', 'legacy', 'rank'] },
  { id: 'plan', tabs: ['billing', 'referral', 'legal'] },
]

/** Every tab, in hub order — the groups flattened, so search keeps the reading order. */
const HUB_ORDER: SettingsTabId[] = HUB_GROUPS.flatMap((g) => g.tabs)

const GROUP_TITLE_KEY = {
  account: 'groupAccount',
  app: 'groupApp',
  leagues: 'groupLeagues',
  plan: 'groupPlan',
} as const

const NAV_ICON = Object.fromEntries(NAV_DEFS.map((n) => [n.id, n.icon])) as Record<
  SettingsTabId,
  ComponentType<{ className?: string }>
>

type GuideCopy = (typeof settingsHubGuideMessages)['en']

function issueHead(issue: HubIssue, g: GuideCopy): string {
  switch (issue.key) {
    case 'paymentDue':
      return g.headPaymentDue
    case 'emailUnverified':
      return g.headEmailUnverified
    case 'phoneUnverified':
      return g.headPhoneUnverified
    case 'notificationsOff':
      return g.headNotificationsOff
    case 'profileField':
      return g.headProfileField(issue.field)
  }
}

function issueFix(issue: HubIssue, g: GuideCopy): string {
  switch (issue.key) {
    case 'paymentDue':
      return g.fixPaymentDue
    case 'emailUnverified':
      return g.fixEmailUnverified
    case 'phoneUnverified':
      return g.fixPhoneUnverified
    case 'notificationsOff':
      return g.fixNotificationsOff
    case 'profileField':
      return g.fixProfileField(issue.field)
  }
}

function issueWhy(issue: HubIssue, g: GuideCopy): string {
  switch (issue.key) {
    case 'paymentDue':
      return g.whyPaymentDue
    case 'emailUnverified':
      return g.whyEmailUnverified
    case 'phoneUnverified':
      return g.whyPhoneUnverified
    case 'notificationsOff':
      return g.whyNotificationsOff
    case 'profileField':
      return g.whyProfileField
  }
}

/**
 * `/settings` with no tab — the hub.
 *
 * 2026-11-14 guide pass: it leads with an answer ("Your account is set up", or what is not), each card
 * shows the state it is in rather than a verb, and the plan is named once — on its own card — where
 * it used to appear as a chip, a card and a banner.
 *
 * ⚠ EVERY STATE ON THIS SCREEN IS READ, NEVER DRAWN. Nothing the client holds carries a price, a
 * billing interval or a token allowance (`EntitlementSnapshot` is plans, status and period dates), so
 * the plan line names the plan, its status and its renewal date and stops there. A card with no real
 * state shows its description and nothing else.
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
  const { t, tInterpolate } = useLanguage()
  const g = useMessages(settingsHubGuideMessages)
  const { ent, planText } = usePlanText(planLabel)

  const name = profile?.displayName || profile?.username || t('settings.hub.yourProfile')
  const presetEmoji =
    profile?.avatarPreset && !profile?.profileImageUrl
      ? AVATAR_PRESET_EMOJI[profile.avatarPreset as keyof typeof AVATAR_PRESET_EMOJI]
      : null

  const snap = ent.snapshot
  const status = ent.loading ? null : (snap?.status ?? 'none')
  const issues = hubIssues({ profile, notificationsOff: Boolean(badges.notifications), planStatus: status })
  const lead = issues[0] ?? null
  const headline = issues.length === 0 ? g.headClear : issues.length === 1 ? issueHead(lead!, g) : g.headMany(issues.length)

  /* Search matches a card's description as well as its title — "password" should find Security. */
  const cards = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = HUB_ORDER.map((id) => ({
      id,
      title: t(`settings.nav.${id}`),
      desc: t(`settings.hub.desc.${id}`),
    }))
    return q ? all.filter((c) => `${c.title} ${c.desc}`.toLowerCase().includes(q)) : all
  }, [query, t])

  /** One line of real state per card, or null. `warn` marks a state the person probably did not intend. */
  const periodEnd = snap?.currentPeriodEnd ? new Date(snap.currentPeriodEnd).toLocaleDateString() : null
  function stateOf(id: SettingsTabId): { text: string; warn?: boolean; todo?: boolean } | null {
    switch (id) {
      case 'profile': {
        if (!profile) return null
        const missing = firstMissingField(profile)
        return missing ? { text: g.fixProfileField(missing), todo: true } : { text: g.profileDone }
      }
      case 'security': {
        const s = securityState(profile)
        if (s === 'emailUnverified') return { text: g.securityEmailUnverified, warn: true }
        if (s === 'phoneUnverified') return { text: g.securityPhoneUnverified, warn: true }
        if (s === 'emailAndPhone') return { text: g.securityEmailAndPhone }
        if (s === 'emailOnly') return { text: g.securityEmailOnly }
        if (s === 'phoneOnly') return { text: g.securityPhoneOnly }
        return null
      }
      case 'notifications':
        if (!profile) return null
        return badges.notifications ? { text: g.notificationsOff, warn: true } : { text: g.notificationsOn }
      case 'connected': {
        if (!profile) return null
        const names = linkedAccountNames(profile)
        return { text: names.length > 0 ? names.join(', ') : g.connectedNone }
      }
      case 'preferences':
        if (!profile) return null
        return { text: g.preferences(languageName(profile.preferredLanguage), profile.timezone ?? null) }
      case 'rank':
        return profile?.xpLevel != null ? { text: g.level(profile.xpLevel, profile.rankTier ?? null) } : null
      case 'billing': {
        if (ent.loading) return null
        if (ent.error) return { text: planText, warn: true }
        if (ent.isAdminBypassAccount) return { text: g.planAdmin(planText) }
        if (status === 'past_due' || status === 'grace') return { text: g.planPaymentDue(planText), warn: true }
        if (status === 'none' || !ent.hasAnyPaid) return { text: g.planFree }
        if (periodEnd) return { text: status === 'active' ? g.planRenews(planText, periodEnd) : g.planUntil(planText, periodEnd) }
        return { text: planText }
      }
      default:
        return null
    }
  }

  return (
    <main className="ns-hub" data-testid="settings-hub">
      <header className="ns-hubg-head" data-testid="settings-guide">
        <p className="ns-hubg-eyebrow">
          <span className="ns-hubg-avatar" aria-hidden="true">
            {profile?.profileImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.profileImageUrl} alt="" />
            ) : presetEmoji ? (
              <span className="ns-avatar-emoji">{presetEmoji}</span>
            ) : (
              initialsFrom(name)
            )}
          </span>
          {g.eyebrow(profile?.username ? `@${profile.username}` : name)}
        </p>
        <h1 className="ns-hubg-title" data-testid="settings-guide-headline">
          {headline}
        </h1>
        <p className="ns-hubg-intro">{g.intro}</p>
        {issues.length > 0 ? (
          <div className="ns-hubg-chips">
            {issues.map((issue) => (
              <button
                key={issue.key}
                type="button"
                className="ns-hubg-chip"
                data-issue={issue.key}
                data-testid={`settings-guide-fix-${issue.key}`}
                onClick={() => onOpen(issue.tab)}
              >
                {issueFix(issue, g)} →
              </button>
            ))}
          </div>
        ) : null}
        {lead ? (
          <p className="ns-hubg-why" data-testid="settings-guide-why">
            {issueWhy(lead, g)}
          </p>
        ) : null}
      </header>
      {notice}

      {/* Grouped, and a group with no match drops out while searching. */}
      {HUB_GROUPS.map((group) => {
        const groupCards = cards.filter((c) => group.tabs.includes(c.id))
        if (groupCards.length === 0) return null
        const headingId = `settings-hub-group-${group.id}`
        return (
          <section key={group.id} className="ns-hub-group" aria-labelledby={headingId}>
            <h2 id={headingId} className="ns-hub-group-title">
              {g[GROUP_TITLE_KEY[group.id]]}
            </h2>
            <ul className="ns-hub-grid" aria-labelledby={headingId}>
              {groupCards.map((c) => {
                const Icon = NAV_ICON[c.id]
                const state = stateOf(c.id)
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="ns-hub-card"
                      data-tone={state?.warn ? 'warn' : undefined}
                      data-testid={`settings-hub-card-${c.id}`}
                      onClick={() => onOpen(c.id)}
                    >
                      <span className="ns-hub-card-head">
                        <span className="ns-hub-icon" aria-hidden="true">
                          <Icon />
                        </span>
                        <span className="ns-hub-card-title">{c.title}</span>
                        <span className="ns-hubg-go" aria-hidden="true">
                          →
                        </span>
                      </span>
                      {state ? (
                        <span className="ns-hubg-state" data-tone={state.warn ? 'warn' : state.todo ? 'todo' : undefined} data-testid={`settings-hub-state-${c.id}`}>
                          {state.text}
                        </span>
                      ) : null}
                      <span className="ns-hub-card-desc">{c.desc}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {cards.length === 0 ? (
        <p className="ns-hub-empty">{tInterpolate('settings.hub.noMatch', { query })}</p>
      ) : null}
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
  const { t, tInterpolate } = useLanguage()
  const [query, setQuery] = useState('')

  /*
   * 38a·12 — the state a setting is in, visible without opening it. Derived
   * from the profile the chrome already has; see settingsNavBadges.ts for why
   * there is no placeholder branch.
   */
  const badges = useMemo(() => settingsNavBadges(profile), [profile])

  /*
   * Below 860px the nav is one horizontally scrolling row (nocturne-settings.css). Opened
   * on a tab near the end — Account, Legal — the row still started at Profile, so the
   * active tab was off-screen. Centre it in the row; only the row scrolls, never the page.
   */
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = navRef.current
    if (!nav || nav.scrollWidth <= nav.clientWidth) return
    const item = nav.querySelector<HTMLElement>('.ns-nav-item.is-active')
    if (!item) return
    nav.scrollLeft = item.offsetLeft - (nav.clientWidth - item.offsetWidth) / 2
  }, [activeTab])

  /*
   * Where Settings was opened from. Home always went to /core, so a member who opened Settings from
   * a league's gear was dropped on the dashboard. A caller passes `?returnTo=<path>` (the app's
   * existing convention, see ImportV4); it is validated as an on-site path (open-redirect safe) and
   * survives tab switches because handleTabSelect keeps the query string.
   */
  const searchParams = useSearchParams()
  const rawReturnTo = searchParams?.get('returnTo')
  const returnTo = rawReturnTo ? safeInternalPathOr(rawReturnTo, '') : ''
  const backTo = returnTo && !returnTo.startsWith('/settings') ? returnTo : null

  const filteredNav = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return NAV_DEFS
    // Same rule as the hub's search: a description counts, so "password" finds Security here too.
    return NAV_DEFS.filter((n) => `${t(`settings.nav.${n.id}`)} ${t(`settings.hub.desc.${n.id}`)}`.toLowerCase().includes(q))
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
          onClick={() => router.push(backTo ?? '/core')}
          data-testid="settings-home"
        >
          {backTo ? <ArrowLeft strokeWidth={2} /> : <Home strokeWidth={2} />}
          {backTo ? t('settings.back') : t('settings.home')}
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

          <nav ref={navRef} className="ns-nav" aria-label={t('settings.aria.sections')}>
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
                      {badgeText(badges[tab.id]!.text, t)}
                    </span>
                  ) : null}
                </button>
              )
            })}
            {filteredNav.length === 0 ? (
              <p className="ns-nav-empty">{tInterpolate('settings.hub.noMatch', { query })}</p>
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
