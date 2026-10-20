import React from 'react'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ScoringTypeEditor } from '@/components/league-settings/ScoringTypeEditor'

/*
 * The commissioner's scoring-type editor: switch type, add / remove / reorder categories, and save
 * through the mid-season confirmation like every other scoring editor.
 */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

const NBA = {
  current: { mode: 'h2h_category', presetId: 'nba_8cat_standard', recordMode: 'most', categoryIds: ['nba_pts', 'nba_reb', 'nba_ast'] },
  options: {
    modes: ['points', 'h2h_category'],
    presets: [
      { id: 'nba_8cat_standard', categoryIds: ['nba_pts', 'nba_reb', 'nba_ast'] },
      { id: 'nba_9cat', categoryIds: ['nba_pts', 'nba_reb', 'nba_ast', 'nba_to'] },
    ],
    catalog: [
      { id: 'nba_pts', label: 'PTS', description: null, direction: 'higher' },
      { id: 'nba_reb', label: 'REB', description: null, direction: 'higher' },
      { id: 'nba_ast', label: 'AST', description: null, direction: 'higher' },
      { id: 'nba_to', label: 'TO', description: null, direction: 'lower' },
    ],
  },
}

function mockApi(midSeason: boolean) {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      if (midSeason && body.confirmMidSeasonChange !== true) {
        return json({ code: 'mid_season_confirmation_required', message: 'season started', error: 'season started' }, 409)
      }
      return json({ ok: true, changed: true, effectiveFromWeek: midSeason ? 6 : null, ...NBA, current: { ...NBA.current, ...body } })
    }
    return json(NBA)
  })
}

const putBodies = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>)

beforeEach(() => fetchMock.mockReset())
afterEach(() => cleanup())

describe('ScoringTypeEditor', () => {
  it('add, remove and reorder are sent as an ordered categoryIds list', async () => {
    mockApi(false)
    const onChanged = vi.fn()
    render(<ScoringTypeEditor leagueId="L1" isCommissioner onChanged={onChanged} />)
    await screen.findByTestId('scoring-type-editor')

    fireEvent.change(screen.getByTestId('scoring-type-add'), { target: { value: 'nba_to' } })
    fireEvent.click(within(screen.getByTestId('scoring-type-category-nba_reb')).getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(screen.getByTestId('scoring-type-category-nba_ast')).getByRole('button', { name: 'Move up' }))
    fireEvent.click(screen.getByTestId('scoring-type-save'))

    await waitFor(() => expect(putBodies()).toHaveLength(1))
    expect(putBodies()[0]).toEqual({ mode: 'h2h_category', presetId: 'nba_8cat_standard', recordMode: 'most', categoryIds: ['nba_ast', 'nba_pts', 'nba_to'] })
    await screen.findByText('Scoring type saved.')
    expect(onChanged).toHaveBeenCalled()
  })

  it('switching to points sends only the mode', async () => {
    mockApi(false)
    render(<ScoringTypeEditor leagueId="L1" isCommissioner />)
    await screen.findByTestId('scoring-type-editor')
    fireEvent.change(screen.getByTestId('scoring-type-mode'), { target: { value: 'points' } })
    expect(screen.queryByTestId('scoring-type-categories')).toBeNull()
    fireEvent.click(screen.getByTestId('scoring-type-save'))
    await waitFor(() => expect(putBodies()).toEqual([{ mode: 'points' }]))
  })

  it('mid-season: asks first, re-sends with the flag on confirm, and says from which week it applies', async () => {
    mockApi(true)
    render(<ScoringTypeEditor leagueId="L1" isCommissioner />)
    await screen.findByTestId('scoring-type-editor')
    fireEvent.click(screen.getByTestId('scoring-type-save'))
    await screen.findByTestId('mid-season-confirm-dialog')
    fireEvent.click(screen.getByTestId('mid-season-confirm-accept'))
    await waitFor(() => expect(putBodies()).toHaveLength(2))
    expect(putBodies()[1]).toMatchObject({ confirmMidSeasonChange: true })
    await screen.findByText(/applies from week 6/)
  })

  it('read-only for a non-commissioner, and nothing at all for a points-only sport', async () => {
    mockApi(false)
    const { unmount } = render(<ScoringTypeEditor leagueId="L1" />)
    await screen.findByTestId('scoring-type-editor')
    expect(screen.queryByTestId('scoring-type-save')).toBeNull()
    expect(screen.getByTestId('scoring-type-mode')).toBeDisabled()
    unmount()

    fetchMock.mockImplementation(() => json({ ...NBA, current: { mode: 'points', presetId: null, recordMode: null, categoryIds: [] }, options: { modes: ['points'], presets: [], catalog: [] } }))
    render(<ScoringTypeEditor leagueId="L2" isCommissioner />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('scoring-type-editor')).toBeNull()
  })
})
