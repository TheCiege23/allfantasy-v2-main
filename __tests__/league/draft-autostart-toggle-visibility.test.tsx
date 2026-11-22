/**
 * The "Autostart Draft" toggle is hidden for leagues whose scheduled draft starts at its time
 * whatever it says (native redraft NFL/NBA/NHL/MLB — lib/draft/redraftScheduledStart.ts), and shown
 * for survivor leagues, which `startScheduledSurvivorDrafts` still gates on it.
 *
 * Covers the two `/api/league/settings` consumers: the commissioner modal's DraftSettingsPanel and
 * the league page's LeagueSettingsTab. DraftSettingsCommissionerPanel is covered in
 * __tests__/draft/draft-settings-panel.test.tsx.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict.en[k] ?? k
  return { useLanguage: () => ({ language: 'en', t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: 'en', t }) }
})
vi.mock('@/components/core-app/LeagueInvitePanel', () => ({ LeagueInvitePanel: () => null }))
vi.mock('@/components/chimmy-surfaces', () => ({ ChimmyAlertPreferencesPanel: () => null }))
vi.mock('@/components/subscription/SubscriptionGateBadge', () => ({ SubscriptionGateBadge: () => null }))
vi.mock('@/components/subscription/SubscriptionGateModal', () => ({ SubscriptionGateModal: () => null }))
vi.mock('@/components/commissioner/IntegritySettingsPanel', () => ({ IntegritySettingsPanel: () => null }))
vi.mock('@/hooks/useEntitlement', () => ({ useEntitlement: () => ({ hasAccess: () => false }) }))
vi.mock('@/hooks/useSubscriptionGate', () => ({ useSubscriptionGateOptional: () => null }))

import { DraftSettingsPanel } from '@/app/league/[leagueId]/components/settings/DraftSettingsPanel'
import { LeagueSettingsTab } from '@/app/league/[leagueId]/tabs/LeagueSettingsTab'

const NOTE = 'Drafts start automatically at the scheduled time.'
const REDRAFT = {
  sport: 'NFL', leagueType: 'redraft', isDynasty: false, platform: 'allfantasy',
  survivorMode: false, guillotineMode: false, leagueVariant: null,
}
const SURVIVOR = { ...REDRAFT, survivorMode: true }

afterEach(() => { vi.unstubAllGlobals(); cleanup() })

describe('DraftSettingsPanel (commissioner modal) Autostart toggle', () => {
  const props = { draftRow: { autostart: true }, canEdit: true, save: async () => {}, debouncedSave: () => {} }

  it('is hidden for a native redraft league, with the note in its place', () => {
    const r = render(<DraftSettingsPanel {...props} league={REDRAFT} />)
    expect(r.queryByText('Autostart draft at scheduled time')).toBeNull()
    expect(r.getByText(NOTE)).toBeTruthy()
  })

  it('is shown for a survivor league', () => {
    const r = render(<DraftSettingsPanel {...props} league={SURVIVOR} />)
    expect(r.getByText('Autostart draft at scheduled time')).toBeTruthy()
    expect(r.queryByText(NOTE)).toBeNull()
  })
})

describe('LeagueSettingsTab Autostart toggle', () => {
  function stub(league: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/league/settings?')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            userRole: 'commissioner', canEdit: true, hasAfCommissionerSub: false,
            league: {
              id: 'l1', name: 'L', season: 2026, timezone: 'America/New_York', teamCount: 2,
              rosterSize: 15, totalRosterSlots: 15, teams: [], ...league,
            },
            settings: { autostart: true, timezone: 'America/New_York' },
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }))
  }

  it('is hidden for a native redraft league, with the note in its place', async () => {
    stub(REDRAFT)
    const r = render(<LeagueSettingsTab leagueId="l1" />)
    await r.findByText('Slow Draft Auto-Pause')
    expect(r.queryByText('Autostart Draft')).toBeNull()
    expect(r.getByText(NOTE)).toBeTruthy()
  })

  it('is shown for a survivor league', async () => {
    stub(SURVIVOR)
    const r = render(<LeagueSettingsTab leagueId="l1" />)
    await r.findByText('Slow Draft Auto-Pause')
    expect(r.getByText('Autostart Draft')).toBeTruthy()
    expect(r.queryByText(NOTE)).toBeNull()
  })
})
