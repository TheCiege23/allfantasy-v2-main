import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SurvivorPremiumCommandCenterPanel } from '@/components/survivor/SurvivorPremiumCommandCenterPanel'

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('SurvivorPremiumCommandCenterPanel', () => {
  it('draws the locks the server reports, and opens a tile by loading it from the server', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/survivor/premium')) {
        return json({ ok: true, plan: 'af_pro', tiles: [
          { tileId: 'threat_map', access: { ok: true } },
          { tileId: 'social_pulse', access: { ok: false, reason: 'plan_required', requiredPlan: 'af_pro' } },
        ] })
      }
      return json({ ok: true, tileId: 'threat_map', data: { scope: 'tribe', scopeName: 'Fire', lastRead: null, rows: [
        { name: 'Ana', isYou: true, seasonPoints: 120, immunityWins: 0, votesAgainst: 0, threat: 'high', onTheBlock: false },
      ] } })
    })
    vi.stubGlobal('fetch', fetchMock)
    // The page claims no plan; the server's answer wins.
    render(<SurvivorPremiumCommandCenterPanel leagueId="lg-1" plan={null} tokensRemaining={null} tilesOnly />)
    const threat = await screen.findByRole('button', { name: /Threat map/ })
    expect(screen.getByTestId('survivor-premium-tile-social_pulse').textContent).toContain('Locked')
    // Locked and unbuilt tiles are not buttons, so they never request data.
    expect(screen.queryByRole('button', { name: /Social pulse/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Risk alerts/ })).toBeNull()

    fireEvent.click(threat)
    await waitFor(() => expect(screen.getByTestId('survivor-premium-detail-threat_map').textContent).toContain('Ana'))
    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/lg-1/survivor/premium?tile=threat_map', expect.objectContaining({ credentials: 'include' }))
    // The player page carries no price lists and no test button.
    expect(screen.queryByText(/token costs/)).toBeNull()
  })
})

describe('Story mode controls', () => {
  it('previews the chosen tone, hides the confessional when off, and saves through the tile endpoint', async () => {
    const { SurvivorPremiumTileDetail } = await import('@/components/survivor/SurvivorPremiumTileDetail')
    const { buildStoryModeTile } = await import('@/lib/survivor/premium/survivorHostTiles')
    const data = buildStoryModeTile({ tone: 'classic', confessionals: true, postToChat: true })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'POST'
      ? json({ ok: true, settings: JSON.parse(String(init.body)) })
      : json({ ok: true, tileId: 'story_mode_controls', data })))
    vi.stubGlobal('fetch', fetchMock)
    render(<SurvivorPremiumTileDetail leagueId="lg-1" tileId="story_mode_controls" title="Story mode controls" />)
    const preview = await screen.findByTestId('story-mode-preview')
    expect(preview.textContent).toContain('The Tribe Has Spoken')
    expect(preview.textContent).toContain('Confessional')

    fireEvent.click(screen.getByRole('radio', { name: /Dramatic/ }))
    expect(screen.getByTestId('story-mode-preview').textContent).toContain('The Torch Goes Dark')
    fireEvent.click(screen.getByRole('checkbox', { name: /confessional/ }))
    expect(screen.getByTestId('story-mode-preview').textContent).not.toContain('Confessional')

    fireEvent.click(screen.getByRole('button', { name: 'Save story mode' }))
    await screen.findByText(/Saved\. The next episode uses these settings\./)
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(post[0]).toBe('/api/leagues/lg-1/survivor/premium?tile=story_mode_controls')
    expect(JSON.parse(String(post[1]!.body))).toEqual({ tone: 'dramatic', confessionals: false, postToChat: true })
  })
})
