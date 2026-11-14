'use client'

import { useState } from 'react'
import { SettingsChrome, type SettingsTabId } from '@/app/settings/components/SettingsChrome'

type State = 'one' | 'many' | 'clear'

/*
 * The hub reads the plan from /api/subscription/entitlements through useEntitlements. This answers
 * that one call from the scenario and refuses every other /api/ call, so nothing reaches a database.
 */
type HarnessWindow = Window & { __afSettingsHarness?: State }

const ENTITLEMENTS: Record<State, unknown> = {
  one: {
    entitlement: { plans: ['supreme'], status: 'active', currentPeriodEnd: '2027-01-15T00:00:00Z', gracePeriodEnd: null },
    isAdminBypassAccount: false,
  },
  many: {
    entitlement: { plans: ['pro'], status: 'past_due', currentPeriodEnd: '2026-11-20T00:00:00Z', gracePeriodEnd: '2026-11-20T00:00:00Z' },
    isAdminBypassAccount: false,
  },
  clear: { isAdminBypassAccount: false },
}

function installFetch(state: State) {
  if (typeof window === 'undefined') return
  const w = window as HarnessWindow
  if (w.__afSettingsHarness) {
    w.__afSettingsHarness = state
    return
  }
  w.__afSettingsHarness = state
  const real = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.origin)
    if (url.origin === window.location.origin && url.pathname === '/api/subscription/entitlements') {
      const body = JSON.stringify(ENTITLEMENTS[w.__afSettingsHarness ?? 'one'])
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      return Promise.resolve(new Response('{"error":"harness: no API"}', { status: 503, headers: { 'Content-Type': 'application/json' } }))
    }
    return real(input, init)
  }
}

const BASE = {
  userId: 'e2e-user',
  username: 'TheCiege26',
  email: 'owner@example.test',
  displayName: 'TheCiege26',
  profileImageUrl: null,
  avatarPreset: 'crown',
  preferredLanguage: 'en',
  timezone: 'America/New_York',
  themePreference: 'dark',
  phone: '+15555550100',
  phoneVerifiedAt: '2026-08-01T00:00:00Z',
  emailVerifiedAt: '2026-08-01T00:00:00Z',
  hasPassword: true,
  profileComplete: false,
  bio: null as string | null,
  preferredSports: ['NFL', 'NBA', 'NHL', 'MLB'],
  notificationPreferences: { globalEnabled: true } as Record<string, unknown> | null,
  sleeperUserId: 's1' as string | null,
  discordUserId: 'd1' as string | null,
  spotifyConnectedAt: '2026-09-01T00:00:00Z' as string | null,
  xpLevel: 14,
  rankTier: 'All-Pro',
}

const PROFILES: Record<State, typeof BASE> = {
  one: BASE,
  many: {
    ...BASE,
    emailVerifiedAt: null as unknown as string,
    notificationPreferences: { globalEnabled: false },
    bio: null,
    spotifyConnectedAt: null,
  },
  clear: {
    ...BASE,
    bio: 'Dynasty lifer. Trades on Tuesdays.',
    phone: null as unknown as string,
    phoneVerifiedAt: null as unknown as string,
    discordUserId: null,
    spotifyConnectedAt: null,
    sleeperUserId: null,
  },
}

export default function SettingsHarnessClient({ state }: { state: State }) {
  installFetch(state)
  const [tab, setTab] = useState<SettingsTabId | null>(null)
  return (
    <SettingsChrome activeTab={tab} onTabChange={setTab} onShowHub={() => setTab(null)} profile={PROFILES[state] as never}>
      {tab ? <p style={{ padding: 16 }}>Harness: the {tab} section renders here.</p> : null}
    </SettingsChrome>
  )
}
