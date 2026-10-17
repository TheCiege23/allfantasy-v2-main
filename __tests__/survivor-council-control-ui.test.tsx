import { afterEach, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { SurvivorCouncilControl } from '@/components/survivor/SurvivorCouncilControl'

afterEach(() => vi.unstubAllGlobals())

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
