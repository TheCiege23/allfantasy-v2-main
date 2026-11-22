import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SurvivorSummary } from '@/components/survivor/types'
import { SurvivorIslandBanner } from '@/components/core-app/survivor/SurvivorIslandBanner'
import { survivorIslandMessages } from '@/lib/core-app/messages/survivorIsland'
import { missingMessages } from '@/lib/i18n/messages'
import { clockText, islandView, sportBall, tribeColor } from '@/lib/core-app/survivorIsland'

/** The island banner on a Survivor league's Camp, Tribe standings and Immunity challenge screens. */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function summary(over: Partial<SurvivorSummary> = {}): SurvivorSummary {
  return {
    leagueName: 'The Outcast Isles',
    config: {} as SurvivorSummary['config'],
    seasonCalendar: { firstWeek: 1, lastWeek: 17, sport: 'NFL', sportsSupported: ['NFL'] },
    currentWeek: 7,
    tribes: [
      { id: 'tA', name: 'Vela', colorHex: '#3f9fc4', slotIndex: 0, members: [{ rosterId: 'r1', isLeader: false }, { rosterId: 'r2', isLeader: false }], outMembers: [{ rosterId: 'r9', week: 3 }] },
      { id: 'tB', name: 'Koro', colorHex: null, slotIndex: 1, members: [{ rosterId: 'r3', isLeader: false }, { rosterId: 'r4', isLeader: false }] },
    ],
    council: null,
    challenges: [],
    jury: [],
    exileLeagueId: null,
    exileTokens: [],
    votedOutHistory: [],
    merged: false,
    myRosterId: 'r1',
    myTribeId: 'tA',
    myIdols: [],
    tribeScores: { tA: 118.6, tB: 104.2 },
    immunityRosterIds: ['r2'],
    rosterDisplayNames: { r1: 'Coach T', r2: 'Dana', r3: 'Andre', r4: 'Sofia', r9: 'Ray' },
    ...over,
  }
}
const council = (over: Partial<NonNullable<SurvivorSummary['council']>> = {}) => ({
  id: 'c1', week: 7, phase: 'voting', attendingTribeId: 'tB', voteDeadlineAt: '2026-11-03T15:00:00Z', closedAt: null, eliminatedRosterId: null, ...over,
})

describe('islandView', () => {
  it('follows the season: camp, council, reading, challenge, merge, finale, crowned', () => {
    expect(islandView(summary())).toMatchObject({ scene: 'beach', moment: { kind: 'camp' }, clock: null, week: 7, sport: 'NFL', castawaysLeft: 4, castawaysTotal: 5 })
    expect(islandView(summary({ council: council() }))).toMatchObject({ scene: 'tribal', moment: { kind: 'council', tribeName: 'Koro', mine: false }, clock: { label: 'council', at: '2026-11-03T15:00:00Z' } })
    expect(islandView(summary({ council: council({ attendingTribeId: 'tA' }) })).moment).toEqual({ kind: 'council', tribeName: 'Vela', mine: true })
    expect(islandView(summary({ council: council({ isRevealed: true, revealComplete: false }) })).moment.kind).toBe('reading')
    expect(islandView(summary({ council: council({ isRevealed: true, revealComplete: true, closedAt: 'x' }) })).moment.kind).toBe('camp')
    const ch = { id: 'h', week: 7, challengeType: 'x', title: 'Fire making', status: 'open', lockAt: '2026-11-01T00:00:00Z', resultJson: null, submissionCount: 0 }
    expect(islandView(summary({ challenges: [ch] }))).toMatchObject({ scene: 'jungle', moment: { kind: 'challenge', title: 'Fire making' }, clock: { label: 'challenge' } })
    expect(islandView(summary({ merged: true }))).toMatchObject({ scene: 'merge', moment: { kind: 'merged' } })
    const fin = { open: true, closed: false, finalists: [], juryVotesSubmitted: 2, juryVotesRequired: 7, winnerRosterId: null, crownedAt: null, myJuryVote: null, voteCount: null, bonusVotesByFinalist: null, tieBreakSeasonPoints: null }
    expect(islandView(summary({ finale: fin }))).toMatchObject({ scene: 'finale', moment: { kind: 'finale_open' } })
    expect(islandView(summary({ finale: { ...fin, winnerRosterId: 'r3' } })).moment).toEqual({ kind: 'crowned', winnerName: 'Andre' })
  })

  it('says the draft has not happened while no tribe has members, and survives no summary at all', () => {
    expect(islandView(summary({ tribes: [] })).moment.kind).toBe('pre_draft')
    expect(islandView(null)).toMatchObject({ scene: 'beach', clock: null, week: null })
  })
})

