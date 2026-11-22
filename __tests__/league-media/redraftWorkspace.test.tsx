/**
 * NativeLeagueWorkspace stamps the redraft identity on its root and swaps the header for redraft
 * leagues only: "Redraft · <season>" chip + sport chip, and the season track in place of `.nl-phase`.
 */
import React from 'react'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'

const TABS = [{ id: 'native_home', label: 'League home' }, { id: 'roster', label: 'My team' }]

function mount(over: Record<string, unknown>, props: Record<string, unknown> = {}) {
  const league = {
    id: 'lg1', name: 'Sunday League', platform: 'allfantasy', sport: 'NBA', season: 2026, teamCount: 12, format: 'redraft',
    scoring: 'Points', currentWeek: 4, lifecycleState: 'in_season', leagueType: 'redraft', tradeDeadlineWeek: 16, ...over,
  } as never
  const { container } = render(
    <NativeLeagueWorkspace native league={league} leagues={[league]} tabs={TABS} activeTab="native_home" isCommissioner={false}
      onSelectTab={() => {}} onOpenSettings={() => {}} leftPanel={null} rightPanel={null} {...props}>
      <div>tab</div>
    </NativeLeagueWorkspace>,
  )
  return container.querySelector('[data-testid=native-league-workspace]')!
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  HTMLDialogElement.prototype.showModal ??= function () {}
  HTMLDialogElement.prototype.close ??= function () {}
})
afterEach(() => vi.unstubAllGlobals())

describe('redraft identity on the native workspace', () => {
  it('a native redraft league gets data-format=redraft, its sport, the season chip and the track', () => {
    const root = mount({}, { seasonFacts: { totalWeeks: 21, playoffStartWeek: 19 } })
    expect(root.getAttribute('data-format')).toBe('redraft')
    expect(root.getAttribute('data-sport')).toBe('nba')
    expect(root.querySelector('[data-testid=redraft-season-chip]')!.textContent).toBe('Redraft · 2026')
    expect(root.textContent).not.toContain('Native on AllFantasy')
    expect(root.querySelector('.nl-phase')).toBeNull()
    const track = root.querySelector('[data-testid=redraft-season-track]')!
    expect(track.querySelector('.nl-rd-track-head strong')!.textContent).toBe('Week 4 of 21')
    expect([...track.querySelectorAll('.nl-rd-track-marks li')].map(li => li.textContent)).toEqual([
      'Draft ✓', 'Week 4 · now', 'Trade deadline · Wk 16', 'Playoffs · Wk 19', 'Championship · Wk 21',
    ])
  })

  it('without a season length the bar is not drawn and nothing is invented', () => {
    const root = mount({ tradeDeadlineWeek: null })
    const track = root.querySelector('[data-testid=redraft-season-track]')!
    expect(track.querySelector('.nl-rd-track-bar')).toBeNull()
    expect([...track.querySelectorAll('.nl-rd-track-marks li')].map(li => li.textContent)).toEqual(['Draft ✓', 'Week 4 · now'])
  })

  it.each([
    ['dynasty', { leagueType: 'dynasty', isDynasty: true }],
    ['imported', { platform: 'sleeper' }],
    ['best ball', { bestBallMode: true }],
  ])('a %s league keeps the default look and the phase bar', (_n, over) => {
    const root = mount(over)
    expect(root.getAttribute('data-format')).toBeNull()
    expect(root.getAttribute('data-sport')).toBeNull()
    expect(root.querySelector('[data-testid=redraft-season-track]')).toBeNull()
    expect(root.querySelector('.nl-phase')).not.toBeNull()
  })

  it('every tab except League home gets the compact header: this week, no season race, no chips', () => {
    const root = mount({}, { activeTab: 'roster', seasonFacts: { totalWeeks: 21, playoffStartWeek: 19 } })
    const heading = root.querySelector('.nl-league-heading')!
    expect(heading.getAttribute('data-compact')).toBe('true')
    expect(root.querySelector('[data-testid=redraft-season-track]')).toBeNull()
    expect(root.querySelector('[data-testid=redraft-week-pill]')!.textContent).toBe('Week 4 of 21')
    // The league name stays the page heading (visually hidden on phones, where the top pill shows it).
    expect(heading.querySelector('h1')!.textContent).toBe('Sunday League')
  })

  it('League home keeps the full header', () => {
    const root = mount({}, { seasonFacts: { totalWeeks: 21 } })
    expect(root.querySelector('.nl-league-heading')!.getAttribute('data-compact')).toBeNull()
    expect(root.querySelector('[data-testid=redraft-week-pill]')).toBeNull()
  })

  it('the compact header falls back to the phase before there is a week', () => {
    const root = mount({ currentWeek: null, lifecycleState: 'pre_draft' }, { activeTab: 'roster' })
    expect(root.querySelector('[data-testid=redraft-week-pill]')!.textContent!.length).toBeGreaterThan(0)
  })

  it('a dynasty league is never compacted', () => {
    const root = mount({ leagueType: 'dynasty', isDynasty: true }, { activeTab: 'roster' })
    expect(root.querySelector('.nl-league-heading')!.getAttribute('data-compact')).toBeNull()
    expect(root.querySelector('.nl-phase')).not.toBeNull()
  })
  it('a guillotine banner wins over the redraft identity', () => {
    const root = mount({}, { guillotineBanner: { line: 'Chop line', mood: 'calm' } })
    expect(root.getAttribute('data-format')).toBe('guillotine')
    expect(root.getAttribute('data-sport')).toBeNull()
  })
})
