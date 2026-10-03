/**
 * The shared "?" (InfoTip.tsx), 2026-10-03. /core explained itself through `title=` attributes,
 * which a touch screen never shows and a keyboard cannot reach. These pin the control, where My
 * Team uses it, and the CSS that makes it readable.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { InfoTip } from '@/components/core-app/InfoTip'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'

describe('InfoTip', () => {
  it('is a real button that opens its own native popover', () => {
    const { container } = render(
      <>
        <InfoTip label="What OWN means" title="OWN">Share of leagues.</InfoTip>
        <InfoTip label="What START means">Of those, how many start him.</InfoTip>
      </>
    )
    const buttons = [...container.querySelectorAll('button.af-info-tip')]
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['What OWN means', 'What START means'])
    expect(buttons.every((b) => b.getAttribute('type') === 'button')).toBe(true)
    const ids = buttons.map((b) => b.getAttribute('popovertarget'))
    expect(new Set(ids).size).toBe(2)
    const [a, b] = ids.map((id) => container.querySelector(`[id="${id}"]`)!)
    expect(a.getAttribute('popover')).toBe('auto')
    expect(a.querySelector('strong')?.textContent).toBe('OWN')
    expect(a.querySelector('.af-info-pop-body')?.textContent).toBe('Share of leagues.')
    expect(b.querySelector('strong')).toBeNull()
  })

  it('keeps the popover inside its own wrapper, and inline-valid (no block elements)', () => {
    const { container } = render(<InfoTip label="x">y</InfoTip>)
    const wrap = container.firstElementChild!
    expect(wrap.className).toBe('af-info-tip-wrap')
    expect(wrap.querySelector(':scope > [popover]')?.tagName).toBe('SPAN')
    expect(wrap.querySelector('div, p')).toBeNull()
  })
})

const player = (over: Partial<LineupPlayer> = {}): LineupPlayer => ({
  sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
  gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
  preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8,
  afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null,
  market: null, onBye: false, ...over,
})
const side = (over: Record<string, unknown> = {}) => ({
  rosterId: 4, teamName: 'Mine', managerName: 'me', avatarUrl: null,
  projected: 131.7, afProjected: 128.4, projectedFrom: 9, starterCount: 9, ...over,
})
const page = (you: Record<string, unknown> = {}) =>
  ({
    league: { id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty', sourceLink: { href: 'https://sleeper.com/leagues/1/team', label: 'Sleeper' } },
    team: { available: false, reason: 'n/a' },
    starters: { available: true, data: [{ slotLabel: 'QB', player: player(), empty: false, unresolvedId: null }] },
    bench: { available: true, data: [player({ sleeperId: 'b1' })] },
    ir: { available: false, reason: 'none' },
    taxi: { available: false, reason: 'none' },
    lock: { available: false, reason: 'n/a' },
    projections: { available: true, data: { total: 19.8, projected: 1, unprojected: 0, season: '2026', week: 4, afTotal: 22.4, afEngineTotal: 21.1, afProjected: 1, standardComparable: true } },
    projectionBasis: { notes: [], scoringKnown: true },
    nextMatchup: {
      available: true,
      data: { seasonYear: 2026, week: 4, you: side(you), opponent: side({ rosterId: 7, teamName: 'Them' }), bye: false, unpricedReason: null },
    },
    upcomingByes: [],
    rosterGrade: { available: false, reason: 'n/a' },
    liveScore: { available: false, reason: 'n/a' },
  }) as unknown as MyTeamData

describe('My Team uses it where something needs explaining', () => {
  it('explains all four projection columns from ONE "?" per header — not one per row', () => {
    const { container } = render(<MyTeam data={page()} />)
    const heads = [...container.querySelectorAll('.af-mt-projhead')]
    expect(heads.length).toBe(2)
    for (const head of heads) {
      expect(head.querySelectorAll('button.af-info-tip').length).toBe(1)
      const text = head.querySelector('.af-info-pop')!.textContent!
      for (const term of ['SLEEPER', 'AF is AllFantasy', 'OWN is', 'START is']) expect(text).toContain(term)
    }
    expect(container.querySelectorAll('.af-mt-row button.af-info-tip').length).toBe(0)
  })

  it('explains the matchup card’s two numbers once, in its heading', () => {
    const { container } = render(<MyTeam data={page()} />)
    const tips = container.querySelectorAll('.af-mt-matchup button.af-info-tip')
    expect(tips.length).toBe(1)
    expect(tips[0].closest('.af-mt-mu-head')).not.toBeNull()
    const pop = container.querySelector('.af-mt-matchup .af-info-pop')!.textContent!
    expect(pop).toContain('Sleeper’s projection')
    expect(pop).toContain('from 5 of 9')
  })

  it('says nothing about numbers that are not there', () => {
    const { container } = render(<MyTeam data={page({ projected: null, afProjected: null, projectedFrom: 0 })} />)
    expect(container.querySelector('.af-mt-matchup')).not.toBeNull()
    expect(container.querySelector('.af-mt-matchup button.af-info-tip')).toBeNull()
  })

  it('⚠ never sits under a `title` — it would pop a hover-only copy over the open popover', () => {
    const { container } = render(<MyTeam data={page()} />)
    const pops = [...container.querySelectorAll('.af-info-pop')]
    expect(pops.length).toBeGreaterThan(0)
    for (const pop of pops) expect(pop.closest('[title]')).toBeNull()
  })
})

const ruleDecls = (file: string, selector: string) => {
  const out: Record<string, string> = {}
  postcss.parse(readFileSync(resolve(__dirname, `../components/core-app/${file}`), 'utf8')).walkRules((r: Rule) => {
    if (r.parent?.type !== 'root' || !r.selectors.includes(selector)) return
    r.walkDecls((d) => {
      out[d.prop] = d.value
    })
  })
  return out
}

describe('its CSS, shared by every /core screen', () => {
  it('gives a small circle a big hit area — bigger again under a finger', () => {
    expect(ruleDecls('af-core.css', '.af-core .af-info-tip')).toMatchObject({ width: '14px', height: '14px', 'border-radius': '50%' })
    expect(ruleDecls('af-core.css', '.af-core .af-info-tip::after').inset).toBe('-8px')
    let coarse: string | undefined
    postcss.parse(readFileSync(resolve(__dirname, '../components/core-app/af-core.css'), 'utf8')).walkAtRules('media', (m) => {
      if (m.params !== '(pointer: coarse)') return
      m.walkRules((r) => {
        if (r.selector === '.af-core .af-info-tip::after') r.walkDecls('inset', (d) => void (coarse = d.value))
      })
    })
    expect(coarse).toBe('-15px')
  })

  it('undoes what the popover inherits from the label it sits in', () => {
    expect(ruleDecls('af-core.css', '.af-core .af-info-pop')).toMatchObject({
      'text-transform': 'none', 'text-align': 'left', 'letter-spacing': 'normal', 'white-space': 'normal',
      /* Without preflight, content-box put the padding on top of max-width: 390px wide at 390. */
      'box-sizing': 'border-box',
    })
    expect(ruleDecls('af-core.css', '.af-core .af-info-para').display).toBe('block')
  })

  it('⚠ uses no `font` shorthand carrying a keyword — `inherit` there voids the whole declaration', () => {
    const tip = ruleDecls('af-core.css', '.af-core .af-info-tip')
    expect(tip.font).toBeUndefined()
    expect(tip).toMatchObject({ 'font-size': '11px', 'font-weight': '800', 'font-family': 'inherit' })
  })

  it('leaves no My Team-only copy of it behind', () => {
    expect(readFileSync(resolve(__dirname, '../components/core-app/af-my-team.css'), 'utf8')).not.toMatch(/af-mt-info/)
  })
})