describe('helpers', () => {
  it('counts down and stops at zero', () => {
    const now = Date.parse('2026-11-01T08:45:00Z')
    expect(clockText('2026-11-03T15:00:00Z', now)).toBe('2d 06:15')
    expect(clockText('2026-11-01T09:00:00Z', now)).toBe('00:15')
    expect(clockText('2026-11-01T08:00:00Z', now)).toBeNull()
    expect(clockText('not a date', now)).toBeNull()
  })

  it('draws every supported sport', () => {
    expect(['NFL', 'NBA', 'NHL', 'MLB', 'NCAAFB', 'NCAABB', 'SOCCER'].map(sportBall)).toEqual(['football', 'basketball', 'puck', 'baseball', 'football', 'basketball', 'soccer'])
    expect(sportBall(null)).toBeNull()
  })

  it('keeps a commissioner colour and gives each slot its own fallback', () => {
    expect(tribeColor({ colorHex: '#123456', slotIndex: 0 })).toBe('#123456')
    expect(tribeColor({ colorHex: 'red; background:url(x)', slotIndex: 0 })).toBe('#3f9fc4')
    expect(tribeColor({ colorHex: null, slotIndex: 1 })).not.toBe(tribeColor({ colorHex: null, slotIndex: 0 }))
  })

  it('has every line in Spanish', () => {
    expect(missingMessages(survivorIslandMessages, 'es')).toEqual([])
  })
})

describe('SurvivorIslandBanner', () => {
  it('shows the scene and league name before the summary arrives, then the moment, clock and tribes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(summary({ council: council({ voteDeadlineAt: new Date(Date.now() + 26 * 3600_000).toISOString() }) })), { status: 200 })))
    const { container } = render(<SurvivorIslandBanner leagueId="L1" leagueName="Isles (row name)" />)
    expect(container.querySelector('[data-testid="survivor-island-banner"]')?.getAttribute('data-scene')).toBe('beach')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Isles (row name)')

    await waitFor(() => expect(screen.getByText('Koro goes to Tribal Council')).toBeTruthy())
    const banner = container.querySelector('[data-testid="survivor-island-banner"]') as HTMLElement
    expect(banner.getAttribute('data-scene')).toBe('tribal')
    expect(banner.style.backgroundImage).toContain('/survivor/scenes/tribal.svg')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The Outcast Isles')
    expect(screen.getByRole('timer').textContent).toMatch(/1d \d\d:\d\d/)
    expect(screen.getByText('Lost immunity · votes this week')).toBeTruthy()
    // Two tribes, five seats: four in the game, one struck out; Dana wears immunity.
    expect(container.querySelectorAll('.sv-strip i').length).toBe(5)
    expect(container.querySelectorAll('.sv-strip i[data-out="true"]').length).toBe(1)
    expect(container.querySelector('.sv-strip i[data-immune="true"]')?.getAttribute('title')).toBe('Dana')
    expect(screen.getByText('Your shelter').getAttribute('href')).toBe('/core/my-team?league=L1')
  })

  it('never blocks the screen: a failed read leaves the scene and the name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const { container } = render(<SurvivorIslandBanner leagueId="L1" leagueName="Isles" variant="compact" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Isles')
    expect(container.querySelector('.sv-actions')).toBeNull()
    expect(container.querySelector('.sv-tribes')).toBeNull()
  })
})

describe('the core page', () => {
  const page = readFileSync(resolve(process.cwd(), 'app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')
  it('opens Camp, Tribe standings, Immunity challenge and Island control with the banner, only in a Survivor league', () => {
    expect(page).toContain("leagueThemeForTypeKey(tradeLeagueTypeKey) === 'survivor' && selectedLeagueId ?")
    expect(page.match(/survivorBanner\('full'\)/g)?.length).toBe(1)
    // Tribe standings, Immunity challenge, Island control, and the shared slot over every other league tab.
    expect(page.match(/survivorBanner\('compact'\)/g)?.length).toBe(4)
  })
})
