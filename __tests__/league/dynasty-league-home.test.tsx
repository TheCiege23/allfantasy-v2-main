/**
 * Dynasty League home (step 5): rafters, season clock, pick capital and pipeline on the native
 * League home — and, just as important, that a non-dynasty league neither fetches nor renders any
 * of it.
 */
import React from 'react'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NativeLeagueHome } from '@/components/league/native/NativeLeagueHome'

const HUB = {
  taxi: [],
  picks: [
    { id: 'p1', year: 2027, round: 1, type: 'own', fromTeam: null },
    { id: 'p2', year: 2027, round: 1, type: 'incoming', fromTeam: 'Owls' },
    { id: 'p3', year: 2027, round: 2, type: 'own', fromTeam: null },
    { id: 'p4', year: 2028, round: 1, type: 'own', fromTeam: null },
    { id: 'p5', year: 2028, round: 2, type: 'own', fromTeam: null },
    { id: 'p6', year: 2029, round: 3, type: 'own', fromTeam: null },
  ],
  hasTeam: true,
  titles: {
    pennants: [
      { season: 2023, label: 'Owls', mine: false },
      { season: 2024, label: 'guap', mine: true },
    ],
    openSeason: 2026,
    myTitles: 1,
  },
  pipeline: { taxi: { count: 3, slots: 4 }, devy: null, rookies: { count: 2, unknown: 1 }, rookiesUnknownOnly: 0 },
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/dynasty-hub')) return { ok: true, json: async () => HUB }
    return { ok: false, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const league = (over: Record<string, unknown> = {}) => ({
  id: 'd1', name: 'Gold Standard', platform: 'allfantasy', sport: 'NFL', season: 2026, teamCount: 12, format: 'Standard',
  scoring: 'PPR', currentWeek: 3, lifecycleState: 'in_season', settings: {}, ...over,
}) as never

function renderHome(l: never, onSelectTab = vi.fn(), availableTabIds: string[] | undefined = ['native_home', 'dynasty_picks', 'dynasty_taxi', 'history']) {
  render(
    <NativeLeagueHome league={l} teams={[]} userTeamId={null} isCommissioner={false} draftDateIso={null} snapshot={null}
      settingsOpen={false} onOpenSettings={() => {}} onSelectTab={onSelectTab} availableTabIds={availableTabIds} />,
  )
  return onSelectTab
}

const hubCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/dynasty-hub')).length

describe('dynasty League home extras', () => {
  it('a non-dynasty league never asks for the hub and renders none of it', async () => {
    renderHome(league({ isDynasty: false, leagueType: 'redraft', settings: { startup_season: 2023 } }))
    await new Promise((r) => setTimeout(r, 20))
    expect(hubCalls()).toBe(0)
    expect(document.querySelector('[class*="dyn-home"]')).toBeNull()
    expect(screen.queryByTestId('dynasty-home-rafters')).toBeNull()
  })

  it('guillotine dynasty-ish leagues keep their own presentation', async () => {
    renderHome(league({ isDynasty: true, guillotineMode: true }))
    await new Promise((r) => setTimeout(r, 20))
    expect(hubCalls()).toBe(0)
  })

  it('rafters: past champions as pennants, gold only for the viewer, the current season open', async () => {
    renderHome(league({ isDynasty: true, settings: { startup_season: 2023 } }))
    const pennants = await screen.findByTestId('dynasty-home-pennants')
    const items = [...pennants.querySelectorAll('li')]
    expect(items.map((li) => li.textContent)).toEqual(['2023Owls', '2024You', '2026open'])
    expect(items.map((li) => li.getAttribute('data-mine'))).toEqual([null, 'true', null])
    expect(items[2]!.getAttribute('data-open')).toBe('true')
    expect(screen.getByTestId('dynasty-home-my-titles').textContent).toContain('1')
    expect(hubCalls()).toBe(1)
  })

  it('does not repeat the season clock, which the league header already shows', async () => {
    renderHome(league({ isDynasty: true, settings: { startup_season: 2023 } }))
    await screen.findByTestId('dynasty-home-pennants')
    expect(screen.queryByTestId('dynasty-home-season-clock')).toBeNull()
  })

  it('pick capital: chips with R1 gold, "via" origins, overflow, and a link to the Picks tab', async () => {
    const onSelectTab = renderHome(league({ isDynasty: true }))
    const card = await screen.findByTestId('dynasty-home-pick-capital')
    const chips = [...card.querySelectorAll('li')]
    expect(chips.map((c) => c.textContent)).toEqual(['2027 R1', '2027 R1 · via Owls', '2027 R2', '2028 R1', '2028 R2', '+1 more'])
    expect(chips.map((c) => c.getAttribute('data-round'))).toEqual(['1', '1', 'later', '1', 'later', null])
    expect(card.textContent).toContain('over 3 draft years')
    fireEvent.click(screen.getByRole('button', { name: 'All picks' }))
    expect(onSelectTab).toHaveBeenCalledWith('dynasty_picks')
  })

  it('pipeline: taxi against slots, rookies with the unknown count stated', async () => {
    renderHome(league({ isDynasty: true }))
    expect((await screen.findByTestId('dynasty-home-pipeline-taxi')).textContent).toContain('3 of 4 slots')
    expect(screen.getByTestId('dynasty-home-pipeline-rookie').textContent).toContain('2 on roster')
    expect(screen.getByTestId('dynasty-home-pipeline-rookie').textContent).toContain('Experience not on file for 1')
    expect(screen.queryByTestId('dynasty-home-pipeline-devy')).toBeNull()
  })

  it('links only to tabs the league has', async () => {
    renderHome(league({ isDynasty: true }), vi.fn(), ['native_home'])
    await screen.findByTestId('dynasty-home-pick-capital')
    expect(screen.queryByRole('button', { name: 'All picks' })).toBeNull()
    expect(screen.queryByRole('button', { name: /League history/ })).toBeNull()
  })

  it('an empty hub hides every module', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/dynasty-hub')
        ? { ok: true, json: async () => ({ taxi: [], picks: [], hasTeam: false, titles: null, pipeline: null }) }
        : { ok: false, json: async () => ({}) },
    )
    renderHome(league({ isDynasty: true }))
    await waitFor(() => expect(hubCalls()).toBe(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('dynasty-home-rafters')).toBeNull()
    expect(screen.queryByTestId('dynasty-home-pick-capital')).toBeNull()
    expect(screen.queryByTestId('dynasty-home-pipeline')).toBeNull()
  })
})
