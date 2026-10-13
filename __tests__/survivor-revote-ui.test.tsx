import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SurvivorRevote } from '@/components/survivor/SurvivorRevote'

afterEach(() => vi.unstubAllGlobals())

it('reads the sanitized state and sends a private ballot through existing Survivor routes', async () => {
  const state = { tribalCouncil: {
    active: true, councilId: 'revote-1', week: 3, status: 'voting_open', phase: 'revote', isRevealed: false,
    you: { isEligibleVoter: true, hasVoted: false, eligibleTargets: [{ userId: 'target-1', displayName: 'Target One' }] },
    revote: { candidates: [{ userId: 'target-1', displayName: 'Target One', firstRoundVotes: 2 }], deadline: new Date(Date.now() + 7_200_000).toISOString(), originalCouncilId: 'first-1' },
    reveal: null,
  } }
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: true, json: async () => options?.method === 'POST' ? { ok: true } : state }))
  vi.stubGlobal('fetch', fetchMock)
  render(<SurvivorRevote leagueId="league-1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Target One' }))
  fireEvent.click(screen.getByRole('button', { name: 'Drop revote in the urn' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leagues/league-1/survivor/submit-vote', expect.objectContaining({ method: 'POST' })))
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/leagues/league-1/survivor/state')
})
