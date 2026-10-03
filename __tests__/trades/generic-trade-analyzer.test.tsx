// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { GenericTradeAnalyzer } from '@/components/core-app/screens/GenericTradeAnalyzer'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  window.localStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('league-free trade analyzer', () => {
  it('sends a neutral, league-free market analysis and shows both sides', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        grade: {
          graded: true, letter: 'B', partnerLetter: 'D', label: 'Slightly favors you',
          recommendation: 'Review the market gap.', giveMarket: 100, getMarket: 120,
          basis: 'General market values', lines: [],
        },
      }),
    })
    render(<GenericTradeAnalyzer />)
    fireEvent.change(screen.getByLabelText('Team A sends'), { target: { value: 'Player One' } })
    fireEvent.change(screen.getByLabelText('Team B sends'), { target: { value: 'Player Two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze trade' }))
    await screen.findByText('Slightly favors you')
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ sportFilter: 'NFL', leagueId: null, strategy: 'neutral', teamContext: 'neutral' })
    expect(body.sideGive).toEqual([{ kind: 'player', name: 'Player One', sportHint: 'NFL' }])
    expect(body.sideGet).toEqual([{ kind: 'player', name: 'Player Two', sportHint: 'NFL' }])
    expect(screen.getAllByText('B').length).toBeGreaterThan(0)
    expect(screen.getAllByText('D').length).toBeGreaterThan(0)
  })

  it('requires review after screenshot extraction before analysis', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ teamA: ['Player One'], teamB: ['Player Two'], reviewNotes: ['A third line was unreadable'] }) })
    render(<GenericTradeAnalyzer />)
    const file = new File(['image'], 'trade.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Import screenshot'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByLabelText('Team A sends')).toHaveProperty('value', 'Player One'))
    expect(screen.getByText('A third line was unreadable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Swap Team A and Team B' }))
    expect(screen.getByLabelText('Team A sends')).toHaveProperty('value', 'Player Two')
    fireEvent.change(screen.getByLabelText('Team B sends'), { target: { value: 'Corrected Player' } })
    const analyze = screen.getByRole('button', { name: 'Analyze trade' }) as HTMLButtonElement
    expect(analyze.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('I checked the assets and which team sends each one.'))
    expect(analyze.disabled).toBe(false)
  })

  it('explains the generic grade with asset sources and excluded factors', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({
      grade: { graded: true, letter: 'B', partnerLetter: 'D', percentDiff: 17,
        label: 'Slightly favors you', recommendation: 'A clear win on league value.',
        giveMarket: 100, getMarket: 120, basis: 'General market values',
        lines: [{ side: 'give', name: 'Player One', marketValue: 100, leagueValue: 100, valueSource: 'fantasycalc', valueAsOf: '2026-10-01T00:00:00Z' }],
      },
    }) })
    render(<GenericTradeAnalyzer />)
    fireEvent.change(screen.getByLabelText('Team A sends'), { target: { value: 'Player One' } })
    fireEvent.change(screen.getByLabelText('Team B sends'), { target: { value: 'Player Two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze trade' }))
    await screen.findByText(/Team A receives 120 in general market value/)
    expect(screen.queryByText('A clear win on league value.')).toBeNull()
    expect(screen.getByText(/Position matters only through each asset’s quoted value/)).toBeTruthy()
    expect(screen.getByText(/injury risk, acceptance likelihood, and future results are not priced separately/)).toBeTruthy()
    fireEvent.click(screen.getByText('Why this grade? View asset values and sources'))
    expect(screen.getByText(/fantasycalc · as of/)).toBeTruthy()
  })

  it('converts a known overall pick into a 12-team reference tier', () => {
    render(<GenericTradeAnalyzer />)
    fireEvent.change(screen.getByLabelText('Overall pick, if known'), { target: { value: '13' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to A' }))
    expect((screen.getByLabelText('Team A sends') as HTMLTextAreaElement).value).toMatch(/round 2 early/)
  })

  it('saves a dated comparison on this device for later review', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({
      grade: { graded: true, letter: 'B', partnerLetter: 'D', label: 'Slightly favors you',
        recommendation: 'Review the market gap.', giveMarket: 100, getMarket: 120,
        basis: 'General market values', lines: [] },
    }) })
    const view = render(<GenericTradeAnalyzer />)
    fireEvent.change(screen.getByLabelText('Team A sends'), { target: { value: 'Player One' } })
    fireEvent.change(screen.getByLabelText('Team B sends'), { target: { value: 'Player Two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze trade' }))
    await screen.findByText('Slightly favors you')
    fireEvent.click(screen.getByRole('button', { name: 'Save this comparison' }))
    expect(screen.getByText(/Comparison saved on this device/)).toBeTruthy()
    view.unmount()
    render(<GenericTradeAnalyzer />)
    expect(await screen.findByText('Saved comparisons (1)')).toBeTruthy()
  })
})
