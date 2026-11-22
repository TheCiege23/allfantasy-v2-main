import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

/*
 * The Settings hub's answer (2026-11-14 guide pass): a headline read from the account, a state line on
 * each card instead of a verb, and the plan named once. The rules live in settingsHubGuide.ts; these
 * tests pin them and the screen that renders them.
 */

const ents = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
const lang = vi.hoisted(() => ({ value: 'en' }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ents.value }))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return {
    ...actual,
    useLanguage: () => actual.defaultLanguageValue,
    useOptionalLanguage: () => ({ ...actual.defaultLanguageValue, language: lang.value }),
  }
})

import { SettingsChrome } from '@/app/settings/components/SettingsChrome'
import { hubIssues, linkedAccountNames, securityState } from '@/app/settings/components/settingsHubGuide'
import { settingsHubGuideMessages } from '@/app/settings/components/settingsHubGuideMessages'
import { missingMessages } from '@/lib/i18n/messages'

const FREE = {
  loading: false,
  error: null,
  hasAnyPaid: false,
  hasSupreme: false,
  hasCommissioner: false,
  hasPro: false,
  hasWarRoom: false,
  isAdminBypassAccount: false,
  snapshot: { plans: [], status: 'none', currentPeriodEnd: null, gracePeriodEnd: null },
}

const SUPREME = {
  ...FREE,
  hasAnyPaid: true,
  hasSupreme: true,
  hasCommissioner: true,
  hasPro: true,
  hasWarRoom: true,
  snapshot: { plans: ['supreme'], status: 'active', currentPeriodEnd: '2027-01-15T00:00:00Z', gracePeriodEnd: null },
}

/** A complete account: every profile field filled, email and phone verified, notifications on. */
function profile(over: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    username: 'guap',
    email: 'guap@example.test',
    emailVerifiedAt: '2026-01-01T00:00:00Z',
    phone: '+15555550100',
    phoneVerifiedAt: '2026-01-01T00:00:00Z',
    displayName: 'Guap',
    profileImageUrl: null,
    avatarPreset: 'fox',
    bio: 'Dynasty lifer.',
    preferredSports: ['NFL'],
    preferredLanguage: 'en',
    timezone: 'America/New_York',
    notificationPreferences: { globalEnabled: true },
    sleeperUserId: 's1',
    discordUserId: null,
    spotifyConnectedAt: null,
    xpLevel: 14,
    rankTier: 'All-Pro',
    ...over,
  } as never
}

function hub(p = profile(), onTabChange = vi.fn()) {
  return render(
    <SettingsChrome activeTab={null} onTabChange={onTabChange} onShowHub={vi.fn()} profile={p}>
      {null}
    </SettingsChrome>,
  )
}

beforeEach(() => {
  ents.value = SUPREME
  lang.value = 'en'
})

describe('hubIssues — what on the account is not as the person wants it', () => {
  it('is empty for a complete account', () => {
    expect(hubIssues({ profile: profile(), notificationsOff: false, planStatus: 'active' })).toEqual([])
  })

  it('puts a missed payment first and a profile field last', () => {
    const issues = hubIssues({
      profile: profile({ emailVerifiedAt: null, phoneVerifiedAt: null, bio: null }),
      notificationsOff: true,
      planStatus: 'past_due',
    })
    expect(issues.map((i) => i.key)).toEqual([
      'paymentDue',
      'emailUnverified',
      'phoneUnverified',
      'notificationsOff',
      'profileField',
    ])
    expect(issues.map((i) => i.tab)).toEqual(['billing', 'security', 'security', 'notifications', 'profile'])
  })

  it('treats a grace period as a payment to fix, and an expired or free plan as nothing to fix', () => {
    expect(hubIssues({ profile: profile(), notificationsOff: false, planStatus: 'grace' }).map((i) => i.key)).toEqual(['paymentDue'])
    expect(hubIssues({ profile: profile(), notificationsOff: false, planStatus: 'expired' })).toEqual([])
    expect(hubIssues({ profile: profile(), notificationsOff: false, planStatus: 'none' })).toEqual([])
    expect(hubIssues({ profile: profile(), notificationsOff: false, planStatus: null })).toEqual([])
  })

  it('does not ask to verify a phone that was never added', () => {
    expect(hubIssues({ profile: profile({ phone: null, phoneVerifiedAt: null }), notificationsOff: false, planStatus: 'active' })).toEqual([])
  })

  it('asks for only the first missing profile field', () => {
    const issues = hubIssues({ profile: profile({ bio: null, timezone: null }), notificationsOff: false, planStatus: null })
    expect(issues).toEqual([{ key: 'profileField', tab: 'profile', field: 'bio' }])
  })
})

