/**
 * The Survivor Commissioner Hub's tab labels and panel titles/subtitles follow the reader's language
 * (English and Spanish), through a lookup that falls back to the dashboard's own English text.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ language: 'es', tab: 'rewards', stub: () => null }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: h.language }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(`tab=${h.tab}`) }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a> }))
vi.mock('@/components/survivor/SurvivorIslandAmbient', () => ({ SurvivorIslandAmbient: h.stub }))
vi.mock('@/components/tournament/TournamentSubscriptionTokensPanel', () => ({ TournamentSubscriptionTokensPanel: h.stub }))
vi.mock('@/components/survivor/SurvivorPremiumCommandCenterPanel', () => ({ SurvivorPremiumCommandCenterPanel: h.stub }))
vi.mock('@/components/survivor/SurvivorCouncilControl', () => ({ SurvivorCouncilControl: h.stub }))
vi.mock('@/components/survivor/SurvivorFinaleControls', () => ({ SurvivorFinaleControls: h.stub }))
vi.mock('@/components/survivor/SurvivorChallengeBuilderPanel', () => ({ SurvivorChallengeBuilderPanel: h.stub }))
vi.mock('@/components/survivor/SurvivorRewardsHubPanel', () => ({ SurvivorRewardsHubPanel: h.stub }))
vi.mock('@/components/survivor/SurvivorSeasonFixPanel', () => ({ SurvivorSeasonFixPanel: h.stub }))
vi.mock('@/components/survivor/SurvivorCommissionerTodoCard', () => ({ SurvivorCommissionerTodoCard: h.stub }))
vi.mock('@/components/survivor/SurvivorGovernanceHubPanel', () => ({ SurvivorGovernanceHubPanel: h.stub }))
vi.mock('@/components/survivor/SurvivorSideGamesHubPanel', () => ({ SurvivorSideGamesHubPanel: h.stub }))

import { SurvivorCommissionerDashboard } from '@/components/survivor/SurvivorCommissionerDashboard'
import { survivorHubTabMessages } from '@/components/survivor/survivorHubTabMessages'
import { messagesFor } from '@/lib/i18n/messages'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 500 })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Survivor Hub tabs in Spanish', () => {
  it('labels every tab and the open panel’s title and subtitle in Spanish', async () => {
    h.language = 'es'
    h.tab = 'rewards'
    render(<SurvivorCommissionerDashboard leagueId="L1" />)
    const label = (id: string) => screen.getByTestId(`survivor-commissioner-tab-${id}`).textContent
    expect(label('overview')).toContain('Resumen')
    expect(label('minigames')).toContain('Minijuegos')
    expect(label('rewards')).toContain('Recompensas')
    expect(label('governance')).toContain('Reglas y conducta')
    expect(label('history')).toContain('Historial')
    expect(screen.getByText('Concede, anula y resuelve las elecciones de recompensa pendientes.')).toBeTruthy()
    expect(screen.queryByText('Grant, reverse and settle pending reward choices.')).toBeNull()
  })

  it('a governance panel in Spanish; English stays English', async () => {
    h.language = 'es'
    h.tab = 'governance'
    const { unmount } = render(<SurvivorCommissionerDashboard leagueId="L1" />)
    expect(screen.getByText('Faltas de conducta, Novatos contra Veteranos e intercambios de tribu.')).toBeTruthy()
    unmount()
    h.language = 'en'
    render(<SurvivorCommissionerDashboard leagueId="L1" />)
    expect(screen.getByTestId('survivor-commissioner-tab-overview').textContent).toContain('Overview')
    expect(screen.getByText('Conduct strikes, Rooks vs Vets and tribe swaps.')).toBeTruthy()
  })

  it('a tab or panel nobody translated yet falls back to its English text', () => {
    const es = messagesFor(survivorHubTabMessages, 'es')
    expect(es.tab('brand_new_tab', 'Brand new')).toBe('Brand new')
    expect(es.text('A panel added later')).toBe('A panel added later')
  })
})
