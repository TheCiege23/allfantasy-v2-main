import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BigBrotherRulesEditor } from '@/components/big-brother/BigBrotherRulesEditor'

/** The commissioner's Big Brother rules editor: loads the live rules, sends only what changed, shows the server's answer. */

const config = {
  hohChallengeDayOfWeek: 4, hohChallengeTimeUtc: '00:00', nominationDeadlineDayOfWeek: 5, nominationDeadlineTimeUtc: '20:00',
  vetoDrawDayOfWeek: null, vetoDrawTimeUtc: null, evictionTieBreakMode: 'season_points', challengeMode: 'hybrid',
  publicVoteTotalsVisibility: 'evicted_only', autoNominationFallback: 'lowest_season_points', vetoCompetitorCount: 6,
  consecutiveHohAllowed: false, hohVotesOnlyInTie: true, finaleFormat: 'final_2', juryStartMode: 'after_eliminations',
  juryStartAfterEliminations: 7, juryStartWhenRemaining: null, juryStartWeek: null,
}
const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => (init?.method === 'PATCH' ? json({ ok: true }) : json({ config, juryAndFinaleOpen: true })))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(init.body))

describe('BigBrotherRulesEditor', () => {
  it('shows the stored rules and saves only the settings that changed', async () => {
    render(<BigBrotherRulesEditor leagueId="lg 1" />)
    const tie = (await screen.findByTestId('bb-rule-evictionTieBreakMode')) as HTMLSelectElement
    expect(tie.value).toBe('season_points')
    expect((screen.getByTestId('bb-rule-nominationDeadlineDayOfWeek') as HTMLSelectElement).value).toBe('5')
    expect((screen.getByTestId('bb-rules-save') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(tie, { target: { value: 'commissioner' } })
    fireEvent.change(screen.getByTestId('bb-rule-vetoDrawDayOfWeek'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('bb-rule-vetoDrawTimeUtc'), { target: { value: '18:30' } })
    fireEvent.click(screen.getByTestId('bb-rules-save'))

    await screen.findByText('Saved. The league log records the change.')
    expect(patches()).toEqual([{ evictionTieBreakMode: 'commissioner', vetoDrawDayOfWeek: 3, vetoDrawTimeUtc: '18:30' }])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/leagues/lg%201/big-brother/config')
    // Saved is the new baseline: nothing left to save.
    expect((screen.getByTestId('bb-rules-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a deadline can be cleared back to "Not scheduled"', async () => {
    render(<BigBrotherRulesEditor leagueId="lg" />)
    fireEvent.change(await screen.findByTestId('bb-rule-hohChallengeDayOfWeek'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('bb-rules-save'))
    await waitFor(() => expect(patches()).toEqual([{ hohChallengeDayOfWeek: null }]))
  })

  it('shows the server\'s refusal as it comes (the Format rules lock, a bad value)', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === 'PATCH' ? json({ error: 'Format rules are locked for this season.' }, 423) : json({ config, juryAndFinaleOpen: true }))
    render(<BigBrotherRulesEditor leagueId="lg" />)
    fireEvent.click(await screen.findByTestId('bb-rule-consecutiveHohAllowed'))
    fireEvent.click(screen.getByTestId('bb-rules-save'))
    expect(await screen.findByText('Format rules are locked for this season.')).toBeTruthy()
  })

  it('after the first eviction, jury and finale are shown but cannot be changed', async () => {
    fetchMock.mockImplementation(async () => json({ config, juryAndFinaleOpen: false }))
    render(<BigBrotherRulesEditor leagueId="lg" />)
    expect(await screen.findByTestId('bb-rules-jury-closed')).toBeTruthy()
    expect((screen.getByTestId('bb-rule-finaleFormat') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByTestId('bb-rule-juryStartMode') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByTestId('bb-rule-jury-number') as HTMLInputElement).disabled).toBe(true)
    // The rules that govern the next vote still can.
    expect((screen.getByTestId('bb-rule-evictionTieBreakMode') as HTMLSelectElement).disabled).toBe(false)
  })

  it('the jury number follows the chosen jury mode', async () => {
    render(<BigBrotherRulesEditor leagueId="lg" />)
    const number = (await screen.findByTestId('bb-rule-jury-number')) as HTMLInputElement
    expect(number.value).toBe('7')
    fireEvent.change(screen.getByTestId('bb-rule-juryStartMode'), { target: { value: 'when_remaining' } })
    fireEvent.change(screen.getByTestId('bb-rule-jury-number'), { target: { value: '9' } })
    fireEvent.click(screen.getByTestId('bb-rules-save'))
    await waitFor(() => expect(patches()).toEqual([{ juryStartMode: 'when_remaining', juryStartWhenRemaining: 9 }]))
  })

  it('offers none of the settings the game never reads', async () => {
    render(<BigBrotherRulesEditor leagueId="lg" />)
    await screen.findByTestId('bb-rules-editor')
    for (const dead of ['finalNomineeCount', 'antiCollusionLogging', 'inactivePlayerHandling', 'waiverReleaseTiming']) {
      expect(screen.queryByTestId(`bb-rule-${dead}`)).toBeNull()
    }
  })
})
