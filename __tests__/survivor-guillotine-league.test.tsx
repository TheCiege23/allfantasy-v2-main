import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSGConfig } from '@/lib/survivor-guillotine/config'
import { SurvivorGuillotineLeague } from '@/components/survivor-guillotine/SurvivorGuillotineLeague'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Survivor Guillotine league home', () => {
  it('keeps commissioner controls and concealed reward weeks out of a member view', async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith('/operations')
      ? { ok: false, json: async () => ({ error: 'Commissioner access required' }) }
      : { ok: true, json: async () => ({ season: { config: defaultSGConfig(), tribes: [], periodState: null,
        currentPeriod: 0, status: 'setup', periodHistory: {} }, ownRoster: null, teams: [], scores: [],
        powers: [], chops: [] }) })
    vi.stubGlobal('fetch', fetcher)
    render(<SurvivorGuillotineLeague leagueId="league" />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your lineup' })).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Tribe race' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Commissioner control' })).toBeNull()
    expect(screen.queryByText(/Concealed reward periods/)).toBeNull()
  })
})
