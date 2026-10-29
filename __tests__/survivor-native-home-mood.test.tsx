// @vitest-environment jsdom
/** The league header scene follows league state (survivor-theme handoff), not the saved theme. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/league/native/LeagueSeatTracker', () => ({ LeagueSeatTracker: () => <div /> }))
vi.mock('@/components/league/CommissionerSetupChecklist', () => ({ CommissionerSetupChecklist: () => <div /> }))

import { SurvivorNativeHome } from '@/components/survivor/SurvivorNativeHome'

const teams = Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, teamName: `Team ${i}`, claimedByUserId: `u${i}` })) as never
const league = { id: 'L1', name: 'Island League', sport: 'NFL', season: 2026, teamCount: 4, format: 'survivor', leagueVariant: 'survivor', settings: {} } as never
const props = { league, teams, userTeamId: 't0', draftDateIso: null, settingsOpen: false, onOpenSettings: vi.fn(), onSelectTab: vi.fn(), isCommissioner: false }
const base = {
  config: { tribeCount: 2, idolCount: 7, exileReturnTokens: 3, visualThemeId: 'volcanic-tribal' }, challenges: [], jury: [], exileLeagueId: null, exileTokens: [], votedOutHistory: [], merged: false, myIdols: [],
  currentWeek: 3, myRosterId: 'r0', myTribeId: 'a', rosterDisplayNames: {},
  tribes: [{ id: 'a', name: 'Koa', slotIndex: 0, members: [{ rosterId: 'r0', isLeader: true }] }, { id: 'b', name: 'Vela', slotIndex: 1, members: [{ rosterId: 'r1', isLeader: true }] }],
}

function mockSummary(council: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...base, council }), { status: 200 })))
}

const scenes = () => [...document.querySelectorAll('[data-testid="survivor-home-hero"] img.sv-scene')].map(img => img.getAttribute('src'))

describe('Survivor home island mood', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('stays at day while a council is open but its deadline is not today', async () => {
    mockSummary({ id: 'c', week: 3, phase: 'voting', attendingTribeId: 'a', voteDeadlineAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), closedAt: null, isRevealed: false })
    render(<SurvivorNativeHome {...props} />)
    await waitFor(() => expect(screen.getByTestId('survivor-tribe-race')).toBeTruthy())
    expect(screen.getByTestId('survivor-home-hero').getAttribute('data-mood')).toBe('day')
    expect(screen.getByTestId('survivor-mood-tag').textContent).toBe('Draft & regular week')
    expect(scenes().at(-1)).toBe('/survivor/backgrounds/day-football.svg')
  })

  it('turns to night while the votes are read, cross-fading in the new scene', async () => {
    mockSummary({ id: 'c', week: 3, phase: 'voting', attendingTribeId: 'a', voteDeadlineAt: new Date(Date.now() - 60_000).toISOString(), closedAt: new Date().toISOString(), isRevealed: true, revealStartsAt: new Date(Date.now() - 60_000).toISOString() })
    render(<SurvivorNativeHome {...props} />)
    await waitFor(() => expect(screen.getByTestId('survivor-home-hero').getAttribute('data-mood')).toBe('night'))
    expect(screen.getByTestId('survivor-mood-tag').textContent).toBe('Tribal Council')
    await waitFor(() => expect(document.querySelector('[data-testid="survivor-home-hero"] img[data-scene-entering]')?.getAttribute('src')).toBe('/survivor/backgrounds/night-football.svg'))
    expect(scenes()).toEqual(['/survivor/backgrounds/day-football.svg', '/survivor/backgrounds/night-football.svg'])
  })
})