describe('securityState and linkedAccountNames', () => {
  it('names an unverified email before anything else', () => {
    expect(securityState(profile({ emailVerifiedAt: null, phoneVerifiedAt: null }))).toBe('emailUnverified')
    expect(securityState(profile({ phoneVerifiedAt: null }))).toBe('phoneUnverified')
    expect(securityState(profile())).toBe('emailAndPhone')
    expect(securityState(profile({ phone: null }))).toBe('emailOnly')
    expect(securityState(profile({ email: null }))).toBe('phoneOnly')
    expect(securityState(null)).toBeNull()
  })

  it('names only the three accounts the profile carries', () => {
    expect(linkedAccountNames(profile({ sleeperUserId: 's', discordUserId: 'd', spotifyConnectedAt: '2026-01-01' }))).toEqual([
      'Sleeper',
      'Discord',
      'Spotify',
    ])
    expect(linkedAccountNames(profile({ sleeperUserId: null }))).toEqual([])
  })
})

describe('the hub headline', () => {
  it('says the account is set up when nothing needs doing, with no chips and no why line', () => {
    hub()
    expect(screen.getByTestId('settings-guide-headline').textContent).toBe('Your account is set up')
    expect(screen.queryAllByTestId(/^settings-guide-fix-/)).toHaveLength(0)
    expect(screen.queryByTestId('settings-guide-why')).toBeNull()
  })

  it('names the one thing, with its fix and why it matters', () => {
    const onTabChange = vi.fn()
    hub(profile({ bio: null }), onTabChange)
    expect(screen.getByTestId('settings-guide-headline').textContent).toBe('Add a bio to finish your profile')
    expect(screen.getByTestId('settings-guide-why').textContent).toMatch(/^Why it matters: league mates see/)
    fireEvent.click(screen.getByTestId('settings-guide-fix-profileField'))
    expect(onTabChange).toHaveBeenCalledWith('profile')
  })

  it('counts several things, lists a fix for each, and explains the most urgent', () => {
    ents.value = { ...SUPREME, snapshot: { ...SUPREME.snapshot, status: 'past_due' } }
    const onTabChange = vi.fn()
    hub(profile({ notificationPreferences: { globalEnabled: false }, bio: null }), onTabChange)
    expect(screen.getByTestId('settings-guide-headline').textContent).toBe('3 things to check')
    const fixes = screen.getAllByTestId(/^settings-guide-fix-/).map((b) => b.textContent)
    expect(fixes).toEqual(['Update payment →', 'Turn notifications on →', 'Add a bio →'])
    expect(screen.getByTestId('settings-guide-why').textContent).toMatch(/grace period/)
    fireEvent.click(screen.getByTestId('settings-guide-fix-notificationsOff'))
    expect(onTabChange).toHaveBeenCalledWith('notifications')
  })

  it('waits for the plan before claiming anything about it', () => {
    ents.value = { ...SUPREME, loading: true, snapshot: null }
    hub()
    expect(screen.queryByTestId('settings-hub-state-billing')).toBeNull()
    expect(screen.queryByTestId('settings-guide-fix-paymentDue')).toBeNull()
  })
})

describe('the cards', () => {
  it('show a state, not a verb', () => {
    hub()
    const page = screen.getByTestId('settings-hub').textContent ?? ''
    for (const verb of ['Edit →', 'Manage →', 'Review →', 'View →', 'Import →']) expect(page).not.toContain(verb)
    expect(screen.getByTestId('settings-hub-state-security').textContent).toBe('Email and phone verified')
    expect(screen.getByTestId('settings-hub-state-preferences').textContent).toBe('English · New York time')
    expect(screen.getByTestId('settings-hub-state-rank').textContent).toBe('Level 14 · All-Pro')
    expect(screen.getByTestId('settings-hub-state-profile').textContent).toBe('All filled in')
  })

  it('say the level once — on the rank card, not beside the name', () => {
    hub()
    const page = screen.getByTestId('settings-hub').textContent ?? ''
    expect(page.split('All-Pro').length - 1).toBe(1)
  })

  it('use plain names for the three that pointed the wrong way', () => {
    hub()
    expect(within(screen.getByTestId('settings-hub-card-rank')).getByText('Your rank & career')).toBeTruthy()
    expect(within(screen.getByTestId('settings-hub-card-legacy')).getByText('Import past seasons')).toBeTruthy()
    expect(within(screen.getByTestId('settings-hub-card-command')).getByText('Daily brief')).toBeTruthy()
  })

  it('mark an unverified email as a warning on the Security card', () => {
    hub(profile({ emailVerifiedAt: null }))
    const card = screen.getByTestId('settings-hub-card-security')
    expect(card.dataset.tone).toBe('warn')
    expect(within(card).getByTestId('settings-hub-state-security').textContent).toBe('Email not verified')
  })
})

describe('Spanish', () => {
  it('defines every message', () => {
    expect(missingMessages(settingsHubGuideMessages, 'es')).toEqual([])
  })

  it('renders the headline, groups and states in Spanish', () => {
    lang.value = 'es'
    hub(profile({ bio: null }))
    expect(screen.getByTestId('settings-guide-headline').textContent).toBe('Añade una biografía para completar tu perfil')
    expect(screen.getByText('Lo que ves y recibes')).toBeTruthy()
    expect(screen.getByTestId('settings-hub-state-notifications').textContent).toBe('Activadas')
    expect(screen.getByTestId('settings-hub-state-preferences').textContent).toBe('English · hora de New York')
  })
})
