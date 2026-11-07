/**
 * 🛑 SURVIVOR ISLAND HOME: NO SEASON YET MEANS "WAIT" OR "IT FAILED", NEVER "PRE-DRAFT".
 *
 * Until /api/survivor/season answers, `leaguePhase` defaults to 'pre_draft', and the island home drew a
 * pre-draft season from those defaults — "Pre Draft", "Tribes form after the draft", "Open draft board" —
 * for a league in week 9. When the read FAILED it drew that permanently with no message and no retry
 * (found in the 2026-11-07 Survivor audit; on main both states show the pre-draft copy). It now shows a
 * skeleton while loading and the design system's `island_error` card, with Try again, on failure —
 * the rule SurvivorNativeHome already followed.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

const ui = vi.hoisted(() => ({ value: null as unknown as Record<string, unknown> }))
vi.mock('@/lib/survivor/SurvivorUiContext', () => ({ useSurvivorUi: () => ui.value }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ leagueId: 'L1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/survivor/L1',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/league/LeagueClipOverlayHost', () => ({ LeagueClipOverlayHost: () => null }))
vi.mock('@/components/survivor/SurvivorFirstEntryModal', () => ({ SurvivorFirstEntryModal: () => null }))
vi.mock('@/components/survivor/SurvivorChallengeBoardCard', () => ({ SurvivorChallengeBoardCard: () => null }))

import SurvivorIslandHomePage from '@/app/survivor/[leagueId]/page'

function ctx(over: Record<string, unknown>) {
  return {
    loading: false, error: null, season: null, leagueName: 'Survivor League', leagueSport: null, survivorModeEnabled: false,
    isCommissioner: false, canEditLeagueSettings: false, hasAfCommissionerSub: false, playerState: 'active', canVote: false,
    canSubmitChallenge: false, canAccessTribeChat: true, canAccessExileChat: false, canAccessJuryChat: false, canAccessMergeChat: false,
    canAccessFinaleChat: false, tribeId: null, hasActiveIdol: false, tokenBalance: null, currentWeek: 1, leaguePhase: 'pre_draft',
    survivorFairPlayLimited: false, survivorFairPlayActive: false, refetch: vi.fn(), ...over,
  }
}
const PRE_DRAFT = /Tribes form after the draft|Open draft board|Pre Draft/

afterEach(() => cleanup())

describe('Survivor island home before the season has loaded', () => {
  it('shows a loading skeleton, not a pre-draft island', () => {
    ui.value = ctx({ loading: true })
    const { container } = render(<SurvivorIslandHomePage />)
    expect(container.querySelector('[data-testid=survivor-island-loading]')).not.toBeNull()
    expect(container.textContent).not.toMatch(PRE_DRAFT)
  })

  it('says the island did not load, and Try again re-reads it', () => {
    const refetch = vi.fn()
    ui.value = ctx({ error: 'Could not load Survivor session.', refetch })
    const { container, getByRole } = render(<SurvivorIslandHomePage />)
    expect(container.querySelector('[data-testid=survivor-state-island_error]')).not.toBeNull()
    expect(container.textContent).not.toMatch(PRE_DRAFT)
    fireEvent.click(getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  // Control: a genuinely pre-draft league that HAS loaded still gets the pre-draft island.
  it('still shows the pre-draft island for a season that is really pre-draft', () => {
    ui.value = ctx({ season: { phase: 'pre_draft', mode: true, tribes: [], players: [] }, leaguePhase: 'pre_draft', survivorModeEnabled: true })
    const { container } = render(<SurvivorIslandHomePage />)
    expect(container.textContent).toMatch(PRE_DRAFT)
    expect(container.querySelector('[data-testid=survivor-island-loading]')).toBeNull()
  })
})
