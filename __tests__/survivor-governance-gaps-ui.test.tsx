import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SurvivorGovernancePanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorGovernancePanel'
import { SurvivorGovernanceCard } from '@/components/survivor/SurvivorGovernanceCard'
import { SurvivorGovernanceHubPanel } from '@/components/survivor/SurvivorGovernanceHubPanel'
import { SurvivorIslandBanner } from '@/components/core-app/survivor/SurvivorIslandBanner'
import { buildSettingsNavGroups } from '@/app/league/[leagueId]/components/settings/SettingsNav'
import { SURVIVOR_GOVERNANCE_DEFAULTS, SURVIVOR_ORIGINAL_NFL_TRADE_WINDOWS } from '@/lib/survivor/survivorGovernanceSettings'
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'
import type { SurvivorSummary } from '@/components/survivor/types'

/** G4 governance gaps on screen: the windows editor and preset, the card, the Hub, the tribe board, the nav. */

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const enabled = { ...SURVIVOR_GOVERNANCE_DEFAULTS, tradeRulesEnabled: true, crossTribeTrades: 'window' as const }

function panelFetch(sport: string) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const patch = JSON.parse(String(init.body)).settings
      return { ok: true, json: async () => ({ ok: true, settings: { ...enabled, ...patch } }) }
    }
    return { ok: true, json: async () => ({ settings: enabled, locked: [], context: { currentWeek: 3, firstWeek: 1 }, sport }) }
  })
}

describe('league settings → cross-tribe windows', () => {
  it('NFL: the original-league preset fills two windows and saves them', async () => {
    panelFetch('NFL')
    render(<SurvivorGovernancePanel leagueId="L1" canEdit hasAfCommissionerSub={false} />)
    fireEvent.click(await screen.findByTestId('survivor-governance-window-preset-original_nfl'))
    expect(screen.getByText('Original league: before TNF and before Sunday 1pm')).toBeInTheDocument()
    expect(screen.getByTestId('survivor-governance-window-1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('survivor-governance-save'))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1].body))
    expect(body.settings).toEqual({ crossTribeWindows: SURVIVOR_ORIGINAL_NFL_TRADE_WINDOWS })
  })

  it('another sport gets no TNF preset; a window can be added up to three', async () => {
    panelFetch('NBA')
    render(<SurvivorGovernancePanel leagueId="L1" canEdit hasAfCommissionerSub={false} />)
    await screen.findByTestId('survivor-governance-windows')
    expect(screen.queryByTestId('survivor-governance-window-preset-original_nfl')).toBeNull()
    fireEvent.click(screen.getByTestId('survivor-governance-window-add'))
    fireEvent.click(screen.getByTestId('survivor-governance-window-add'))
    expect(screen.getByTestId('survivor-governance-window-2')).toBeInTheDocument()
    expect(screen.queryByTestId('survivor-governance-window-add')).toBeNull()
  })

  it('shows the failure-mode choice and the cross-league switch, default allow and off', async () => {
    panelFetch('NFL')
    render(<SurvivorGovernancePanel leagueId="L1" canEdit hasAfCommissionerSub={false} />)
    expect(await screen.findByText('If the check can’t run')).toBeInTheDocument()
    expect((screen.getByDisplayValue('Allow the trade (default)') as HTMLSelectElement).value).toBe('allow')
    expect(screen.getByText('Count Survivor seasons in other AllFantasy leagues')).toBeInTheDocument()
  })
})

describe('the castaway card and the Hub', () => {
  it('the card names the open window of two', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({
      rules: { tradeRulesEnabled: true, alliancesEnabled: false, strikeLimit: 2, allianceMaxSize: 4 },
      tradeWindow: { crossTribeOpen: true, crossTribeClosesAt: '2026-11-06T01:15:00Z', frozen: false, crossTribeWindow: { index: 1, count: 2 } },
      me: { playerState: 'active', canFormAlliance: false }, myStrikes: [], alliances: [], inviteable: [],
    }) })
    render(<SurvivorGovernanceCard leagueId="L1" />)
    expect(await screen.findByTestId('survivor-governance-card-trades')).toHaveTextContent('Cross-tribe window 1 of 2 is open until')
  })

  it('the Hub shows a platform veteran as only that', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({
      settings: SURVIVOR_GOVERNANCE_DEFAULTS,
      castaways: [{ userId: 'u1', displayName: 'Ana', playerState: 'active', strikes: [], experience: { experience: 'veteran', source: 'platform' } }],
      tradeWindow: null,
    }) })
    render(<SurvivorGovernanceHubPanel leagueId="L1" />)
    expect(await screen.findByText('Veteran (played Survivor before)')).toBeInTheDocument()
  })
})

function summary(over: Partial<SurvivorSummary> = {}): SurvivorSummary {
  return {
    leagueName: 'Isles', config: {} as SurvivorSummary['config'],
    seasonCalendar: { firstWeek: 1, lastWeek: 17, sport: 'NFL', sportsSupported: ['NFL'] }, currentWeek: 7,
    tribes: [{ id: 'tA', name: 'Vela', tribeEmoji: '🦂', colorHex: '#3f9fc4', slotIndex: 0, members: [{ rosterId: 'r1', isLeader: false }] }],
    council: null, challenges: [], jury: [], exileLeagueId: null, exileTokens: [], votedOutHistory: [], merged: false,
    myRosterId: 'r1', myTribeId: 'tA', myIdols: [], rosterDisplayNames: { r1: 'Coach T' },
    ...over,
  }
}

describe('the /core island tribe board', () => {
  it('shows the tribe emoji beside the tribe name when the setting is on', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(summary({ tribeEmojiInNames: true })), { status: 200 }))
    render(<SurvivorIslandBanner leagueId="L1" leagueName="Isles" />)
    expect(await screen.findByText('Vela 🦂')).toBeInTheDocument()
  })

  it('leaves the name alone when it is off', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(summary()), { status: 200 }))
    render(<SurvivorIslandBanner leagueId="L1" leagueName="Isles" />)
    expect(await screen.findByText('Vela')).toBeInTheDocument()
    expect(screen.queryByText('Vela 🦂')).toBeNull()
  })
})

describe('bilingual Rules & Conduct nav label', () => {
  it('the Survivor governance entry carries a dictionary key with English and Spanish', () => {
    const item = buildSettingsNavGroups({ showSurvivorTabs: true }).flatMap((g) => g.items).find((i) => i.id === 'survivor_governance')
    expect(item?.labelKey).toBe('settingsNav.survivor.governance')
    expect((translations as unknown as { en: Record<string, string> }).en['settingsNav.survivor.governance']).toBe('Rules & Conduct')
    expect(translationsEsParity['settingsNav.survivor.governance']).toBe('Reglas y conducta')
  })
})
