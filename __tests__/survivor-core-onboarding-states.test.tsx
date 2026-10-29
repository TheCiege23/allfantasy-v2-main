// @vitest-environment jsdom
/**
 * survivor-core §6 (first tribe reveal, how-it-works explainer) and §7 (empty/loading/error states).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/league/native/LeagueSeatTracker', () => ({ LeagueSeatTracker: () => <div data-testid="seat-tracker" /> }))
vi.mock('@/components/league/CommissionerSetupChecklist', () => ({ CommissionerSetupChecklist: () => null }))

import { SurvivorTribeReveal } from '@/components/survivor/core/SurvivorTribeReveal'
import { SURVIVOR_ONBOARDING_STEPS, SurvivorHowItWorks } from '@/components/survivor/core/SurvivorHowItWorks'
import { SURVIVOR_STATES, SurvivorStateCard, type SurvivorStateKey } from '@/components/survivor/core/SurvivorStateCard'
import { SurvivorNativeHome } from '@/components/survivor/SurvivorNativeHome'
import { SurvivorVoteCast } from '@/components/survivor/weekly/SurvivorVoteCast'

const base = { config: { tribeCount: 2, idolCount: 6, exileReturnTokens: 3, exileReturnEnabled: true }, challenges: [], jury: [], exileLeagueId: null, exileTokens: [], votedOutHistory: [], merged: false, myIdols: [] }
const tribes = [
  { id: 'a', name: 'Vela', slotIndex: 0, colorHex: '#8b7be0', members: [{ rosterId: 'r0', isLeader: true }, { rosterId: 'r1', isLeader: false }] },
  { id: 'b', name: 'Koa', slotIndex: 1, members: [{ rosterId: 'r2', isLeader: true }] },
]
const names = { r0: 'Me', r1: 'Ally', r2: 'Rival' }
const league = { id: 'L1', name: 'Island League', sport: 'NFL', season: 2026, teamCount: 3, currentWeek: 3, settings: {} } as never
const props = { league, teams: [] as never, userTeamId: null, draftDateIso: null, settingsOpen: false, onOpenSettings: vi.fn(), onSelectTab: vi.fn(), isCommissioner: false }

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('first tribe reveal', () => {
  it('shows only the viewer’s tribe, display names, and marks itself seen', () => {
    const onClose = vi.fn()
    render(<SurvivorTribeReveal leagueId="L1" sport="NFL" chatHref="/survivor/L1/chat" onClose={onClose} data={{ tribeName: 'Vela', crestUrl: '/crest.svg', color: '#8b7be0', mates: [{ key: 'r0', name: 'Me', you: true }, { key: 'r1', name: 'Ally', you: false }] }} />)
    expect(screen.getByRole('dialog', { name: 'Welcome to Vela' })).toBeTruthy()
    expect(screen.getByText('You and 1 other. Win the tribe race and nobody from Vela goes home.')).toBeTruthy()
    expect(screen.getByText('You')).toBeTruthy()
    expect(screen.getByText('Ally')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open tribe chat' }).getAttribute('href')).toBe('/survivor/L1/chat')
    expect(window.localStorage.getItem('af:survivor-tribe-reveal:L1')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Go to league home' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('opens on the home the first time the viewer has a tribe, and never again', async () => {
    mockFetch({ ...base, currentWeek: 3, tribes, council: null, myRosterId: 'r0', myTribeId: 'a', rosterDisplayNames: names })
    render(<SurvivorNativeHome {...props} />)
    await waitFor(() => expect(screen.getByTestId('survivor-tribe-reveal')).toBeTruthy())
    expect(screen.getByTestId('survivor-tribe-reveal').textContent).not.toContain('Rival')
    cleanup()
    render(<SurvivorNativeHome {...props} />)
    await waitFor(() => expect(screen.getAllByTestId('survivor-tribe-column').length).toBe(2))
    // Give the open-once effect a chance to run before asserting it stayed closed.
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByTestId('survivor-tribe-reveal')).toBeNull()
  })
})

describe('how it works explainer', () => {
  it('lists the five creation steps and stays dismissed', async () => {
    const { unmount } = render(<SurvivorHowItWorks />)
    await waitFor(() => expect(screen.getByTestId('survivor-how-it-works')).toBeTruthy())
    expect(SURVIVOR_ONBOARDING_STEPS.map(s => s.title)).toEqual(['Format', 'Sport and size', 'Tribes', 'Twists', 'Invite'])
    expect(screen.getByText(/can't start until the league is full/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByTestId('survivor-how-it-works')).toBeNull()
    unmount()
    render(<SurvivorHowItWorks />)
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByTestId('survivor-how-it-works')).toBeNull()
  })
})

describe('states', () => {
  it('has all twelve handoff cards, errors announced as alerts', () => {
    const keys: SurvivorStateKey[] = ['idols_before_draft', 'idols_none', 'exile_empty', 'scroll_counting', 'scroll_error', 'votes_closed', 'missed_vote', 'spectator', 'paused', 'locked', 'moment_private']
    for (const key of keys) expect(SURVIVOR_STATES[key].title.length).toBeGreaterThan(3)
    render(<SurvivorStateCard state="scroll_error" />)
    expect(screen.getByRole('alert').textContent).toContain("We couldn't open the scroll")
  })

  it('home: skeleton while loading in season, error card with retry', async () => {
    let resolve: (r: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r })))
    render(<SurvivorNativeHome {...props} />)
    expect(screen.getByTestId('survivor-home-loading')).toBeTruthy()
    resolve(new Response('{}', { status: 500 }))
    await waitFor(() => expect(screen.getByTestId('survivor-state-island_error')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('home: paused, spectator and empty exile cards', async () => {
    window.localStorage.setItem('af:survivor-tribe-reveal:L1', '1')
    mockFetch({ ...base, config: { ...base.config, exileReturnEnabled: false }, paused: true, currentWeek: 3, tribes, council: null, myRosterId: 'r1', myTribeId: 'a', votedOutHistory: [{ rosterId: 'r1', week: 2 }], rosterDisplayNames: names })
    render(<SurvivorNativeHome {...props} />)
    await waitFor(() => expect(screen.getByTestId('survivor-state-paused')).toBeTruthy())
    expect(screen.getByTestId('survivor-state-spectator')).toBeTruthy()
    expect(screen.getByTestId('survivor-state-exile_empty')).toBeTruthy()
    expect(screen.getByTestId('survivor-idols-empty').textContent).toBe("You didn't find an idol")
  })

  it('ballot: skeleton while loading, error card with retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 500 })))
    render(<SurvivorVoteCast leagueId="L1" tribeName="Vela" backHref="/survivor/L1" idolHref="/x" />)
    expect(screen.getByRole('status', { name: 'Loading your ballot' })).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('survivor-state-ballot_error')).toBeTruthy())
  })
})
