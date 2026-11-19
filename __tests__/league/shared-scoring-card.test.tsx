/**
 * The shared scoring card (components/league-settings/SharedScoringCard.tsx, 2026-11-16): only leagues that can take
 * the change are pickable; picking an in-season league shows what that means and sends the confirmation; each
 * league's outcome comes back as the server reported it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'en' }) }))

import { SharedScoringCard } from '@/components/league-settings/SharedScoringCard'

const view = {
  ok: true,
  source: { id: 'SRC', name: 'Main', sport: 'NFL', presetKey: 'af_ppr', customTable: false, needsPremium: false },
  hasPremium: true,
  leagues: [
    { id: 'A', name: 'Alpha', status: 'ready', incompatibility: null },
    { id: 'B', name: 'Bravo', status: 'mid_season', incompatibility: null },
    { id: 'D', name: 'Delta', status: 'locked', incompatibility: null },
    { id: 'C', name: 'Charlie', status: 'incompatible', incompatibility: 'imported' },
  ],
}
const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('the shared scoring card', () => {
  it('lists leagues with their status; only ready and in-season ones can be picked', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, view))
    render(<SharedScoringCard leagueId="SRC" />)
    fireEvent.click(screen.getByTestId('shared-scoring-toggle'))
    await screen.findByTestId('shared-scoring-leagues')
    expect((screen.getByTestId('shared-scoring-pick-A') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByTestId('shared-scoring-pick-B') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByTestId('shared-scoring-pick-D') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByTestId('shared-scoring-pick-C') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('sharedScoring.status.locked')).toBeTruthy()
    expect(screen.getByText('sharedScoring.why.imported')).toBeTruthy()
    expect((screen.getByTestId('shared-scoring-apply') as HTMLButtonElement).disabled).toBe(true)
  })

  it('picking an in-season league explains it and sends the confirmation; outcomes are shown per league', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, view))
      .mockResolvedValueOnce(
        reply(200, {
          ok: true,
          saved: 2,
          results: [
            { leagueId: 'A', name: 'Alpha', outcome: 'saved', message: null },
            { leagueId: 'B', name: 'Bravo', outcome: 'saved', message: null },
          ],
        }),
      )
      .mockResolvedValueOnce(reply(200, view))
    render(<SharedScoringCard leagueId="SRC" />)
    fireEvent.click(screen.getByTestId('shared-scoring-toggle'))
    fireEvent.click(await screen.findByTestId('shared-scoring-pick-A'))
    expect(screen.queryByTestId('shared-scoring-in-season')).toBeNull()
    expect(screen.getByTestId('shared-scoring-apply').textContent).toBe('sharedScoring.apply')
    fireEvent.click(screen.getByTestId('shared-scoring-pick-B'))
    expect(screen.getByTestId('shared-scoring-in-season')).toBeTruthy()
    expect(screen.getByTestId('shared-scoring-apply').textContent).toBe('sharedScoring.applyConfirm')
    fireEvent.click(screen.getByTestId('shared-scoring-apply'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/commissioner/leagues/SRC/shared-scoring')
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ leagueIds: ['A', 'B'], confirmMidSeasonChange: true })
    expect((await screen.findByTestId('shared-scoring-results')).textContent).toContain('Bravo — sharedScoring.outcome.saved')
  })

  it('a custom table without AF Commissioner cannot be applied, and says why', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, { ...view, hasPremium: false, source: { ...view.source, presetKey: 'custom', customTable: true, needsPremium: true } }),
    )
    render(<SharedScoringCard leagueId="SRC" />)
    fireEvent.click(screen.getByTestId('shared-scoring-toggle'))
    fireEvent.click(await screen.findByTestId('shared-scoring-pick-A'))
    expect(screen.getByTestId('shared-scoring-premium')).toBeTruthy()
    expect((screen.getByTestId('shared-scoring-apply') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a league that cannot share (a category league) says so instead of listing', async () => {
    fetchMock.mockResolvedValueOnce(reply(409, { error: 'Category league — a points table does not apply.' }))
    render(<SharedScoringCard leagueId="SRC" />)
    fireEvent.click(screen.getByTestId('shared-scoring-toggle'))
    expect((await screen.findByTestId('shared-scoring-unavailable')).textContent).toMatch(/Category league/)
    expect(screen.queryByTestId('shared-scoring-apply')).toBeNull()
  })
})
