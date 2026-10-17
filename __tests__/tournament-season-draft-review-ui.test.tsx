import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SeasonDraftReviewPanel } from '@/components/tournament/SeasonDraftReviewPanel'
const setup: any = { freezeId: 'f1', launchReady: false, leagues: [1, 2].map(i => ({ key: 'pool-' + i, leagueId: 'league-' + i, name: 'Opening ' + i, slots: 8, state: 'created' })) }
const report = (key: string, state = 'completed') => ({ key, state, filledPicks: 96, totalPicks: 96, blockers: state === 'completed' ? [] : ['A completion checkpoint is pending.'], launchReady: false, gates: [{ key: 'runtime', label: 'Weekly scoring, lineups and player moves', state: 'pending' }] })
beforeEach(() => vi.restoreAllMocks())
it('checks one league per request, displays real statuses and keeps launch locked', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(report('pool-1')))).mockResolvedValueOnce(new Response(JSON.stringify(report('pool-2', 'checkpoint_pending'))))
  render(<SeasonDraftReviewPanel tournamentId="t1" setup={setup} />)
  fireEvent.click(screen.getByRole('button', { name: 'Review opening drafts' }))
  expect(await screen.findByText('Completion pending')).toBeInTheDocument()
  expect(screen.getByText('Draft verified')).toBeInTheDocument()
  expect(screen.getByText('Season launch locked')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Checked 2 of 2 drafts · 1 verified')
  expect(screen.getByText('Weekly scoring, lineups and player moves')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /launch season/i })).not.toBeInTheDocument()
  expect(fetch.mock.calls.map(c => JSON.parse(c[1]!.body as string))).toEqual(['pool-1', 'pool-2'].map(key => ({ action: 'review_draft', tournamentId: 't1', freezeId: 'f1', key })))
})
it('preserves successful reports on failure and offers retry', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(report('pool-1')))).mockRejectedValueOnce(new Error('Network unavailable'))
  render(<SeasonDraftReviewPanel tournamentId="t1" setup={setup} />)
  fireEvent.click(screen.getByRole('button', { name: 'Review opening drafts' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable')
  expect(within(screen.getByRole('region', { name: 'Opening draft review' })).getByText('Draft verified')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Review opening drafts' })).toBeEnabled()
})
it('does not run checks before league creation', () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  render(<SeasonDraftReviewPanel tournamentId="t1" setup={{ ...setup, leagues: setup.leagues.map((l: any) => ({ ...l, leagueId: null })) }} />)
  expect(screen.getByRole('button', { name: 'Review opening drafts' })).toBeDisabled()
  expect(fetch).not.toHaveBeenCalled()
})

it('prepares verified rosters without presenting season activation', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(report('pool-1')))).mockResolvedValueOnce(new Response(JSON.stringify({ prepared: true, launchReady: false })))
  render(<SeasonDraftReviewPanel tournamentId="t1" setup={{ ...setup, leagues: [setup.leagues[0]] }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Review opening drafts' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare Opening 1 rosters' }))
  expect(await screen.findByText('Rosters prepared · player moves locked')).toBeInTheDocument()
  expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual({ action: 'prepare_rosters', tournamentId: 't1', freezeId: 'f1', key: 'pool-1' })
  expect(screen.getByText('Season launch locked')).toBeInTheDocument()
})
