/**
 * Dynasty Era step 1 (2026-10-31): the token contract, the static gold glow, the season clock and
 * the gold/ink restyle of the dynasty-only surfaces. The point of most of this file is the negative:
 * a league that is not dynasty gets no attribute, no tokens and no clock.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { dynastySeasonClock } from '@/lib/league-media/dynastySeasonClock'
import { SPECIALTY_THEMES } from '@/components/league/specialty/theme'
import { DynastyHome } from '@/app/league/[leagueId]/tabs/DynastyHome'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('dynastySeasonClock', () => {
  it('Year N = seasons since the stored startup season, inclusive', () => {
    expect(dynastySeasonClock({ season: 2026, settings: { startup_season: 2023 } })).toEqual({ year: 4, season: 2026 })
    expect(dynastySeasonClock({ season: 2026, settings: { startup_season: 2026 } })).toEqual({ year: 1, season: 2026 })
    expect(dynastySeasonClock({ season: '2027', settings: { startup_season: 2025 } })).toEqual({ year: 3, season: 2027 })
  })

  it('no startup season (imported leagues) → the season alone, never a guessed year', () => {
    expect(dynastySeasonClock({ season: 2026, settings: {} })).toEqual({ year: null, season: 2026 })
    expect(dynastySeasonClock({ season: 2026 })).toEqual({ year: null, season: 2026 })
    // One rule with chat (lib/league-media/dynastySeasonClock.ts): a four-digit string startup season counts.
    expect(dynastySeasonClock({ season: 2026, settings: { startup_season: '2023' } })).toEqual({ year: 4, season: 2026 })
  })

  it('an inconsistent pair (startup after the season) is not trusted', () => {
    expect(dynastySeasonClock({ season: 2025, settings: { startup_season: 2026 } })).toEqual({ year: null, season: 2025 })
  })

  it('no usable season → nothing at all', () => {
    expect(dynastySeasonClock({ season: null, settings: { startup_season: 2023 } })).toBeNull()
    expect(dynastySeasonClock({ season: 'TBD' })).toBeNull()
  })
})

function stubMatchMedia() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

const league = (over: Record<string, unknown> = {}) => ({
  id: 'd1', name: 'Gold Standard', platform: 'allfantasy', sport: 'NFL', season: 2026, teamCount: 12, format: 'Standard',
  scoring: 'PPR', currentWeek: 3, lifecycleState: 'in_season', ...over,
}) as never

function renderWorkspace(l: never) {
  return render(
    <NativeLeagueWorkspace native league={l} leagues={[l]} tabs={[{ id: 'native_home', label: 'League home' }]} activeTab="native_home"
      isCommissioner={false} onSelectTab={() => {}} onOpenSettings={() => {}} leftPanel={null} rightPanel={null}>
      <div>tab</div>
    </NativeLeagueWorkspace>,
  )
}

describe('NativeLeagueWorkspace: dynasty only', () => {
  beforeEach(() => {
    stubMatchMedia()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    HTMLDialogElement.prototype.showModal ??= function () {}
    HTMLDialogElement.prototype.close ??= function () {}
  })
  afterEach(() => vi.unstubAllGlobals())

  const root = (c: HTMLElement) => c.querySelector('[data-testid=native-league-workspace]')!

  it('a dynasty league with a startup season gets the attribute and "Year N · YYYY"', () => {
    const { container } = renderWorkspace(league({ isDynasty: true, leagueType: 'dynasty', settings: { startup_season: 2023 } }))
    expect(root(container).getAttribute('data-dynasty-background')).toBe('true')
    const clock = screen.getByTestId('dynasty-season-clock')
    expect(clock.textContent).toBe('Year 4 · 2026')
    expect(clock.getAttribute('aria-label')).toBe('Dynasty season clock: Year 4 · 2026')
    expect(clock.closest('.nl-league-heading')).not.toBeNull()
  })

  it('a dynasty league with no startup season shows the season only', () => {
    renderWorkspace(league({ isDynasty: true, settings: {} }))
    expect(screen.getByTestId('dynasty-season-clock').textContent).toBe('2026 season')
  })

  it.each([
    ['redraft', { leagueType: 'redraft', isDynasty: false }],
    ['keeper', { leagueType: 'keeper' }],
    ['guillotine (even if flagged dynasty)', { isDynasty: true, guillotineMode: true }],
    ['survivor', { leagueType: 'survivor', isDynasty: true }],
  ])('%s: no attribute, no clock', (_name, over) => {
    // A startup season present on purpose — the clock must still not render.
    const { container } = renderWorkspace(league({ ...over, settings: { startup_season: 2023 } }))
    expect(root(container).hasAttribute('data-dynasty-background')).toBe(false)
    expect(screen.queryByTestId('dynasty-season-clock')).toBeNull()
    expect(container.querySelector('.nl-dyn-clock')).toBeNull()
  })
})

describe('native-league.css: the token block is scoped to the dynasty attribute', () => {
  const css = read('components/league/native/native-league.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }))

  it('defines all eleven --dyn-* tokens, exactly once', () => {
    const defs = rules.filter((r) => /--dyn-[a-z0-9-]+\s*:/.test(r.body))
    expect(defs).toHaveLength(1)
    const names = [...defs[0].body.matchAll(/(--dyn-[a-z0-9-]+)\s*:/g)].map((m) => m[1])
    expect(names).toEqual(['--dyn-ink', '--dyn-vault', '--dyn-rail', '--dyn-line', '--dyn-gold', '--dyn-gold-soft', '--dyn-teal', '--dyn-ember', '--dyn-text', '--dyn-text2', '--dyn-faint'])
    expect(defs[0].selector).toBe('.nl-workspace[data-dynasty-background=true]')
  })

  it('every rule that reads a --dyn-* token or the clock class sits under the dynasty attribute', () => {
    const touching = rules.filter((r) => /var\(--dyn-/.test(r.body) || /nl-dyn-/.test(r.selector))
    expect(touching.length).toBeGreaterThanOrEqual(3)
    for (const r of touching) expect(r.selector).toContain('[data-dynasty-background=true]')
  })

  it('the old hard-coded gold is gone from the heading; the glow is static', () => {
    expect(css).not.toMatch(/#eacb83|#f4d89c/i)
    const ws = rules.find((r) => r.selector === '.af-core.nl-workspace[data-dynasty-background=true]')!
    expect(ws.body).toMatch(/radial-gradient\(1200px 520px at 50% -120px,color-mix\(in srgb,var\(--dyn-gold,#D4A24C\) 18%/)
    expect(ws.body).toContain("url('/artwork/dynasty/dynasty-league-background-v1.png')")
    expect(ws.body).not.toMatch(/animation/)
  })
})

describe('SPECIALTY_THEMES.dynasty', () => {
  it('is gold on ink, Archivo, no display title', () => {
    expect(SPECIALTY_THEMES.dynasty).toEqual({ acc: '#D4A24C', acc2: '#F3D79F', accInk: '#0B0F17', disp: 'Archivo', displayTitle: false })
  })
})

describe('DynastyHome and the dynasty War Room: gold/ink, no purple, no emoji', () => {
  const emoji = /\p{Extended_Pictographic}/u
  for (const file of ['app/league/[leagueId]/tabs/DynastyHome.tsx', 'app/league/[leagueId]/tabs/dynasty/DynastyWarRoomPanel.tsx']) {
    it(file, () => {
      // Comments may carry the repo's warning-sign convention; only rendered code is checked for emoji.
      const src = read(file).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(src).not.toMatch(/\b(?:bg|text|ring|border|hover:bg|hover:border|focus:border)-(?:purple|violet)-/)
      expect(src).not.toMatch(emoji)
      expect(src).toContain("import '@/components/dynasty/dynasty-era.css'")
    })
  }

  it('dynasty-era.css reads only tokens with fallbacks', () => {
    const css = read('components/dynasty/dynasty-era.css')
    const vars = [...css.matchAll(/var\((--[a-z0-9-]+)(,?)/g)]
    expect(vars.length).toBeGreaterThan(10)
    for (const [, name, comma] of vars) {
      expect(name.startsWith('--dyn-')).toBe(true)
      expect(comma).toBe(',')
    }
  })

  describe('DynastyHome pills', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ taxi: [], picks: [], standings: [] }) }))))
    afterEach(() => vi.unstubAllGlobals())

    it('the active pill is the gold-outlined one; labels carry no emoji; switching still works', async () => {
      render(<DynastyHome leagueId="L1" />)
      const overview = await screen.findByRole('button', { name: 'Overview' })
      const taxi = screen.getByRole('button', { name: 'Taxi Squad' })
      expect(overview.getAttribute('aria-pressed')).toBe('true')
      expect(taxi.getAttribute('aria-pressed')).toBe('false')
      for (const b of [overview, taxi]) expect(b.classList.contains('dyn-pill')).toBe(true)
      expect(taxi.querySelector('svg[aria-hidden]')).not.toBeNull()
      fireEvent.click(taxi)
      expect(taxi.getAttribute('aria-pressed')).toBe('true')
      expect(await screen.findByText('No players on taxi squad.')).toBeTruthy()
    })
  })
})
