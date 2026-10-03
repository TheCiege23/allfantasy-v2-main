/**
 * My Team desktop pass, 2026-10-03 — measured on the live KBFL page with the CSS injected:
 *
 *   1920px  page 1,337 → 1,180px; name to numbers 580 → 423px
 *   all     column headings 8px right of their numbers → 0px (375, 768 and 1920 checked)
 *   all     the "?" beside API: a 12px span reachable only by a mouse hover → a button that
 *           opens a native popover (keyboard, touch, Escape, click-away)
 *   IDP     the standard tile's em dash + sentence hidden at every width (it was narrow-only)
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'

const CSS = readFileSync(resolve(__dirname, '../components/core-app/af-my-team.css'), 'utf8')

/** Declarations for `selector` in exactly the at-rule chain `at` ('' = top level), later rules winning. */
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

describe('desktop CSS', () => {
  it('caps the page at the board’s width', () => {
    expect(inQuery('.af-core .af-mt', '')['max-width']).toBe('1180px')
  })

  it('lines the headings up with the numbers — rows carry 8px of padding, the header did not', () => {
    expect(inQuery('.af-core .af-mt-projhead', '')).toMatchObject({ 'margin-right': '8px', opacity: '1' })
  })

  it('tints a row under a MOUSE only — a tint that sticks after a tap reads as a selection', () => {
    expect(inQuery(".af-core .af-mt-row:not([data-empty='true']):hover", '@media (hover: hover) and (pointer: fine)').background)
      .toBe('var(--chip)')
    expect(inQuery(".af-core .af-mt-row:not([data-empty='true']):hover", '')).toEqual({})
  })

  it('hides the incomparable standard tile at every width, not only on a narrow page', () => {
    expect(inQuery(".af-core .af-mt-projgroup > .af-mt-tile--proj:not(.af-mt-tile--af)[data-missing='true']", '').display).toBe('none')
  })
})

const player = (over: Partial<LineupPlayer> = {}): LineupPlayer => ({
  sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
  gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
  preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8,
  afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null,
  market: null, onBye: false, ...over,
})
const page = (over: Record<string, unknown> = {}) => ({
  league: { id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty', sourceLink: { href: 'https://sleeper.com/leagues/1/team', label: 'Sleeper' } },
  team: { available: false, reason: 'n/a' },
  starters: { available: true, data: [{ slotLabel: 'QB', player: player(), empty: false, unresolvedId: null }] },
  bench: { available: true, data: [player({ sleeperId: 'b1' })] },
  ir: { available: false, reason: 'none' },
  taxi: { available: false, reason: 'none' },
  lock: { available: false, reason: 'n/a' },
  projections: { available: true, data: { total: 19.8, projected: 1, unprojected: 0, season: '2026', week: 4, afTotal: 22.4, afEngineTotal: 21.1, afProjected: 1, standardComparable: true } },
  projectionBasis: { notes: [], scoringKnown: true },
  nextMatchup: { available: false, reason: 'no schedule on file' },
  upcomingByes: [],
  rosterGrade: { available: false, reason: 'n/a' },
  liveScore: { available: false, reason: 'n/a' },
  ...over,
}) as unknown as MyTeamData

describe('the "?" is a control now', () => {
  it('is a button that targets its own popover, in each header', () => {
    const { container } = render(<MyTeam data={page()} />)
    const buttons = [...container.querySelectorAll('button.af-mt-info')]
    expect(buttons.length).toBe(2) // Starters and Bench
    const ids = buttons.map((b) => b.getAttribute('popovertarget'))
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) {
      const pop = container.querySelector(`[id="${id}"]`)!
      expect(pop.getAttribute('popover')).toBe('auto')
      expect(pop.textContent).toContain('re-scored under YOUR league’s settings')
    }
    expect(container.querySelector('.af-mt-info[role="img"]')).toBeNull()
  })

  it('puts the popover LAST — the narrow page hides the 3rd and 4th headings by nth-child', () => {
    const { container } = render(<MyTeam data={page()} />)
    const head = container.querySelector('.af-mt-projhead')!
    expect([...head.children].slice(0, 4).map((c) => c.textContent?.trim())).toEqual(['Sleeper?', 'AF', 'OWN', 'START'])
    expect(head.lastElementChild?.hasAttribute('popover')).toBe(true)
  })
})

describe('the lock banner’s fix is a button', () => {
  it('styles "Fix it in Sleeper" as af-btn when a starting slot is empty', () => {
    const lock = { available: true, data: { at: new Date(Date.now() + 3_600_000 * 20), anyEmptySlot: true, week: 4, season: 2026, daysAway: 0 } }
    const { container } = render(<MyTeam data={page({ lock })} />)
    const fix = container.querySelector('a.af-mt-lock-fix')!
    expect(fix.classList.contains('af-btn')).toBe(true)
    expect(fix.getAttribute('href')).toBe('https://sleeper.com/leagues/1/team')
    expect(inQuery('.af-core a.af-btn.af-mt-lock-fix', '')).toMatchObject({ 'text-transform': 'none', 'font-size': '13px' })
  })
})
