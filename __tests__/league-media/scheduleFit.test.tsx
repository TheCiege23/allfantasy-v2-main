/**
 * The Schedule tab fits its words (2026-11-06, found in the dynasty audit; redraft measured identical — it is
 * the shared tab). In /e2e/redraft-league/schedule:
 *  - 390px: the season calendar packs six 49px tiles into a 320px row, and "Deadline" / "Playoffs" spill 12px out
 *    of their tile ("Playoff" 5px). The phone track minimum was 48px.
 *  - 820px: the matchup list went two-up at the md VIEWPORT (768px) inside a ~410px content column, so every card
 *    got ~190px and cut BOTH team names ("Monday …", "Handcuff …"). At 360 a single column still cut
 *    "Waiver Wire Wizards".
 * Now: a 70px phone track (four tiles a row at 390, three at 360 — every tag fits), the list goes two-up at lg, and
 * a name takes two lines before it is clipped.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ScheduleView } from '@/app/league/[leagueId]/tabs/redraft/ScheduleView'

afterEach(cleanup)

const CSS = readFileSync(join(process.cwd(), 'app/league/[leagueId]/tabs/redraft-tailwind-tabs.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function block(css: string, prelude: RegExp): string {
  const at = css.search(prelude)
  expect(at, `no ${prelude}`).toBeGreaterThan(-1)
  const open = css.indexOf('{', at)
  let depth = 0
  for (let k = open; k < css.length; k++) {
    if (css[k] === '{') depth++
    else if (css[k] === '}' && --depth === 0) return css.slice(open + 1, k)
  }
  return ''
}
const rule = (css: string, sel: string) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}
const prop = (body: string, name: string) => body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))?.[1]?.trim()

describe('the season calendar', () => {
  const phone = block(CSS, /@media\s*\(max-width:\s*767px\)\s*\{/)
  const base = CSS.slice(0, CSS.search(/@media/))
  const tag = rule(base, '.rdt-cal-tag')
  const tagFont = Number(prop(tag, 'font')?.match(/(\d+(?:\.\d+)?)px/)?.[1])
  const em = (v: string | undefined) => (v?.endsWith('em') ? Number.parseFloat(v) : 0)
  /** Horizontal padding: the second value of a two-value shorthand, else the only one. */
  const hpad = (body: string) => { const p = (prop(body, 'padding') ?? '').split(/\s+/); return Number.parseFloat(p[1] ?? p[0] ?? 'NaN') }
  const track = (body: string) => Number(prop(rule(body, '.rdt-cal'), 'grid-template-columns')?.match(/minmax\(\s*([\d.]+)px/)?.[1])
  /** 8 characters ("Deadline", "Playoffs") of bold mono at ~0.63em each (measured 55px at 11px), plus letter-spacing. */
  const longest = (spacingEm: number) => 8 * tagFont * (0.63 + spacingEm)

  it('desktop: a tile is wide enough for its longest tag (it touched the border at 1440, 65px tiles)', () => {
    const inner = track(base) - 2 * hpad(rule(base, '.rdt-cal-cell'))
    const need = longest(em(prop(tag, 'letter-spacing')))
    expect(Number.isFinite(inner) && Number.isFinite(need)).toBe(true)
    expect(inner, `inner ${inner}px for a ${need.toFixed(1)}px tag`).toBeGreaterThanOrEqual(need)
  })

  it('phone: a tile is wide enough for its longest tag (it spilled 12px at 390, 49px tiles)', () => {
    const inner = track(phone) - 2 * hpad(rule(phone, '.rdt-cal-cell'))
    const need = longest(em(prop(rule(phone, '.rdt-cal-tag'), 'letter-spacing') ?? prop(tag, 'letter-spacing')))
    expect(Number.isFinite(inner) && Number.isFinite(need)).toBe(true)
    expect(inner, `inner ${inner}px for a ${need.toFixed(1)}px tag`).toBeGreaterThanOrEqual(need)
  })
})

const matchup = (week: number) => ({
  id: `m${week}`, week, slot: 0, type: 'regular', homeRosterId: 'r1', awayRosterId: 'r2', homeName: 'Waiver Wire Wizards', awayName: 'Late Round Lottery',
  homeDivisionId: null, awayDivisionId: null, homeDivisionName: null, awayDivisionName: null, divisionGame: false, bye: false,
  repeatCycle: 0, sourceRound: week, status: 'scheduled', locked: false, homeScore: null, awayScore: null,
})
const schedule = {
  generated: true, season: 2026, currentWeek: 1, regularSeasonWeeks: 2, playoffStartWeek: 3, validationIssues: [], standings: [],
  playoffQualificationSnapshot: { seeds: [], bubbleRosterIds: [], eliminatedRosterIds: [] },
  weeks: [1, 2].map(w => ({ week: w, status: 'scheduled', locked: false, isCurrent: w === 1, matchups: [matchup(w)], byeRosterIds: [] })),
}

describe('the matchup list', () => {
  it('a team name takes two lines before it is clipped', () => {
    render(<ScheduleView schedule={schedule as never} totalWeeks={3} />)
    for (const name of ['Waiver Wire Wizards', 'Late Round Lottery']) {
      const cls = screen.getByText(name).className.split(/\s+/)
      expect(cls, name).not.toContain('truncate')
      expect(cls, name).toContain('line-clamp-2')
    }
  })

  it('goes two-up at lg, not at the md viewport (two-up at 820 left each card ~190px)', () => {
    render(<ScheduleView schedule={schedule as never} totalWeeks={3} />)
    const card = screen.getByText('Waiver Wire Wizards').closest('div.grid')!.parentElement!.closest('.grid')!
    const cls = card.className.split(/\s+/)
    expect(cls).not.toContain('md:grid-cols-2')
    expect(cls).toContain('lg:grid-cols-2')
  })
})
