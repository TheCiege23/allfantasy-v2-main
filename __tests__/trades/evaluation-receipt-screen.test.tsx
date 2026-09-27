// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ useSearchParams: () => null }))
import { TradeEvaluationReceipt } from '@/components/core-app/screens/TradeEvaluationReceipt'

const original = {
  version: 1, model: 'trade-value-league-scoring-v1', evaluatedAt: '2026-09-27T12:00:00.000Z', sourceUpdatedAt: null, origin: 'calculator',
  league: { id: 'league-a', name: 'Dynasty', sport: 'NFL', leagueType: 'dynasty', leagueSize: 12, isDynasty: true, scoring: 'PPR', scoringRules: {} },
  input: { sportFilter: 'ALL', leagueId: 'league-a', strategy: 'neutral', teamContext: 'my_team', analysisTab: 'raw',
    sideGive: [{ kind: 'player', name: 'DK Metcalf' }], sideGet: [{ kind: 'pick', year: 2027, round: 2 }] },
  grade: { graded: true, letter: 'D', partnerLetter: 'B', percentDiff: -10, basis: 'Dynasty · Superflex · 12 teams · PPR', giveValue: 1766, getValue: 1584,
    scoringApplied: false, needApplied: false, lines: [{ side: 'give', name: 'DK Metcalf', marketValue: 1766, leagueValue: 1766 }, { side: 'get', name: '2027 2nd', marketValue: 1584, leagueValue: 1584 }] },
  dataGaps: [], sources: ['fantasycalc'], assetSources: [],
}
const fetchMock = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); window.history.replaceState({}, '', '/core/trades?league=league-a&evaluation=receipt-1') })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body })

it('shows the original grade and values beside a separate current evaluation', async () => {
  fetchMock.mockResolvedValueOnce(response({ receipt: original }))
  render(<TradeEvaluationReceipt leagueId="league-a" viewerId="account-a" />)
  await settle()
  expect(screen.getByText(/Price source update time was not available/)).toBeTruthy()
  expect(screen.getByText('1,766')).toBeTruthy()
  fetchMock.mockResolvedValueOnce(response({ grade: { ...original.grade, letter: 'C', partnerLetter: 'C', percentDiff: -8, giveValue: 1703,
    lines: [{ ...original.grade.lines[0], marketValue: 1703, leagueValue: 1703 }, original.grade.lines[1]] } }))
  fireEvent.click(screen.getByRole('button', { name: 'Compare with current values' }))
  await settle()
  expect(screen.getByText('Original values')).toBeTruthy()
  expect(screen.getByText('Current values')).toBeTruthy()
  expect(screen.getByText('1,766')).toBeTruthy()
  expect(screen.getByText('1,703')).toBeTruthy()
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ leagueId: 'league-a', skipAi: true, sideGive: original.input.sideGive })
})

it('preserves the original when the current evaluation cannot be loaded', async () => {
  fetchMock.mockResolvedValueOnce(response({ receipt: original }))
  render(<TradeEvaluationReceipt leagueId="league-a" viewerId="account-a" />)
  await settle()
  fetchMock.mockResolvedValueOnce(response({}, 503))
  fireEvent.click(screen.getByRole('button', { name: 'Compare with current values' }))
  await settle()
  expect(screen.getByRole('alert').textContent).toContain('original evaluation is unchanged')
  expect(screen.getByText('1,766')).toBeTruthy()
  expect(screen.queryByText('Current values')).toBeNull()
})

it('does not render a receipt from another league', async () => {
  fetchMock.mockResolvedValueOnce(response({ receipt: { ...original, league: { ...original.league, id: 'league-b' } } }))
  render(<TradeEvaluationReceipt leagueId="league-a" viewerId="account-a" />)
  await settle()
  expect(screen.getByRole('alert').textContent).toContain('different league')
  expect(screen.queryByText('1,766')).toBeNull()
})

it('discards a late comparison after the manager switches leagues', async () => {
  fetchMock.mockResolvedValueOnce(response({ receipt: original }))
  const view = render(<TradeEvaluationReceipt leagueId="league-a" viewerId="account-a" />)
  await settle()
  let finish!: (value: unknown) => void
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Compare with current values' }))
  fetchMock.mockResolvedValueOnce(response({}, 404))
  view.rerender(<TradeEvaluationReceipt leagueId="league-b" viewerId="account-a" />)
  await settle()
  await act(async () => { finish(response({ grade: original.grade })); await Promise.resolve() })
  expect(screen.queryByText('Current values')).toBeNull()
  expect(screen.queryByText('1,766')).toBeNull()
})
