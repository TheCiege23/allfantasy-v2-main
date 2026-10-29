import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SurvivorCouncilControl } from '@/components/survivor/SurvivorCouncilControl'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const state = {
  councilId: 'c', week: 6, status: 'voting_open', deadline: '2026-10-16T00:00:00Z',
  autoReveal: true, lineupsLocked: true, scoringFinal: true, immunitySet: true,
  paused: false, canControl: true, canReveal: false, isRevealed: false, idolsHidden: true,
  afterReadComplete: false, submittedCount: 1, eligibleVoterCount: 2,
  voters: [{ userId: 'a', name: 'Manager A', status: 'voted', nudged: false }, { userId: 'b', name: 'Manager B', status: 'not_yet', nudged: false }],
  audit: [{ id: 'log', actionType: 'council_vote_nudge', executedAt: '2026-10-15T12:00:00Z' }],
  exactTieCandidates: [], canResolveExactTie: false,
}

it('highlights the live stage and disables the read until votes close', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => state })))
  render(<SurvivorCouncilControl leagueId="league-1" />)
  await screen.findByText('Tribal Council control - week 6')
  const timeline = screen.getByRole('list', { name: 'Council timeline' })
  expect(within(timeline).getByText('Lineups lock')).toBeInTheDocument()
  expect(timeline.querySelector('[aria-current="step"]')).toHaveTextContent('Votes close')
  expect(screen.getByRole('button', { name: 'Start the reveal' })).toBeDisabled()
  expect(screen.getByRole('list', { name: 'Council checklist' }).children).toHaveLength(5)
  expect(screen.getByText('One vote reminder sent')).toBeInTheDocument()
})

it('closes once through the existing route and enables the ready read after refresh', async () => {
  let closed = false
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/close-vote-window')) closed = true
    return { ok: true, json: async () => ({ ...state, status: closed ? 'closed' : 'voting_open', canReveal: closed }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<SurvivorCouncilControl leagueId="league-1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Close votes now' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start the reveal' })).toBeEnabled())
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/close-vote-window'))).toHaveLength(1)
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/tally-votes'))).toBe(false)
})

it('keeps playing commissioners read-only and paused leagues unable to reveal', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...state, canControl: false, paused: true, canReveal: true, status: 'closed' }) })))
  render(<SurvivorCouncilControl leagueId="league-1" />)
  expect(await screen.findByRole('button', { name: 'Resume league' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Manual reveal' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Start the reveal' })).toBeDisabled()
  expect(screen.getByText(/Your control page is read-only/)).toBeInTheDocument()
})

it('sends pause and resume through the foundation route', async () => {
  let paused = false
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/pause-league')) paused = true
    if (url.endsWith('/resume-league')) paused = false
    return { ok: true, json: async () => ({ ...state, paused }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<SurvivorCouncilControl leagueId="league-1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Pause league' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Resume league' }))
  await screen.findByRole('button', { name: 'Pause league' })
  expect(fetchMock.mock.calls.map(([url]) => url)).toContain('/api/leagues/league-1/survivor/resume-league')
  expect(fetchMock.mock.calls.every(([url]) => url.startsWith('/api/leagues/league-1/survivor/'))).toBe(true)
})

it('loads the commissioner control through the existing Survivor action route', async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({
    councilId: 'council-1', week: 3, status: 'voting_open', deadline: '2026-10-14T00:00:00Z',
    autoReveal: true, scoringFinal: true, immunitySet: true, paused: false, canReveal: false,
    isRevealed: false, submittedCount: 0, eligibleVoterCount: 1, voters: [], audit: [],
    exactTieCandidates: [], canResolveExactTie: false,
  }) }))
  vi.stubGlobal('fetch', fetchMock)
  render(<SurvivorCouncilControl leagueId="league-1" />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/leagues/league-1/survivor/council-control')
})
