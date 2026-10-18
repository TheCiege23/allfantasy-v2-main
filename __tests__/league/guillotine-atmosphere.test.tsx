/**
 * Guillotine league atmosphere (2026-10-18): the themed background, its moods, and the banner on
 * the native league header. Moods come from league state, not from the open tab.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deriveGuillotineAtmosphere,
  guillotineBannerLine,
  isGuillotineAtmosphereLeague,
  type GuillotineAtmosphereSummary,
} from '@/lib/guillotine/guillotineAtmosphere'
import { SpecialtyLeagueAtmosphere } from '@/components/league-atmosphere/SpecialtyLeagueAtmosphere'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'

const standings = (n: number) => Array.from({ length: n }, (_, i) => ({ rosterId: `r${i + 1}` }))
const summary = (over: Partial<GuillotineAtmosphereSummary> = {}): GuillotineAtmosphereSummary => ({
  weekOrPeriod: 12,
  survivalStandings: standings(9),
  recentChopEvents: [{ weekOrPeriod: 11, choppedRosterIds: ['r16'] }],
  myRosterId: 'r1',
  config: { eliminationStartWeek: 4, eliminationEndWeek: 17 },
  ...over,
})
const derive = (s: GuillotineAtmosphereSummary | null, over: Partial<Parameters<typeof deriveGuillotineAtmosphere>[0]> = {}) =>
  deriveGuillotineAtmosphere({ predraft: false, teamCount: 16, leagueWeek: null, summary: s, ...over })

describe('deriveGuillotineAtmosphere', () => {
  it('calm before the draft, whatever the summary says, with the first chop week from the config', () => {
    const state = derive(summary({ weekOrPeriod: 1, survivalStandings: standings(16), recentChopEvents: [], config: { eliminationStartWeek: 10, eliminationEndWeek: 17 } }), { predraft: true })
    expect(state.mood).toBe('default')
    expect(guillotineBannerLine(state)).toBe('16 alive · First chop wk 10')
  })

  it('calm after the draft but before the first chop week', () => {
    const state = derive(summary({ weekOrPeriod: 3, survivalStandings: standings(16), recentChopEvents: [], config: { eliminationStartWeek: 10, eliminationEndWeek: 17 } }))
    expect(state.mood).toBe('default')
    expect(guillotineBannerLine(state)).toBe('16 alive · First chop wk 10')
  })

  it('chop_week inside the chop window while this week\'s chop has not happened', () => {
    const state = derive(summary())
    expect(state.mood).toBe('chop_week')
    expect(guillotineBannerLine(state)).toBe('Chop week 12 · 9 alive')
  })

  it('back to calm once this week\'s chop is recorded', () => {
    const state = derive(summary({ recentChopEvents: [{ weekOrPeriod: 12, choppedRosterIds: ['r10'] }] }))
    expect(state.mood).toBe('default')
    expect(guillotineBannerLine(state)).toBe('9 alive · Last chop wk 17')
  })

  it('the league row\'s week wins when it is ahead of the last scored week', () => {
    const state = derive(summary({ recentChopEvents: [{ weekOrPeriod: 12, choppedRosterIds: ['r10'] }] }), { leagueWeek: 13 })
    expect(state.mood).toBe('chop_week')
    expect(state.week).toBe(13)
  })

  it('final on the last chop week', () => {
    const state = derive(summary({ weekOrPeriod: 17, survivalStandings: standings(3) }))
    expect(state.mood).toBe('final')
    expect(guillotineBannerLine(state)).toBe('Final chop · wk 17 · 3 alive')
  })

  it('final when two teams remain, before the configured last week', () => {
    expect(derive(summary({ weekOrPeriod: 15, survivalStandings: standings(2) })).mood).toBe('final')
  })

  it('eliminated once the viewer\'s roster has been chopped, over every other state', () => {
    const state = derive(summary({ recentChopEvents: [{ weekOrPeriod: 8, choppedRosterIds: ['r1'] }] }))
    expect(state.mood).toBe('eliminated')
    expect(state.myChopWeek).toBe(8)
    expect(guillotineBannerLine(state)).toBe('Chopped wk 8 · 9 alive')
    expect(derive(summary({ weekOrPeriod: 17, survivalStandings: standings(2), recentChopEvents: [{ weekOrPeriod: 8, choppedRosterIds: ['r1'] }] })).mood).toBe('eliminated')
  })

  it('falls back to default and the league row when the summary is unavailable', () => {
    const state = derive(null, { settings: { eliminationStartWeek: 6 } })
    expect(state.mood).toBe('default')
    expect(guillotineBannerLine(state)).toBe('16 alive · First chop wk 6')
  })

  it('season over (past the last chop week) is calm, not a chop week', () => {
    expect(derive(summary({ weekOrPeriod: 18, survivalStandings: standings(1) })).mood).toBe('default')
  })
})

describe('isGuillotineAtmosphereLeague', () => {
  it('guillotine variant or guillotine mode', () => {
    expect(isGuillotineAtmosphereLeague({ leagueVariant: 'guillotine' })).toBe(true)
    expect(isGuillotineAtmosphereLeague({ leagueVariant: 'redraft', guillotineMode: true })).toBe(true)
  })

  it('survivor and big brother hybrids keep their own look; ordinary leagues are untouched', () => {
    expect(isGuillotineAtmosphereLeague({ leagueVariant: 'survivor', guillotineMode: true })).toBe(false)
    expect(isGuillotineAtmosphereLeague({ leagueVariant: 'big_brother', guillotineMode: true })).toBe(false)
    expect(isGuillotineAtmosphereLeague({ leagueVariant: 'redraft', guillotineMode: false })).toBe(false)
    expect(isGuillotineAtmosphereLeague({ leagueVariant: null, guillotineMode: null })).toBe(false)
  })
})

function stubMatchMedia(reduce = false) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

describe('SpecialtyLeagueAtmosphere guillotine variant', () => {
  beforeEach(() => stubMatchMedia())
  afterEach(() => vi.unstubAllGlobals())

  it('renders the guillotine layer, its mood, and embers', () => {
    const { container } = render(<SpecialtyLeagueAtmosphere variant="guillotine" mood="chop_week" />)
    const root = container.querySelector('[data-af-atmosphere]')!
    expect(root.getAttribute('data-af-atmosphere')).toBe('guillotine')
    expect(root.getAttribute('data-af-mood')).toBe('chop_week')
    expect(root.getAttribute('aria-hidden')).not.toBeNull()
    expect(root.className).toContain('pointer-events-none')
    const layer = container.querySelector('.af-atmo-layer')!
    expect(layer.classList.contains('af-atmo-guillotine')).toBe(true)
    expect(layer.classList.contains('af-atmo-mood--chop_week')).toBe(true)
    expect(container.querySelector('.af-atmo-guillotine-embers')).not.toBeNull()
  })

  it('reduced motion: static layer, no embers', () => {
    stubMatchMedia(true)
    const { container } = render(<SpecialtyLeagueAtmosphere variant="guillotine" mood="final" />)
    expect(container.querySelector('.af-atmo-layer')!.classList.contains('af-atmo-static')).toBe(true)
    expect(container.querySelector('.af-atmo-guillotine-embers')).toBeNull()
  })

  it('other variants do not pick up guillotine classes', () => {
    const { container } = render(<SpecialtyLeagueAtmosphere variant="survivor" />)
    expect(container.querySelector('.af-atmo-guillotine')).toBeNull()
    expect(container.querySelector('.af-atmo-guillotine-embers')).toBeNull()
  })
})

const nativeLeague = (over: Record<string, unknown> = {}) => ({
  id: 'g1', name: 'Blade Runners', platform: 'allfantasy', sport: 'NFL', season: 2026, teamCount: 16, format: 'Guillotine',
  scoring: 'PPR', currentWeek: 12, lifecycleState: 'in_season', leagueVariant: 'guillotine', guillotineMode: true, ...over,
}) as never

function renderWorkspace(guillotineBanner: { line: string; mood: string } | null) {
  return render(
    <NativeLeagueWorkspace
      native
      league={nativeLeague()}
      leagues={[nativeLeague()]}
      tabs={[{ id: 'native_home', label: 'League home' }]}
      activeTab="native_home"
      isCommissioner
      onSelectTab={() => {}}
      onOpenSettings={() => {}}
      onOpenChimmy={() => {}}
      guillotineBanner={guillotineBanner}
      leftPanel={null}
      rightPanel={null}
    >
      <div>tab</div>
    </NativeLeagueWorkspace>,
  )
}

describe('native league header banner', () => {
  beforeEach(() => {
    stubMatchMedia()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    HTMLDialogElement.prototype.showModal ??= function () {}
    HTMLDialogElement.prototype.close ??= function () {}
  })
  afterEach(() => vi.unstubAllGlobals())

  it('a guillotine league gets the banner, its status line and mood, and keeps League settings', () => {
    const { container } = renderWorkspace({ line: 'Chop week 12 · 9 alive', mood: 'chop_week' })
    const banner = screen.getByTestId('guillotine-league-banner')
    expect(banner.getAttribute('data-format')).toBe('guillotine')
    expect(banner.querySelector('img.nl-guillotine-art')?.getAttribute('src')).toBe('/artwork/tournaments/specialty/guillotine/assets/banner.svg')
    expect(screen.getByTestId('guillotine-banner-line').textContent).toBe('Chop week 12 · 9 alive')
    expect(banner.querySelector('h1')?.textContent).toBe('Blade Runners')
    expect(screen.getByRole('button', { name: 'League settings' })).toBeTruthy()
    const root = container.querySelector('[data-testid=native-league-workspace]')!
    expect(root.getAttribute('data-format')).toBe('guillotine')
    expect(root.getAttribute('data-guillotine-mood')).toBe('chop_week')
  })

  it('without a banner the header is unchanged', () => {
    const { container } = renderWorkspace(null)
    expect(screen.queryByTestId('guillotine-league-banner')).toBeNull()
    expect(screen.queryByTestId('guillotine-banner-line')).toBeNull()
    expect(container.querySelector('.nl-guillotine-art')).toBeNull()
    const heading = container.querySelector('.nl-league-heading')!
    expect(heading.hasAttribute('data-format')).toBe(false)
    expect(container.querySelector('[data-testid=native-league-workspace]')!.hasAttribute('data-format')).toBe(false)
    expect(screen.getByRole('button', { name: 'League settings' })).toBeTruthy()
  })
})

describe('LeagueShell wiring', () => {
  const src = readFileSync(join(process.cwd(), 'app/league/[leagueId]/LeagueShell.tsx'), 'utf8')

  it('enables the guillotine atmosphere only for native guillotine leagues', () => {
    expect(src).toMatch(/^\s*const guillotineAtmosphereEnabled = nativeWorkspace && isGuillotineAtmosphereLeague\(league\)$/m)
    expect(src).toMatch(/^\s*\) : guillotineAtmosphere \? \($/m)
    expect(src).toMatch(/^\s*<SpecialtyLeagueAtmosphere variant="guillotine" mood=\{guillotineAtmosphere\.mood\} \/>$/m)
  })
})
