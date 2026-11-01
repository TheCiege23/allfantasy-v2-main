/**
 * The native league's phone bottom bar swaps Matchup for Draft before the season (2026-10-29).
 * A phone user had no fixed way into the draft room: it sat ~7th in the swipe strip as "Draft HQ".
 * Only a LIVE draft links straight to the room; Setup opens Draft HQ, because /league/{id}/draft
 * seats AI orphan rosters in empty slots pre-draft.
 */
import React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'

const TABS = [
  { id: 'native_home', label: 'League home' },
  { id: 'roster', label: 'My team' },
  { id: 'matchups', label: 'Matchup' },
  { id: 'waivers', label: 'Players' },
  { id: 'draft', label: 'Draft HQ' },
  { id: 'league_chat', label: 'Chat' },
]

const league = (lifecycleState: string) => ({
  id: 'lg 1', name: 'Sunday League', platform: 'allfantasy', sport: 'NFL', season: 2026, teamCount: 12, format: 'Redraft',
  scoring: 'PPR', currentWeek: null, lifecycleState, leagueVariant: 'redraft',
}) as never

function bar(lifecycleState: string, onSelectTab = vi.fn(), tabs = TABS) {
  const { container } = render(
    <NativeLeagueWorkspace native league={league(lifecycleState)} leagues={[league(lifecycleState)]} tabs={tabs} activeTab="native_home"
      isCommissioner={false} onSelectTab={onSelectTab} onOpenSettings={() => {}} leftPanel={null} rightPanel={null}>
      <div>tab</div>
    </NativeLeagueWorkspace>,
  )
  return container.querySelector('.nl-bottom-nav')!
}
const labels = (nav: Element) => [...nav.children].map((el) => el.textContent)

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  HTMLDialogElement.prototype.showModal ??= function () {}
  HTMLDialogElement.prototype.close ??= function () {}
})
afterEach(() => vi.unstubAllGlobals())

describe('native league phone bar — Draft slot', () => {
  it('pre-draft: Draft replaces Matchup and opens Draft HQ, not the room', () => {
    const onSelectTab = vi.fn()
    const nav = bar('setup', onSelectTab)
    expect(labels(nav)).toEqual(['League', 'Draft', 'Team', 'Players', 'Chat'])
    const draft = nav.querySelector('[data-testid=nl-bottom-nav-draft-hq]')!
    expect(draft.tagName).toBe('BUTTON')
    expect(nav.querySelector('[data-testid=nl-bottom-nav-draft-room]')).toBeNull()
    fireEvent.click(draft)
    expect(onSelectTab).toHaveBeenCalledWith('draft')
  })

  it('drafting: Draft links straight into the draft room', () => {
    const nav = bar('drafting')
    expect(labels(nav)).toEqual(['League', 'Draft', 'Team', 'Players', 'Chat'])
    expect(nav.querySelector('[data-testid=nl-bottom-nav-draft-room]')!.getAttribute('href')).toBe('/league/lg%201/draft')
  })

  it('in season: Matchup is back and there is no Draft slot', () => {
    expect(labels(bar('in_season'))).toEqual(['League', 'Matchup', 'Team', 'Players', 'Chat'])
  })

  it('a league without a draft section keeps Matchup even pre-draft', () => {
    expect(labels(bar('setup', vi.fn(), TABS.filter((t) => t.id !== 'draft')))).toEqual(['League', 'Matchup', 'Team', 'Players', 'Chat'])
  })
})


describe('Zombie workspace atmosphere', () => {
  it('shows Zombie visuals when the league is identified only by its format', () => {
    const zombie = { ...(league('setup') as object), leagueVariant: null, leagueType: null, format: 'zombie' } as never
    const { container } = render(<NativeLeagueWorkspace native league={zombie} leagues={[zombie]} tabs={TABS} activeTab="league_chat" isCommissioner={false} onSelectTab={() => {}} onOpenSettings={() => {}} leftPanel={null} rightPanel={null}><div>chat</div></NativeLeagueWorkspace>)
    expect(container.querySelector('[data-format="zombie"][data-view="league_chat"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="zombie-section-scene"]')?.textContent).toContain('Survivor radio')
  })
  it('changes the scene with the selected tab and leaves other league types unchanged', () => {
    const zombie = { ...(league('setup') as object), leagueVariant: 'zombie' } as never
    const props = { native: true, leagues: [zombie], tabs: TABS, isCommissioner: false, onSelectTab: vi.fn(), onOpenSettings: vi.fn(), leftPanel: null, rightPanel: null }
    const { container, rerender } = render(<NativeLeagueWorkspace {...props} league={zombie} activeTab="draft"><div>draft content</div></NativeLeagueWorkspace>)
    expect(container.querySelector('[data-format="zombie"][data-view="draft"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="zombie-section-scene"]')?.textContent).toContain('Draft headquarters')
    rerender(<NativeLeagueWorkspace {...props} league={zombie} activeTab="league_chat"><div>chat content</div></NativeLeagueWorkspace>)
    expect(container.querySelector('[data-view="league_chat"] [data-testid="zombie-section-scene"]')?.textContent).toContain('Survivor radio')
    rerender(<NativeLeagueWorkspace {...props} league={league('setup')} activeTab="draft"><div>draft content</div></NativeLeagueWorkspace>)
    expect(container.querySelector('[data-testid="zombie-section-scene"]')).toBeNull()
  })
})
