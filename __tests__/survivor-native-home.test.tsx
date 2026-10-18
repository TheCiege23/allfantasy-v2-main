// @vitest-environment jsdom
/**
 * A native Survivor league opens on `native_home`, so this is the first screen every castaway sees.
 * Before the draft it must sell the season and the seats; once tribes exist it must show the
 * tribe race, the castaways' torches, and send the commissioner to the Survivor hub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/league/native/LeagueSeatTracker', () => ({ LeagueSeatTracker: () => <div data-testid="seat-tracker" /> }))
vi.mock('@/components/league/CommissionerSetupChecklist', () => ({ CommissionerSetupChecklist: () => <div data-testid="setup-checklist" /> }))

import { SurvivorNativeHome } from '@/components/survivor/SurvivorNativeHome'

const teams = Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, teamName: `Team ${i}`, claimedByUserId: i < 5 ? `u${i}` : null })) as never
const league = { id: 'L1', name: 'Island League', sport: 'NBA', season: 2026, teamCount: 16, format: 'survivor', leagueVariant: 'survivor', settings: {} } as never
const props = { league, teams, userTeamId: 't0', draftDateIso: '2026-10-20T00:00:00.000Z', settingsOpen: false, onOpenSettings: vi.fn(), onSelectTab: vi.fn() }

function mockSummary(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
}

const base = { config: { tribeCount: 4, idolCount: 6, exileReturnTokens: 3 }, challenges: [], jury: [], exileLeagueId: null, exileTokens: [], votedOutHistory: [], merged: false, myIdols: [] }

describe('SurvivorNativeHome', () => {
  beforeEach(() => vi.useRealTimers())
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('before the draft shows seats, the draft time in Eastern, and the commissioner hub', async () => {
    mockSummary({ ...base, currentWeek: 0, tribes: [], council: null, rosterDisplayNames: {} })
    render(<SurvivorNativeHome {...props} isCommissioner />)
    expect(screen.getByRole('heading', { name: 'Island League' })).toBeTruthy()
    expect(screen.getByText(/5 of 16 seats claimed/)).toBeTruthy()
    expect(screen.getAllByText(/Monday, Oct 19, 8:00 PM ET/).length).toBeGreaterThan(0)
    expect(screen.getByTestId('seat-tracker')).toBeTruthy()
    expect(screen.getByTestId('setup-checklist')).toBeTruthy()
    expect(screen.getByTestId('survivor-home-commissioner-hub').getAttribute('href')).toBe('/survivor/L1/commissioner')
    expect(screen.getByRole('link', { name: /Enter the draft room/ }).getAttribute('href')).toBe('/league/L1/draft')
  })

  it('hides the commissioner hub from managers', () => {
    mockSummary({ ...base, currentWeek: 0, tribes: [], council: null })
    render(<SurvivorNativeHome {...props} isCommissioner={false} />)
    expect(screen.queryByTestId('survivor-home-commissioner-hub')).toBeNull()
    expect(screen.queryByTestId('setup-checklist')).toBeNull()
  })

  it('in season shows the tribe race, member scores, immunity and the vote for the attending tribe', async () => {
    mockSummary({
      ...base, currentWeek: 3, merged: false, myRosterId: 'r0', myTribeId: 'a',
      tribes: [
        { id: 'a', name: 'Koa', slotIndex: 0, members: [{ rosterId: 'r0', isLeader: true }, { rosterId: 'r1', isLeader: false }] },
        { id: 'b', name: 'Vela', slotIndex: 1, members: [{ rosterId: 'r2', isLeader: true }, { rosterId: 'r3', isLeader: false }] },
      ],
      tribeScores: { a: 200, b: 260 }, scoresFinalized: true, memberScores: { r0: 90, r1: 110, r2: 120, r3: 140 }, immunityRosterIds: ['r3'],
      council: { id: 'c', week: 3, phase: 'voting', attendingTribeId: 'a', voteDeadlineAt: '2099-01-01T01:00:00.000Z', closedAt: null, eliminatedRosterId: null, isRevealed: false },
      rosterDisplayNames: { r0: 'Me', r1: 'Ally', r2: 'Rival', r3: 'Star' },
    })
    render(<SurvivorNativeHome {...props} isCommissioner={false} />)
    await waitFor(() => expect(screen.getByTestId('survivor-tribe-race')).toBeTruthy())
    expect(screen.getAllByTestId('survivor-tribe-column')).toHaveLength(2)
    expect(screen.getByText('Going to Tribal Council')).toBeTruthy()
    expect(screen.getByText(/Vela leads by 60\.0\. Koa heads to Tribal Council\. Star has immunity\./)).toBeTruthy()
    expect(screen.getByText('140.0')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Cast your vote/ }).getAttribute('href')).toBe('/survivor/L1/tribal')
    expect(screen.getByText('Votes close in')).toBeTruthy()
  })
})
