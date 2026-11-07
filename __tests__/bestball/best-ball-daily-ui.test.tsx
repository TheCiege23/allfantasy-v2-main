/**
 * The Best Ball screens say which scoring period the league actually uses, and the commissioner panel
 * offers only what the PATCH will accept: daily for NBA/NHL/MLB outside a tournament, tournament only to
 * a league that already is one, and nothing that re-scores the league once the draft has started.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BestBallSettingsCommissionerPanel } from '@/components/league-settings/BestBallSettingsCommissionerPanel'
import { BestBallTab } from '@/app/league/[leagueId]/tabs/BestBallTab'
import { buildNativeLineupCard } from '@/lib/bestball/nativeBestBallTab'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubPanelFetch(settings: Record<string, unknown>, structureLock: string | null) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      league: {
        structureLock,
        settings: { mode: 'standard', contestStructure: 'season_long', matchupFormat: 'h2h', playoffFormat: 'bracket', tieRule: 'points_for', scoringPeriod: 'weekly', waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false, podSize: 12, tournamentAdvancementRounds: 0, regularSeasonLength: 21, playoffTeams: 6, ...settings },
      },
    }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const options = (select: HTMLSelectElement) => [...select.options].map((o) => o.value)

describe('the commissioner panel', () => {
  it('offers daily for NBA, explains it, and saves the choice', async () => {
    const fetchMock = stubPanelFetch({}, null)
    render(<BestBallSettingsCommissionerPanel leagueId="L1" sport="NBA" canEdit />)
    const select = (await screen.findByTestId('bb-scoring-period')) as HTMLSelectElement
    expect(options(select)).toEqual(['weekly', 'daily'])
    expect(select.disabled).toBe(false)
    expect(screen.getByTestId('bb-scoring-period-help').textContent).toMatch(/Daily \(NBA, NHL and MLB\)/)
    fireEvent.change(select, { target: { value: 'daily' } })
    expect(screen.getByTestId('bb-scoring-period-help').textContent).toMatch(/week score is the sum of the days/)
    // The sport line reads the league's period, not the sport default.
    expect(screen.getByText(/daily scoring/)).toBeTruthy()
    fireEvent.click(screen.getByText('Save Best Ball settings'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const body = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, { body: string }])[1].body)
    expect(body.bestBall.scoringPeriod).toBe('daily')
  })

  it("states the LEAGUE'S starter seats (what its matchups score), not the sport default — finding #22", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        league: {
          structureLock: null,
          settings: { mode: 'standard', contestStructure: 'season_long', matchupFormat: 'h2h', scoringPeriod: 'weekly' },
          profile: { lineupSlots: [{ code: 'PG', count: 1 }, { code: 'SG', count: 1 }, { code: 'C', count: 2 }, { code: 'UTIL', count: 4 }] },
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<BestBallSettingsCommissionerPanel leagueId="L1" sport="NBA" canEdit />)
    await screen.findByTestId('bb-scoring-period')
    await waitFor(() => expect(screen.getByText(/^8 starter slots/)).toBeTruthy())
  })

  it('before the league loads, the sport default is the best_ball template (NBA 11, not the old 9)', async () => {
    stubPanelFetch({}, null)
    render(<BestBallSettingsCommissionerPanel leagueId="L1" sport="NBA" canEdit />)
    await screen.findByTestId('bb-scoring-period')
    expect(screen.getByText(/^11 starter slots/)).toBeTruthy()
  })

  it('offers weekly only for NFL, and never offers a tournament switch to a league that is not one', async () => {
    stubPanelFetch({}, null)
    render(<BestBallSettingsCommissionerPanel leagueId="L1" sport="NFL" canEdit />)
    const select = (await screen.findByTestId('bb-scoring-period')) as HTMLSelectElement
    expect(options(select)).toEqual(['weekly'])
    const contest = screen.getAllByRole('combobox').find((s) => options(s as HTMLSelectElement).includes('season_long')) as HTMLSelectElement
    expect(options(contest)).toEqual(['season_long', 'sit_and_go'])
  })

  it('a tournament keeps its option and is never offered daily', async () => {
    stubPanelFetch({ contestStructure: 'tournament' }, null)
    render(<BestBallSettingsCommissionerPanel leagueId="L1" sport="NBA" canEdit />)
    const select = (await screen.findByTestId('bb-scoring-period')) as HTMLSelectElement
    expect(options(select)).toEqual(['weekly'])
    const contest = screen.getAllByRole('combobox').find((s) => options(s as HTMLSelectElement).includes('season_long')) as HTMLSelectElement
    expect(options(contest)).toContain('tournament')
  })

  it('after the draft: a lock notice, scoring and competition read-only, transactions still editable', async () => {
    stubPanelFetch({}, 'after the draft has started')
    render(<BestBallSettingsCommissionerPanel leagueId="L1" sport="NBA" canEdit />)
    const select = (await screen.findByTestId('bb-scoring-period')) as HTMLSelectElement
    expect(screen.getByTestId('bb-structure-lock').textContent).toMatch(/locked: the draft has started/)
    expect(select.disabled).toBe(true)
    for (const s of screen.getAllByRole('combobox')) expect((s as HTMLSelectElement).disabled).toBe(true)
    for (const input of screen.getAllByRole('spinbutton')) expect((input as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('switch', { name: 'Trades' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('switch', { name: 'Waivers' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('the Best Ball tab', () => {
  it('a daily league\'s card counts each player across his days and is labelled daily', () => {
    const card = buildNativeLineupCard({
      rosterId: 'R1',
      teamName: 'Team',
      matchupFinal: true,
      opponentPoints: 40,
      side: {
        points: 55,
        allFinal: true,
        bestBall: {
          period: 'daily',
          assignments: [],
          counted: [
            { playerId: 'X', playerName: 'Guard X', points: 30, days: 1 },
            { playerId: 'Y', playerName: 'Guard Y', points: 25, days: 2 },
          ],
        },
      },
      weekRoster: [
        { playerId: 'X', playerName: 'Guard X', position: 'PG', team: 'BOS', slotType: 'BN' },
        { playerId: 'Y', playerName: 'Guard Y', position: 'PG', team: 'BOS', slotType: 'BN' },
        { playerId: 'Z', playerName: 'Guard Z', position: 'PG', team: 'BOS', slotType: 'BN' },
      ],
      pointsByPlayer: new Map([['X', 30], ['Y', 25], ['Z', 12]]),
      slots: [{ slot: 'G', eligible: ['PG'] }],
    })
    expect(card).toMatchObject({ scoringPeriod: 'daily', totalPoints: 55, winLoss: 'W', status: 'final' })
    expect(card.starters.map((s) => [s.name, s.points, s.slot])).toEqual([['Guard X', 30, '1 day'], ['Guard Y', 25, '2 days']])
    expect(card.bench.map((b) => b.playerId)).toEqual(['Z'])
    expect(card.bench[0]!.reason).toMatch(/Scored 12\.00 this week/)
  })

  it('a weekly league\'s card is built exactly as before', () => {
    const card = buildNativeLineupCard({
      rosterId: 'R1',
      teamName: 'Team',
      matchupFinal: true,
      opponentPoints: null,
      side: { points: 30, bestBall: { assignments: [{ slot: 'G', playerId: 'X', points: 30 }], unfilledSlots: [] } },
      weekRoster: [{ playerId: 'X', playerName: 'Guard X', position: 'PG', team: 'BOS', slotType: 'BN' }],
      pointsByPlayer: new Map([['X', 30]]),
      slots: [{ slot: 'G', eligible: ['PG'] }],
    })
    expect(card).not.toHaveProperty('scoringPeriod')
    expect(card.starters).toEqual([{ playerId: 'X', name: 'Guard X', position: 'PG', team: 'BOS', points: 30, slot: 'G' }])
  })

  function stubTab(scoringPeriod: 'daily' | 'weekly') {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          league: { id: 'L1', name: 'L', sport: 'NBA', season: 2026, summary: 'Best Ball', settings: { mode: 'standard', draftMode: 'snake', contestStructure: 'season_long', matchupFormat: 'h2h', waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false, playoffTeams: 0, scoringPeriod }, profile: { label: 'NBA', scoringPeriod: 'weekly', recommendedRosterSize: 15, lineupSlots: [], notes: [] } },
          source: 'native',
          selectedWeek: 1,
          weeksAvailable: [1],
          lineups: [
            {
              rosterId: 'R1', teamName: 'Team One', totalPoints: 55, winLoss: null, status: 'final', awaitingStats: 0, unfilledSlots: [],
              ...(scoringPeriod === 'daily' ? { scoringPeriod: 'daily' } : {}),
              starters: [{ playerId: 'X', name: 'Guard X', position: 'PG', team: 'BOS', points: 30, slot: scoringPeriod === 'daily' ? '1 day' : 'G' }],
              bench: [],
            },
          ],
          rosterComposition: [],
          standings: [],
          history: [],
        }),
      })),
    )
  }

  it('says "daily best ball" for a daily league', async () => {
    stubTab('daily')
    render(<BestBallTab leagueId="L1" sport="NBA" />)
    await waitFor(() => expect(screen.getByTestId('bestball-lineup-daily').textContent).toBe('Daily best ball'))
    expect(screen.getByTestId('bestball-lineup-explainer').textContent).toMatch(/each day the highest-scoring legal lineup/)
    expect(screen.getByText('1 day')).toBeTruthy()
  })

  it('keeps the weekly wording for a weekly league', async () => {
    stubTab('weekly')
    render(<BestBallTab leagueId="L1" sport="NBA" />)
    await waitFor(() => expect(screen.getByTestId('bestball-lineup-explainer').textContent).toMatch(/Each week the highest-scoring legal lineup/))
    expect(screen.queryByTestId('bestball-lineup-daily')).toBeNull()
  })
})
