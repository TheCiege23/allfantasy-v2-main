/**
 * The native league sidebar draws a Dynasty group (Dynasty hub / Taxi squad / Draft picks) with its own
 * icons for a dynasty league, and none for any other league.
 */
import React from 'react'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'

const TABS = [
  { id: 'native_home', label: 'League home' },
  { id: 'roster', label: 'My team' },
  { id: 'matchups', label: 'Matchup' },
  { id: 'waivers', label: 'Players' },
  { id: 'draft', label: 'Draft HQ' },
  { id: 'league_chat', label: 'Chat' },
  { id: 'legacy', label: 'Legacy' },
]
const DYNASTY_TABS = [
  { id: 'dynasty', label: 'Dynasty' },
  { id: 'dynasty_taxi', label: 'Taxi' },
  { id: 'dynasty_picks', label: 'Picks' },
]

const league = (dynasty: boolean) => ({
  id: 'lg1', name: 'Keepers of the Flame', platform: 'allfantasy', sport: 'NFL', season: 2026, teamCount: 12,
  format: dynasty ? 'dynasty' : 'redraft', scoring: 'PPR', currentWeek: 8, lifecycleState: 'in_season',
  leagueVariant: dynasty ? 'dynasty' : 'redraft', leagueType: dynasty ? 'dynasty' : 'redraft', isDynasty: dynasty,
}) as never

function sidebar(dynasty: boolean) {
  const tabs = dynasty ? [...TABS, ...DYNASTY_TABS] : TABS
  const { container } = render(
    <NativeLeagueWorkspace native league={league(dynasty)} leagues={[league(dynasty)]} tabs={tabs} activeTab="dynasty_taxi"
      isCommissioner={false} onSelectTab={vi.fn()} onOpenSettings={() => {}} leftPanel={null} rightPanel={null}>
      <div>tab</div>
    </NativeLeagueWorkspace>,
  )
  return container
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  HTMLDialogElement.prototype.showModal ??= function () {}
  HTMLDialogElement.prototype.close ??= function () {}
})
afterEach(() => vi.unstubAllGlobals())

describe('native league sidebar: Dynasty group', () => {
  it('a dynasty league shows the Dynasty group with three distinct icons', () => {
    const root = sidebar(true)
    const group = root.querySelector('.nl-sidebar [data-nav-group=dynasty]')!
    expect(group.querySelector('h2')!.textContent).toBe('Dynasty')
    const buttons = [...group.querySelectorAll('button')]
    expect(buttons.map(b => b.textContent)).toEqual(['Dynasty hub', 'Taxi squad', 'Draft picks'])
    const icons = buttons.map(b => b.querySelector('svg')!.getAttribute('class'))
    expect(new Set(icons).size).toBe(3)
    expect(icons.join(' ')).not.toContain('circle-help')
    expect(buttons[1].getAttribute('aria-current')).toBe('page')
    // Nothing dynasty is left in More tools.
    const more = root.querySelector('.nl-sidebar [data-nav-group=more]')!
    expect(more.textContent).not.toMatch(/Dynasty|Taxi|Picks/)
    // The section picker uses the same group.
    expect(root.querySelector('optgroup[label=Dynasty]')!.querySelectorAll('option')).toHaveLength(3)
  })

  it('a redraft league has no Dynasty group', () => {
    const root = sidebar(false)
    expect(root.querySelector('[data-nav-group=dynasty]')).toBeNull()
    expect(root.querySelector('optgroup[label=Dynasty]')).toBeNull()
    expect([...root.querySelectorAll('.nl-sidebar .nl-nav-group h2')].map(h => h.textContent)).toEqual(['This league', 'More tools', 'Your record'])
  })
})
