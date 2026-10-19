import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SurvivorSeasonStory } from '@/components/survivor/SurvivorSeasonStory'
import { buildSeasonTimeline } from '@/lib/survivor/seasonStory'

const nodes = buildSeasonTimeline({
  season: 2026, currentSeason: 2026, firstWeek: 1, lastWeek: 4, draftComplete: true, now: new Date('2026-10-18T00:00:00Z'),
  moments: [{ id: 'a', type: 'out', week: 1, final: true, published: false, displayName: 'Open Team 3', season: 2026, tribeName: 'Vela', tally: '3–1' }, { id: 'b', type: 'idol', week: 2, final: true, published: false, displayName: 'Hidden Holder', season: 2026, tribeName: null }],
  swaps: [], jurors: [], mergeWeek: null, mergedTribeName: null, mergedCount: null,
})
const view = { leagueName: 'Blah Survivor', sport: 'NFL', season: 2026, seasons: [2026, 2025], nodes, trophies: [{ season: 2025, championName: 'Open Team 5', sport: 'NFL', line: 'Jury 4–1' }], records: [] }

describe('SurvivorSeasonStory', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('opens on the latest revealed week, switches cards, shows the trophy case and season tabs', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(view), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SurvivorSeasonStory leagueId="L1" backHref="/league/L1" />)
    await waitFor(() => expect(screen.getByTestId('survivor-season-card')).toBeTruthy())
    expect(screen.getByRole('heading', { level: 2, name: 'An idol was played' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('Hidden Holder')
    fireEvent.click(screen.getByRole('button', { name: /Wk 1/ }))
    expect(screen.getByRole('heading', { level: 2, name: 'Open Team 3’s torch is out' })).toBeTruthy()
    expect(screen.getByTestId('survivor-trophy').textContent).toContain('Open Team 5')
    fireEvent.click(screen.getByRole('button', { name: '2025' }))
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/leagues/L1/survivor/season-story?season=2025', expect.anything()))
  })
})
