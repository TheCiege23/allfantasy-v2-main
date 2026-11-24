import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSGConfig } from '@/lib/survivor-guillotine/config'
import { SurvivorGuillotineLeague } from '@/components/survivor-guillotine/SurvivorGuillotineLeague'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Survivor Guilly league home', () => {
  it('keeps commissioner controls and concealed reward weeks out of a member view', async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith('/operations')
      ? { ok: false, json: async () => ({ error: 'Commissioner access required' }) }
      : { ok: true, json: async () => ({ season: { config: defaultSGConfig(), tribes: [], periodState: null,
        currentPeriod: 0, status: 'setup', periodHistory: {} }, ownRoster: null, teams: [], scores: [],
        powers: [], chops: [] }) })
    vi.stubGlobal('fetch', fetcher)
    render(<SurvivorGuillotineLeague leagueId="league" />)
    // 2026-11-24: no lineup card without a team to play; the tribe controls are 'Tribe decisions'.
    await waitFor(() => expect(screen.getByTestId('sg-visual-set')).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Tribe decisions' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Commissioner control' })).toBeNull()
    expect(screen.queryByText(/Concealed reward periods/)).toBeNull()
  })
})
