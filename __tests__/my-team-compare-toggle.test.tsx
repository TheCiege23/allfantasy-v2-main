/**
 * One projection leads, the others behind "Compare" — 2026-10-03. Measured live (KBFL): at 1920px
 * the header 227 → 161px collapsed, three tiles where there were five; at 375px 354px collapsed,
 * unchanged, because the narrow lead is a row (a first version stacked the button and made the
 * phone header 40px LONGER — the CSS test below pins the row).
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'

const player = (over: Partial<LineupPlayer> = {}): LineupPlayer => ({
  sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
  gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
  preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8,
  afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null,
  market: null, onBye: false, ...over,
})
const page = (projections: Record<string, unknown> = {}) => ({
  league: { id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty' },
  team: { available: true, data: { teamName: 'Mine', record: '2-1', recordKnown: true, rank: 3, teamCount: 12 } },
  starters: { available: true, data: [{ slotLabel: 'QB', player: player(), empty: false, unresolvedId: null }] },
  bench: { available: true, data: [] },
  ir: { available: false, reason: 'none' },
  taxi: { available: false, reason: 'none' },
  lock: { available: false, reason: 'n/a' },
  projections: { available: true, data: { total: 19.8, projected: 1, unprojected: 0, season: '2026', week: 4, afTotal: 165.8, afEngineTotal: 178.7, afProjected: 1, standardComparable: true, ...projections } },
  projectionBasis: { notes: [], scoringKnown: true },
  nextMatchup: { available: false, reason: 'n/a' },
  upcomingByes: [],
  rosterGrade: { available: false, reason: 'n/a' },
  liveScore: { available: false, reason: 'n/a' },
}) as unknown as MyTeamData

beforeEach(() => window.localStorage.clear())
afterEach(() => window.localStorage.clear())

const tiles = (c: HTMLElement) => {
  const g = c.querySelector('.af-mt-projgroup')!
  return { g, lead: g.querySelector('.af-mt-tile--lead')!, engine: g.querySelector('.af-mt-tile--engine') as HTMLElement, std: g.querySelector(".af-mt-tile--proj:not(.af-mt-tile--af)") as HTMLElement, btn: g.querySelector('button.af-mt-compare-btn') as HTMLButtonElement | null }
}

describe('the header leads with ONE projection', () => {
  it('shows the league-scored API total, with AF and standard collapsed behind Compare', () => {
    const { container } = render(<MyTeam data={page()} />)
    const { lead, engine, std, btn } = tiles(container)
    expect(lead.textContent).toContain('165.8')
    expect(engine.hidden).toBe(true)
    expect(std.hidden).toBe(true)
    expect(btn?.getAttribute('aria-expanded')).toBe('false')
    expect(btn?.textContent).toBe('Compare projections')
    /* aria-controls names real elements — hidden, not unmounted. */
    const ids = btn!.getAttribute('aria-controls')!.split(' ')
    expect(ids.map((id) => container.querySelector(`[id="${id}"]`))).toEqual([engine, std])
  })

  it('opens and closes, and remembers the choice for this browser', () => {
    const { container } = render(<MyTeam data={page()} />)
    const { engine, std, btn } = tiles(container)
    fireEvent.click(btn!)
    expect([engine.hidden, std.hidden]).toEqual([false, false])
    expect(btn!.getAttribute('aria-expanded')).toBe('true')
    expect(btn!.textContent).toBe('Hide comparison')
    expect(engine.textContent).toContain('178.7')
    expect(window.localStorage.getItem('af-mt-compare')).toBe('1')
    fireEvent.click(btn!)
    expect(engine.hidden).toBe(true)
    expect(window.localStorage.getItem('af-mt-compare')).toBe('0')
  })

  it('opens already expanded for someone who left it expanded', async () => {
    window.localStorage.setItem('af-mt-compare', '1')
    const { container } = render(<MyTeam data={page()} />)
    await act(async () => {})
    expect(tiles(container).engine.hidden).toBe(false)
  })

  it('draws no Compare when there is nothing to compare against', () => {
    const { container } = render(<MyTeam data={page({ afEngineTotal: null, standardComparable: false })} />)
    expect(tiles(container).btn).toBeNull()
  })
})

const CSS = readFileSync(resolve(__dirname, '../components/core-app/af-my-team.css'), 'utf8')
function inQuery(selector: string, at: string): Record<string, string> {
  const out: Record<string, string> = {}
  postcss.parse(CSS).walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector)) return
    const chain: string[] = []
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) chain.push(`@${(p as AtRule).name} ${(p as AtRule).params}`)
    if (chain.join(' / ') !== at) return
    rule.walkDecls((d) => {
      out[d.prop] = d.value
    })
  })
  return out
}

describe('compare CSS', () => {
  it('really hides a collapsed tile — `.af-mt-tile` sets display, which outranks the UA [hidden]', () => {
    expect(inQuery('.af-core .af-mt-projgroup > .af-mt-tile[hidden]', '').display).toBe('none')
  })

  it('lays the narrow lead out as ONE row, button beside the number — stacked, it cost a phone 40px', () => {
    const at = '@container af-mt (max-width: 500px)'
    expect(inQuery('.af-core .af-mt-projgroup > .af-mt-tile--lead', at)).toMatchObject({ display: 'grid', 'grid-template-columns': 'minmax(0, 1fr) auto' })
    expect(inQuery('.af-core .af-mt-tile--lead > .af-mt-compare-btn', at)).toMatchObject({ 'grid-column': '2', 'grid-row': '1 / span 2' })
  })
})
