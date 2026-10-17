/**
 * My Team layout pass, 2026-10-02 — pinned by each rule's place in the parsed CSS, plus the DOM
 * the rules depend on. Measured on the live KBFL roster before the change:
 *
 *   375px phone   first starter at 2,323px; after, 1,565px.
 *   768px tablet  a 429px page got the desktop four-number block and a 70px name column.
 *   1600px        480px between a name and its numbers; after, 147px with the side column.
 *
 * A rule in the wrong query reads the same to a text search, which is why these walk the parse
 * tree and name the query each declaration must sit in.
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

/** Every rule for `selector`, with the chain of at-rules it sits inside (innermost first). */
function rules(selector: string): { at: string; decls: Record<string, string> }[] {
  const out: { at: string; decls: Record<string, string> }[] = []
  postcss.parse(CSS).walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector)) return
    const at: string[] = []
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) {
      const a = p as AtRule
      at.push(`@${a.name} ${a.params}`)
    }
    const decls: Record<string, string> = {}
    rule.walkDecls((d) => {
      decls[d.prop] = d.value
    })
    out.push({ at: at.join(' / '), decls })
  })
  return out
}
/** Declarations for `selector` in one query, later rules winning — the cascade, minus specificity. */
const inQuery = (selector: string, at: string) =>
  Object.assign({}, ...rules(selector).filter((r) => r.at === at).map((r) => r.decls)) as Record<string, string>

describe('the page measures itself', () => {
  it('declares .af-mt as the af-mt inline-size container, outside any query', () => {
    expect(inQuery('.af-mt', '').container).toBe('af-mt / inline-size')
  })
})

describe('narrow: one column, byes and basis after the roster', () => {
  it('dissolves the column wrappers by default', () => {
    for (const s of ['.af-mt-body', '.af-mt-aside', '.af-mt-main']) expect(inQuery(s, '').display).toBe('contents')
  })
  it('orders byes and the scoring basis after everything else', () => {
    expect(inQuery('.af-mt-byes', '').order).toBe('1')
    expect(inQuery('.af-mt-basis', '').order).toBe('1')
  })
})

describe('wide: roster + side column', () => {
  const WIDE = '@container af-mt (min-width: 900px)'
  it('grids the body into main and a 320px aside', () => {
    const d = inQuery('.af-mt-body', WIDE)
    expect(d.display).toBe('grid')
    expect(d['grid-template-columns']).toBe('minmax(0, 1fr) 320px')
  })
  it('stacks the matchup scoreboard inside the aside', () => {
    expect(inQuery('.af-mt-aside .af-mt-mu-body', WIDE)['grid-template-columns']).toBe('1fr')
  })
})

describe('narrow PAGE on a wide viewport (tablet portrait)', () => {
  const NARROW = '@container af-mt (max-width: 500px)'
  it('drops OWN/START and keeps the two projections', () => {
    expect(inQuery('.af-mt-projpair', NARROW)['grid-template-columns']).toBe('50px 46px')
    expect(inQuery('.af-mt-share', NARROW).display).toBe('none')
  })
  it('gives the player name two lines', () => {
    expect(inQuery('.af-core .af-mt-player-name > .af-pc-trigger', NARROW)['-webkit-line-clamp']).toBe('2')
  })
  it('stacks the matchup card under 600px of page', () => {
    expect(inQuery('.af-mt-mu-body', '@container af-mt (max-width: 600px)')['grid-template-columns']).toBe('1fr')
  })
})

describe('touch targets follow the pointer, not the width', () => {
  it('gives every My Team button 44px on a coarse pointer', () => {
    expect(inQuery('.af-mt .af-btn', '@media (pointer: coarse)')['min-height']).toBe('44px')
  })
})

function player(over: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
    gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
    preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8,
    afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null,
    market: null, onBye: false, ...over,
  }
}

describe('the DOM the layout rules depend on', () => {
  it('puts matchup, byes and basis in the aside, and the roster in the main column', () => {
    const data = {
      league: { id: 'l1', name: 'KBFL', platform: 'espn', format: 'dynasty' },
      team: { available: false, reason: 'n/a' },
      starters: { available: true, data: [{ slotLabel: 'QB', player: player(), empty: false, unresolvedId: null }] },
      bench: { available: true, data: [player({ sleeperId: 'b1' })] },
      ir: { available: false, reason: 'none' },
      taxi: { available: false, reason: 'none' },
      lock: { available: false, reason: 'n/a' },
      projections: {
        available: true,
        data: { total: 19.8, projected: 1, unprojected: 0, season: '2026', week: 4, afTotal: 22.4, afEngineTotal: 21.1, afProjected: 1, standardComparable: true },
      },
      projectionBasis: { notes: [], scoringKnown: true },
      nextMatchup: { available: false, reason: 'no schedule on file' },
      upcomingByes: [{ week: 7, names: ['Bo Nix'] }],
      rosterGrade: { available: false, reason: 'n/a' },
      liveScore: { available: false, reason: 'n/a' },
    } as unknown as MyTeamData
    const { container } = render(<MyTeam data={data} />)
    const aside = container.querySelector('.af-mt > .af-mt-body > .af-mt-aside')!
    const main = container.querySelector('.af-mt > .af-mt-body > .af-mt-main')!
    expect(aside.querySelector('.af-mt-byes')).not.toBeNull()
    expect(aside.querySelector('.af-mt-basis')).not.toBeNull()
    expect(aside.textContent).toContain('no schedule on file') // the matchup's own fallback line
    expect(main.querySelector('#lineup-player-p1')).not.toBeNull()
    expect(main.querySelector('#lineup-player-b1')).not.toBeNull()
    expect(aside.querySelector('.af-mt-row')).toBeNull()
  })
})
